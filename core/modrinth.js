// Nerity 启动器 - 模组下载（Modrinth API）
const path = require('path');
const fs = require('fs');
const manifest = require('./manifest');
const download = require('./download');
const config = require('./config');

const API = 'https://api.modrinth.com/v2';

// 搜索模组
// query: 关键词；mcVersion: 如 1.21.1；loader: forge/fabric/neoforge/quilt
async function searchMods(query, { mcVersion, loader, limit = 24 } = {}) {
  const facets = [];
  if (mcVersion) facets.push(`versions:${mcVersion}`);
  if (loader) facets.push(`categories:${loader}`);
  let url = `${API}/search?query=${encodeURIComponent(query || '')}&limit=${limit}`;
  if (facets.length) url += `&facets=${encodeURIComponent(JSON.stringify(facets.map((f) => [f])))}`;
  const buf = await manifest.request(url);
  const data = JSON.parse(buf.toString('utf-8'));
  return (data.hits || []).map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description || '',
    icon: h.icon_url,
    author: (h.author || '').toString(),
    downloads: h.downloads || 0,
    versions: h.versions || [],
    categories: h.categories || []
  }));
}

// 查询某项目在指定 MC 版本 + 加载器下的可用文件版本
async function getProjectVersions(projectId, { mcVersion, loader } = {}) {
  let url = `${API}/project/${encodeURIComponent(projectId)}/version`;
  const params = [];
  if (mcVersion) params.push(`game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`);
  if (loader) params.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
  if (params.length) url += '?' + params.join('&');
  const buf = await manifest.request(url);
  const list = JSON.parse(buf.toString('utf-8'));
  if (!Array.isArray(list)) return [];
  return list.map((v) => {
    const file = v.files && v.files[0];
    return {
      id: v.id,
      name: v.name,
      versionNumber: v.version_number,
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      published: v.date_published,
      downloads: v.downloads || 0,
      fileName: file ? file.filename : null,
      fileSize: file ? file.size : 0,
      fileUrl: file ? file.url : null
    };
  });
}

// 下载模组到游戏的 mods 目录
// returns { ok, fileName, modsDir }
async function downloadMod(projectId, { mcVersion, loader, onProgress }) {
  const versions = await getProjectVersions(projectId, { mcVersion, loader });
  if (!versions.length) throw new Error('该模组没有匹配当前 MC 版本/加载器的文件');
  const v = versions[0];
  if (!v.fileUrl || !v.fileName) throw new Error('没有可下载的文件');

  const modsDir = path.join(config.getGameDir(), 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, v.fileName);

  await download.downloadFile(v.fileUrl, dest, {
    label: v.fileName,
    onProgress: (p) => onProgress && onProgress({ label: p.label, current: p.current, total: p.total }),
    expectedSize: v.fileSize
  });
  return { ok: true, fileName: v.fileName, modsDir, size: v.fileSize };
}

module.exports = { searchMods, getProjectVersions, downloadMod };
