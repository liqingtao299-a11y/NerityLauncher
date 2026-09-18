// Nerity 启动器 - Java 运行时检测
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const download = require('./download');

function getJavaVersion(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      // java -version 输出到 stderr
      const text = (stderr || stdout || '').toString();
      if (err && !/version/.test(text)) return resolve(null);
      const m = text.match(/(?:version|java version) "([0-9._]+)/i) || text.match(/openjdk version "([0-9._]+)/i);
      if (!m) return resolve(null);
      const v = m[1];
      // 主版本号：1.8 -> 8；17 -> 17
      const major = v.startsWith('1.') ? parseInt(v.split('.')[1], 10) : parseInt(v.split('.')[0], 10);
      resolve({ raw: v, major, path: javaPath });
    });
  });
}

function findJavaInPath() {
  const { spawnSync } = require('child_process');
  const r = spawnSync('where', ['java'], { windowsHide: true });
  if (r.status === 0 && r.stdout) {
    const line = r.stdout.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || null;
  }
  return null;
}

// 检测：优先用户指定，其次 PATH，其次常见安装路径
async function detectJava() {
  const cfg = config.get();
  const candidates = [];
  if (cfg.javaPath && fs.existsSync(cfg.javaPath)) candidates.push(cfg.javaPath);
  const inPath = findJavaInPath();
  if (inPath) candidates.push(inPath);

  for (const c of candidates) {
    const info = await getJavaVersion(c);
    if (info) return { found: true, javaPath: c, ...info };
  }

  // 常见安装目录（兜底）
  const common = [
    'C:/Program Files/Java',
    'C:/Program Files (x86)/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/Microsoft',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Programs` : null
  ].filter(Boolean);
  for (const dir of common) {
    if (!fs.existsSync(dir)) continue;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const exe = `${dir}/${it.name}/bin/java.exe`;
      if (fs.existsSync(exe)) {
        const info = await getJavaVersion(exe);
        if (info) return { found: true, javaPath: exe, ...info };
      }
    }
  }
  return { found: false };
}

// 根据 MC 版本给出推荐的 Java 主版本
function recommendedJavaMajor(mcVersion) {
  const v = mcVersion || '';
  const major = parseInt(v.split('.')[1], 10); // 1.X
  if (Number.isNaN(major)) return 21;
  if (major >= 21) return 21;
  if (major >= 17) return 17;
  return 8; // 1.16 及以下
}

/* ---------------- 内置 Java 下载（Adoptium Temurin） ---------------- */
function adoptiumOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}
function adoptiumArch() {
  const a = os.arch();
  if (a === 'x64') return 'x64';
  if (a === 'arm64' || a === 'aarch64') return 'aarch64';
  return 'x64';
}
function javaExeName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}
function adoptiumUrl(feature) {
  return `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?os=${adoptiumOs()}&architecture=${adoptiumArch()}&image_type=jdk&vendor=eclipse`;
}

// 通过 Adoptium assets 接口查询真实下载链接
async function getAdoptiumDownloadUrl(feature) {
  const manifestMod = require('./manifest');
  const buf = await manifestMod.request(adoptiumUrl(feature));
  const arr = JSON.parse(buf.toString('utf-8'));
  if (!Array.isArray(arr) || !arr.length || !arr[0].binary || !arr[0].binary.package) {
    throw new Error('未找到可用的 Java 下载');
  }
  return arr[0].binary.package.link;
}

// 下载并安装指定主版本的 Java 到游戏目录的 java/ 下
async function downloadAndInstallJava(feature, onProgress) {
  const gameDir = config.getGameDir();
  const javaBase = path.join(gameDir, 'java');
  fs.mkdirSync(javaBase, { recursive: true });

  const zipPath = path.join(javaBase, `jdk-${feature}-${adoptiumOs()}-${adoptiumArch()}.zip`);
  const instDir = path.join(javaBase, `jdk-${feature}`);

  const link = await getAdoptiumDownloadUrl(feature);
  onProgress && onProgress({ label: `下载 Java ${feature}`, current: 0, total: 1 });
  await download.downloadFile(link, zipPath, {
    onProgress: (p) => onProgress && onProgress({ label: `Java ${feature}`, current: p.current, total: p.total })
  });

  // 解压
  onProgress && onProgress({ label: `解压 Java ${feature}…`, current: 1, total: 1 });
  if (fs.existsSync(instDir)) fs.rmSync(instDir, { recursive: true, force: true });
  fs.mkdirSync(instDir, { recursive: true });

  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${instDir.replace(/'/g, "''")}' -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
  } else {
    const cp = require('child_process');
    cp.execSync(`unzip -q -o "${zipPath}" -d "${instDir}"`, { stdio: 'ignore' });
  }

  // 找到解压后的 java 可执行文件
  const exe = findJavaUnder(instDir);
  if (!exe) throw new Error('Java 解压后未找到可执行文件');
  config.save({ javaPath: exe });

  const info = await getJavaVersion(exe);
  return { found: true, javaPath: exe, ...info, installDir: instDir };
}

function findJavaUnder(dir) {
  const target = javaExeName();
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const bin = path.join(cur, 'bin', target);
    if (fs.existsSync(bin)) return bin;
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
    }
  }
  return null;
}

module.exports = { detectJava, getJavaVersion, recommendedJavaMajor, downloadAndInstallJava, getAdoptiumDownloadUrl, adoptiumUrl };
