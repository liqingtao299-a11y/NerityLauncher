// Nerity 启动器 - 游戏文件下载（版本 jar / libraries / assets）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream');
const manifest = require('./manifest');
const config = require('./config');

const CONCURRENCY = 6;
const MAX_RETRY = 2;

function sha1Of(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// 把 mojang 官方 url 重写为当前下载源的地址（镜像加速）
function rewrite(url) {
  const cur = manifest.getSource();
  const m = manifest.SOURCES.mojang;
  const pairs = [
    [m.libraries, cur.libraries],
    [m.resources, cur.resources],
    [m.piston, cur.piston],
    [m.launcher, cur.launcher]
  ];
  for (const [from, to] of pairs) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return url;
}

// 切换为对侧下载源（官方 <-> 镜像），用于失败回退
function rewriteOther(url) {
  const cur = manifest.getSource();
  const other = cur === manifest.SOURCES.mojang ? manifest.SOURCES.bmclapi : manifest.SOURCES.mojang;
  const m = manifest.SOURCES.mojang;
  const pairs = [
    [m.libraries, other.libraries],
    [m.resources, other.resources],
    [m.piston, other.piston],
    [m.launcher, other.launcher]
  ];
  for (const [from, to] of pairs) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return url;
}

// 流式下载单个文件，带进度与校验
function downloadFile(url, dest, { onProgress, label, expectedSize, expectedSha1 } = {}) {
  return new Promise(async (resolve, reject) => {
    // 已存在且校验通过 -> 秒跳
    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      const sizeOk = expectedSize ? size === expectedSize : size > 0;
      if (sizeOk) {
        if (!expectedSha1 || (await sha1Of(dest)) === expectedSha1) {
          return resolve({ skipped: true, dest });
        }
      }
    }

    const tmp = dest + '.part';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

    let attempts = 0;
    let useOther = false;
    const tryOnce = () => {
      const lib = url.startsWith('https:') ? https : http;
      const target = useOther ? rewriteOther(url) : rewrite(url);
      const req = lib.get(target, { headers: { 'User-Agent': 'Nerity-Launcher/0.1', 'Accept-Encoding': 'identity' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          url = new URL(res.headers.location, url).toString();
          return tryOnce();
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${res.statusCode} @ ${path.basename(dest)}`));
        }
        const total = expectedSize || Number(res.headers['content-length']) || 0;
        let received = 0;
        const out = fs.createWriteStream(tmp);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress({ label, current: received, total });
        });
        res.pipe(out);
        out.on('finish', async () => {
          out.close();
          try {
            if (expectedSha1 && (await sha1Of(tmp)) !== expectedSha1) {
              throw new Error('SHA1 校验失败');
            }
            fs.renameSync(tmp, dest);
            resolve({ skipped: false, dest });
          } catch (e) { fail(e); }
        });
        out.on('error', fail);
        res.on('error', fail);
      });
      req.on('error', fail);
      req.setTimeout(30000, () => req.destroy(new Error('下载超时')));

      function fail(err) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        if (attempts < MAX_RETRY) { attempts++; useOther = !useOther; setTimeout(tryOnce, 400); return; }
        reject(err);
      }
    };
    tryOnce();
  });
}

// 简单并发队列
async function runPool(items, worker, concurrency) {
  let idx = 0;
  const total = items.length;
  let done = 0;
  const runner = async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i, total);
      done++;
    }
  };
  const runners = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) runners.push(runner());
  await Promise.all(runners);
  return done;
}

// 解压 zip（原生库 natives）
function extractZip(zipPath, outDir) {
  const cp = require('child_process');
  // 用 PowerShell 的 Expand-Archive 解压，避免额外依赖
  fs.mkdirSync(outDir, { recursive: true });
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
  return new Promise((resolve, reject) => {
    cp.execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// 平台 / 系统规则判断
function platformName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}
function matchOs(rule) {
  if (!rule) return true;
  if (rule.name && rule.name !== platformName()) return false;
  return true;
}
function applyRules(rules) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    const ok = matchOs(r.os);
    if (r.action === 'allow' && ok) allowed = true;
    if (r.action === 'disallow' && ok) return false;
  }
  return allowed;
}

// 下载单个版本的所有必要文件
async function prepareVersion(versionId, onProgress) {
  const gameDir = config.getGameDir();
  const verDir = path.join(gameDir, 'versions', versionId);
  fs.mkdirSync(verDir, { recursive: true });

  const versionJson = await manifest.fetchVersionJson(versionId);
  const steps = [];
  const report = (label, done, total) => onProgress && onProgress({ label, current: done, total });

  // 1) 客户端 jar
  const client = versionJson.downloads && versionJson.downloads.client;
  if (client) {
    steps.push({ kind: 'jar', label: '主程序 jar', ...client });
  }

  // 2) libraries（含 natives）
  const libraries = versionJson.libraries || [];
  for (const lib of libraries) {
    if (!applyRules(lib.rules)) continue;
    const artifact = lib.downloads && lib.downloads.artifact;
    if (artifact) steps.push({ kind: 'lib', label: path.basename(artifact.path), ...artifact });
    if (lib.downloads && lib.downloads.classifiers) {
      const nativeKey = `natives-${platformName()}`;
      const nat = lib.downloads.classifiers[nativeKey];
      if (nat) steps.push({ kind: 'natives', label: path.basename(nat.path), ...nat });
    }
  }

  report('解析任务', 0, steps.length);

  let doneCount = 0;
  const nativesMap = {}; // 库路径 -> 解压目录
  const errors = [];

  const worker = async (task, i, total) => {
    try {
      if (task.kind === 'jar') {
        const dest = path.join(verDir, `${versionId}.jar`);
        await downloadFile(task.url, dest, { onProgress: (p) => report('主程序 jar', doneCount, steps.length), expectedSize: task.size, expectedSha1: task.sha1 });
      } else if (task.kind === 'lib') {
        const dest = path.join(gameDir, 'libraries', task.path);
        await downloadFile(task.url, dest, { expectedSize: task.size, expectedSha1: task.sha1 });
      } else if (task.kind === 'natives') {
        const dest = path.join(gameDir, 'libraries', task.path);
        await downloadFile(task.url, dest, { expectedSize: task.size, expectedSha1: task.sha1 });
        const nativeDir = path.join(verDir, 'natives');
        fs.mkdirSync(nativeDir, { recursive: true });
        await extractZip(dest, nativeDir);
        nativesMap[task.path] = nativeDir;
      }
    } catch (e) {
      errors.push(`${task.label}: ${e.message}`);
    }
    doneCount++;
    report(`下载 ${task.label}`, doneCount, steps.length);
  };

  await runPool(steps, worker, CONCURRENCY);

  // 3) assets 索引与资源
  let assetIndex = null;
  try {
    assetIndex = await manifest.fetchAssetIndex(versionJson);
  } catch (e) { errors.push(`资源索引: ${e.message}`); }

  let assetCount = 0, assetDone = 0;
  if (assetIndex && assetIndex.objects) {
    const objects = Object.entries(assetIndex.objects);
    assetCount = objects.length;
    report('资源文件', 0, objects.length);
    await runPool(objects, async ([name, obj]) => {
      const hash = obj.hash;
      const dest = path.join(gameDir, 'assets', 'objects', hash.slice(0, 2), hash);
      try {
        const srcUrl = `${manifest.getUrl('resources')}/${hash.slice(0, 2)}/${hash}`;
        await downloadFile(srcUrl, dest, { expectedSize: obj.size, expectedSha1: hash });
      } catch (e) {
        // 资源文件个别失败不影响启动（图片音效缺失），仅记录
      }
      assetDone++;
      report('资源文件', assetDone, objects.length);
    }, CONCURRENCY);
  }

  return {
    ok: errors.length === 0,
    errors,
    nativesDir: Object.values(nativesMap)[0] || null,
    ready: true,
    versionId
  };
}

module.exports = { prepareVersion, downloadFile, rewrite, sha1Of };
