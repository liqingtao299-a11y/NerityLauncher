// Nerity 启动器 - Minecraft 版本清单获取
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

// 下载源：官方 + BMCLAPI 国内镜像
const SOURCES = {
  mojang: {
    manifest: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
    piston: 'https://piston-meta.mojang.com',
    libraries: 'https://libraries.minecraft.net',
    resources: 'https://resources.download.minecraft.net',
    launcher: 'https://launcher.mojang.com'
  },
  bmclapi: {
    manifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
    piston: 'https://bmclapi2.bangbang93.com',
    libraries: 'https://bmclapi2.bangbang93.com/maven',
    resources: 'https://bmclapi2.bangbang93.com/assets',
    launcher: 'https://bmclapi2.bangbang93.com'
  }
};

let downloadSource = 'mojang'; // 清单与文件下载默认官方源（稳定）；镜像作为加速备选

function setSource(name) {
  if (SOURCES[name]) downloadSource = name;
}
function getSource() { return SOURCES[downloadSource]; }

function getUrl(name) {
  const src = getSource();
  return src[name];
}

// 通用 GET，跟随重定向
function request(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Nerity-Launcher/0.1', 'Accept-Encoding': 'identity' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('重定向过多'));
        return resolve(request(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} @ ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch (e) { return reject(new Error('解压响应失败')); }
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('请求超时')); });
  });
}

// 拉取版本清单
async function fetchManifest() {
  const url = getUrl('manifest');
  const buf = await request(url);
  return JSON.parse(buf.toString('utf-8'));
}

// 拉取单个版本的详细 json（先本地缓存，后远程）
async function fetchVersionJson(versionId) {
  const cacheDir = path.join(config.getGameDir(), 'versions', versionId);
  const cacheFile = path.join(cacheDir, `${versionId}.json`);
  if (fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')); } catch {}
  }

  // 从清单拿到该版本的 url
  const manifestData = await fetchManifest();
  const v = manifestData.versions.find((x) => x.id === versionId);
  if (!v) throw new Error(`找不到版本 ${versionId}`);
  const buf = await request(v.url);
  const json = JSON.parse(buf.toString('utf-8'));

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2), 'utf-8');
  return json;
}

// 解析 assets 索引
async function fetchAssetIndex(versionJson) {
  const assetIndex = versionJson.assetIndex;
  if (!assetIndex) return null;
  const cacheFile = path.join(config.getGameDir(), 'assets', 'indexes', `${assetIndex.id}.json`);
  if (fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')); } catch {}
  }
  const buf = await request(assetIndex.url);
  const json = JSON.parse(buf.toString('utf-8'));
  if (!fs.existsSync(path.dirname(cacheFile))) fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2), 'utf-8');
  return json;
}

module.exports = { SOURCES, setSource, getSource, getUrl, request, fetchManifest, fetchVersionJson, fetchAssetIndex };
