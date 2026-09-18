// Nerity 启动器 - 预加载脚本（安全桥接）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nerity', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  getGameDir: () => ipcRenderer.invoke('config:getGameDir'),

  // 版本
  fetchVersions: () => ipcRenderer.invoke('versions:list'),
  listLocalVersions: () => ipcRenderer.invoke('versions:local'),
  chooseDir: (title) => ipcRenderer.invoke('dialog:chooseDir', title),

  // 下载
  downloadVersion: (versionId) => ipcRenderer.invoke('download:version', versionId),
  onDownloadProgress: (cb) => {
    const listener = (_e, progress) => cb(progress);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },

  // Java
  detectJava: () => ipcRenderer.invoke('java:detect'),
  downloadJava: (feature) => ipcRenderer.invoke('java:download', feature),

  // 登录
  loginOffline: (username) => ipcRenderer.invoke('auth:offline', username),
  getAuthState: () => ipcRenderer.invoke('auth:getState'),
  msStartLogin: () => ipcRenderer.invoke('auth:msStart'),
  msPoll: (deviceCode) => ipcRenderer.invoke('auth:msPoll', deviceCode),
  msRefresh: () => ipcRenderer.invoke('auth:msRefresh'),

  // 启动
  launch: (opts) => ipcRenderer.invoke('launch:start', opts),

  // 模组
  searchMods: (query, opts) => ipcRenderer.invoke('mods:search', query, opts),
  downloadMod: (projectId, opts) => ipcRenderer.invoke('mods:download', projectId, opts)
});
