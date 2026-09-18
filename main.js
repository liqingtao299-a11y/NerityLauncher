// Nerity 启动器 - Electron 主进程
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./core/config');
const manifest = require('./core/manifest');
const download = require('./core/download');
const javaUtil = require('./core/java');
const launcher = require('./core/launch');
const modrinth = require('./core/modrinth');
const msauth = require('./core/msauth');

let mainWindow = null;
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: 'Nerity 启动器',
    backgroundColor: '#0f1220',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // 初始化游戏目录结构
  config.ensureDirs();
  createWindow();

  // 截图钩子：NERITY_SHOT=/path.png 时启动后自动截图保存（用于验证界面渲染）
  // 可选 NERITY_NAV=viewId、NERITY_QUERY=搜索词，用于验证指定页面
  if (process.env.NERITY_SHOT) {
    setTimeout(async () => {
      try {
        const nav = process.env.NERITY_NAV;
        const query = process.env.NERITY_QUERY || '';
        if (nav) {
          await mainWindow.webContents.executeJavaScript(`
            (async () => {
              const b = document.querySelector('.nav-item[data-view="${nav}"]');
              if (b) b.click();
              const q = document.getElementById('modQuery');
              if (q && ${JSON.stringify(query)}) q.value = ${JSON.stringify(query)};
              if (${JSON.stringify(!!query)} && document.getElementById('modSearchBtn')) {
                document.getElementById('modSearchBtn').click();
                await new Promise(r => setTimeout(r, 2000));
              } else {
                await new Promise(r => setTimeout(r, 600));
              }
            })();
          `);
        }
        const img = await mainWindow.webContents.capturePage();
        require('fs').writeFileSync(process.env.NERITY_SHOT, img.toPNG());
        console.log('[shot] saved ' + process.env.NERITY_SHOT);
      } catch (e) { console.error('[shot]', e); }
    }, 6000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- IPC 接口 ---------------- */

ipcMain.handle('config:get', () => config.get());
ipcMain.handle('config:save', (e, patch) => config.save(patch));
ipcMain.handle('config:getGameDir', () => config.getGameDir());

ipcMain.handle('dialog:chooseDir', async (e, title) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || '选择文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('versions:list', async () => {
  try {
    const data = await manifest.fetchManifest();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('versions:local', () => {
  return launcher.listLocalVersions();
});

ipcMain.handle('download:version', async (e, versionId) => {
  const res = await download.prepareVersion(versionId, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:progress', progress);
    }
  });
  return res;
});

ipcMain.handle('java:detect', () => javaUtil.detectJava());

ipcMain.handle('java:download', async (e, feature) => {
  try {
    const info = await javaUtil.downloadAndInstallJava(feature, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download:progress', progress);
      }
    });
    return { ok: true, ...info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('auth:offline', (e, username) => launcher.loginOffline(username));
ipcMain.handle('auth:getState', () => launcher.getAuthState());

/* ---------------- 微软账号登录 ---------------- */
ipcMain.handle('auth:msStart', async () => {
  try {
    const d = await msauth.startDeviceLogin();
    return { ok: true, ...d };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('auth:msPoll', async (e, deviceCode) => {
  try {
    const r = await msauth.pollToken(deviceCode);
    if (r.status === 'pending') return { status: 'pending' };
    const profile = await msauth.completeLogin(r.accessToken, r.refreshToken);
    config.save({ authMode: 'microsoft', microsoft: profile, offlineUsername: profile.name || '' });
    return { status: 'done', profile };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});
ipcMain.handle('auth:msRefresh', async () => {
  const cfg = config.get();
  if (!cfg.microsoft || !cfg.microsoft.refreshToken) return { ok: false, error: '无微软账号' };
  try {
    const t = await msauth.refreshToken(cfg.microsoft.refreshToken);
    const profile = await msauth.completeLogin(t.accessToken, t.refreshToken);
    config.save({ microsoft: profile });
    return { ok: true, profile };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('launch:start', async (e, opts) => {
  return launcher.launchGame(opts);
});

/* ---------------- 模组 ---------------- */
ipcMain.handle('mods:search', async (e, query, opts) => {
  try {
    const hits = await modrinth.searchMods(query, opts);
    return { ok: true, data: hits };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('mods:download', async (e, projectId, opts) => {
  const res = await modrinth.downloadMod(projectId, {
    ...opts,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download:progress', progress);
      }
    }
  });
  return res;
});
