// Nerity 启动器 - 配置管理
const path = require('path');
const fs = require('fs');
const os = require('os');

// 默认游戏目录：%APPDATA%\.nerity
function defaultGameDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, '.nerity');
}

const CONFIG_FILE = 'nerity-config.json';
const MAX_MEM = Math.max(1024, Math.min(Math.floor(os.totalmem() / 1024 / 1024 / 1024) * 1024, 16384));

function defaultConfig() {
  return {
    gameDir: defaultGameDir(),
    javaPath: '',              // 空 = 自动检测
    memory: 2048,              // 分配内存（MB）
    offlineUsername: '',
    authMode: 'offline',       // offline | microsoft
    microsoft: null,           // 微软账号信息
    resolution: '',            // 空 = 默认
    jvmArgs: '',               // 额外 JVM 参数
    gameArgs: '',              // 额外游戏参数
    lastVersion: ''
  };
}

function configPath() {
  return path.join(defaultGameDir(), CONFIG_FILE);
}

function get() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

function save(patch) {
  const cur = get();
  const next = { ...cur, ...patch };
  ensureDirs();
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function ensureDirs() {
  const dirs = [
    defaultGameDir(),
    path.join(defaultGameDir(), 'versions'),
    path.join(defaultGameDir(), 'libraries'),
    path.join(defaultGameDir(), 'assets'),
    path.join(defaultGameDir(), 'assets', 'objects'),
    path.join(defaultGameDir(), 'assets', 'indexes'),
    path.join(defaultGameDir(), 'versions'),
    path.join(defaultGameDir(), 'logs'),
    path.join(defaultGameDir(), 'saves')
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function getGameDir() {
  const cfg = get();
  // 用户可能自定义了游戏目录，但配置本身存在默认目录；这里统一用配置里的 gameDir
  const dir = cfg.gameDir || defaultGameDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { defaultGameDir, configPath, get, save, ensureDirs, getGameDir, CONFIG_FILE, MAX_MEM };
