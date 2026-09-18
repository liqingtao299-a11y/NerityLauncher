// Nerity 启动器 - 登录与游戏启动核心
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');
const manifest = require('./manifest');
const javaUtil = require('./java');
const msauth = require('./msauth');

const LAUNCHER_NAME = 'Nerity';
const LAUNCHER_VERSION = '0.1.0';

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

function offlineUuid(username) {
  // 离线模式标准 UUID
  const digest = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ---------------- 登录 ---------------- */
function formatUuid(raw) {
  const h = (raw || '').replace(/-/g, '');
  if (h.length !== 32) return raw || '';
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loginOffline(username) {
  const name = (username || '').trim();
  if (!name) throw new Error('请输入游戏昵称');
  const state = config.save({ authMode: 'offline', offlineUsername: name });
  return getAuthState(state);
}

function getAuthState(cfg) {
  const c = cfg || config.get();
  return {
    authMode: c.authMode || 'offline',
    offlineUsername: c.offlineUsername || '',
    microsoft: c.microsoft || null
  };
}

/* ---------------- 本地版本 ---------------- */
function listLocalVersions() {
  const gameDir = config.getGameDir();
  const versionsDir = path.join(gameDir, 'versions');
  if (!fs.existsSync(versionsDir)) return [];
  const ids = fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(versionsDir, id, `${id}.jar`)) && fs.existsSync(path.join(versionsDir, id, `${id}.json`)));
  return ids;
}

/* ---------------- 构建启动参数 ---------------- */
function substitute(template, vars) {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => (vars[key] !== undefined ? String(vars[key]) : ''));
}

async function buildCommand(versionId, opts = {}) {
  const gameDir = config.getGameDir();
  const verDir = path.join(gameDir, 'versions', versionId);
  const versionJson = await manifest.fetchVersionJson(versionId);
  const jarFile = path.join(verDir, `${versionId}.jar`);
  if (!fs.existsSync(jarFile)) throw new Error(`版本 ${versionId} 尚未下载完整，请先下载`);

  // Java
  const java = await javaUtil.detectJava();
  if (!java.found) throw new Error('未检测到 Java，请在设置中指定 Java 路径');

  const cfg = config.get();
  const memory = opts.memory || cfg.memory || 2048;
  const auth = getAuthState();
  const isMicrosoft = auth.authMode === 'microsoft' && cfg.microsoft && cfg.microsoft.accessToken;
  const username = opts.username || (isMicrosoft ? cfg.microsoft.name : null) || auth.offlineUsername || 'Steve';
  const uuid = isMicrosoft ? formatUuid(cfg.microsoft.uuid) : offlineUuid(username);
  const accessToken = isMicrosoft ? cfg.microsoft.accessToken : '0';
  const xuid = isMicrosoft ? (cfg.microsoft.xuid || '0') : '0';
  const clientId = isMicrosoft ? msauth.CLIENT_ID : '00000000-0000-0000-0000-000000000000';
  const userType = isMicrosoft ? 'msa' : 'legacy';
  const nativesDir = path.join(verDir, 'natives');

  // Classpath：所有适用平台的 library + 版本 jar
  const cp = [];
  const libraries = versionJson.libraries || [];
  for (const lib of libraries) {
    if (!applyRules(lib.rules)) continue;
    const artifact = lib.downloads && lib.downloads.artifact;
    if (!artifact) continue;
    const p = path.join(gameDir, 'libraries', artifact.path);
    if (fs.existsSync(p)) cp.push(p);
  }
  cp.push(jarFile);
  const classpath = cp.join(path.delimiter);

  const assetIndex = versionJson.assetIndex || { id: versionId };
  const vars = {
    auth_player_name: username,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: path.join(gameDir, 'assets'),
    assets_index_name: assetIndex.id,
    auth_uuid: uuid,
    auth_access_token: accessToken,
    auth_xuid: xuid,
    clientid: clientId,
    user_type: userType,
    version_type: versionJson.type || 'release',
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath,
    library_directory: path.join(gameDir, 'libraries'),
    resolution_width: opts.width || cfg.resolution?.split('x')[0] || '854',
    resolution_height: opts.height || cfg.resolution?.split('x')[1] || '480'
  };

  // 收集 JVM 参数
  let jvmArgs = [];
  let gameArgs = [];
  if (versionJson.arguments) {
    const jvm = versionJson.arguments.jvm || [];
    for (const item of jvm) {
      if (typeof item === 'string') { jvmArgs.push(item); continue; }
      if (item && item.rules && !applyRules(item.rules)) continue;
      const val = item.value;
      if (Array.isArray(val)) jvmArgs.push(...val);
      else if (val) jvmArgs.push(val);
    }
    gameArgs = versionJson.arguments.game || [];
  } else if (versionJson.minecraftArguments) {
    // 旧版（1.12-）字符串形式
    gameArgs = versionJson.minecraftArguments.split(' ');
  }

  // 替换变量
  const jvmFinal = jvmArgs.map((a) => substitute(a, vars)).filter(Boolean);
  const gameFinal = gameArgs.map((a) => (typeof a === 'string' ? substitute(a, vars) : null)).filter((a) => a !== null && a !== undefined);

  // 强制内存 + 库目录
  const jvmBase = [];
  jvmBase.push(`-Xmx${memory}M`);
  if (fs.existsSync(nativesDir)) jvmBase.push(`-Djava.library.path=${nativesDir}`);

  const mainClass = versionJson.mainClass || 'net.minecraft.client.main.Main';
  const command = [java.javaPath, ...jvmBase, ...jvmFinal, mainClass, ...gameFinal];
  return { command, javaPath: java.javaPath, mainClass, gameDir };
}

/* ---------------- 启动 ---------------- */
function launchGame(opts = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { command, gameDir } = await buildCommand(opts.versionId, opts);
      const logsDir = path.join(gameDir, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const logPath = path.join(logsDir, `latest-${Date.now()}.log`);
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      logStream.write(`[Nerity] 启动命令: ${command.join(' ')}\n`);

      // detached：游戏独立运行，关闭启动器不影响游戏
      const proc = spawn(command[0], command.slice(1), {
        cwd: gameDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false
      });
      proc.stdout.on('data', (d) => logStream.write(d));
      proc.stderr.on('data', (d) => logStream.write(d));
      proc.on('error', (err) => reject(err));
      proc.on('close', () => logStream.end());
      proc.unref();
      resolve({ ok: true, pid: proc.pid, logPath });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { loginOffline, getAuthState, listLocalVersions, buildCommand, launchGame };
