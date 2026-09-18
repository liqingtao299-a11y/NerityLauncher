// Nerity 启动器 - 微软账号登录（Device Code flow + Xbox/Minecraft 令牌交换）
const https = require('https');
const http = require('http');
const querystring = require('querystring');

// Prism Launcher 公开注册的微软 OAuth 客户端 ID（桌面应用，支持 Device Code flow，适配个人账号）
const CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb';
const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const USER_AGENT = 'Nerity-Launcher/0.1';

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = body;
          try { const j = JSON.parse(body); msg = (j.error && j.error.message) || j.error || body; } catch {}
          return reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应解析失败: ' + body.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
  });
}

function postJson(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const lib = url.startsWith('https:') ? https : http;
    const u = new URL(url);
    const req = lib.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': USER_AGENT, 'Accept': 'application/json', ...extraHeaders }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = body;
          try { const j = JSON.parse(body); msg = (j.error && j.error.message) || j.error || body; } catch {}
          return reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应解析失败')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.write(payload);
    req.end();
  });
}

function postForm(url, body) {
  return new Promise((resolve, reject) => {
    const payload = querystring.stringify(body);
    const lib = url.startsWith('https:') ? https : http;
    const u = new URL(url);
    const req = lib.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = body;
          try { const j = JSON.parse(body); msg = (j.error_description) || (j.error && j.error.message) || body; } catch {}
          return reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应解析失败')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.write(payload);
    req.end();
  });
}

/* ---------- 1) 发起设备码登录 ---------- */
async function startDeviceLogin() {
  const r = await postForm(`${AUTH_BASE}/devicecode`, {
    client_id: CLIENT_ID,
    scope: SCOPE
  });
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUri: r.verification_uri,
    verificationUriComplete: r.verification_uri_complete,
    interval: Math.max(r.interval || 5, 3),
    expiresIn: r.expires_in || 900
  };
}

/* ---------- 2) 轮询令牌 ---------- */
async function pollToken(deviceCode) {
  const r = await postForm(`${AUTH_BASE}/token`, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: CLIENT_ID,
    device_code: deviceCode
  });
  if (r.access_token) {
    return {
      status: 'done',
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      expiresIn: r.expires_in
    };
  }
  if (r.error === 'authorization_pending') return { status: 'pending' };
  if (r.error === 'authorization_declined') throw new Error('你取消了授权');
  if (r.error === 'expired_token') throw new Error('设备码已过期，请重新登录');
  throw new Error(r.error_description || r.error || '未知错误');
}

/* ---------- 3) 刷新令牌 ---------- */
async function refreshToken(refreshToken) {
  const r = await postForm(`${AUTH_BASE}/token`, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    scope: SCOPE,
    refresh_token: refreshToken
  });
  if (!r.access_token) throw new Error('刷新令牌失败，请重新登录');
  return { accessToken: r.access_token, refreshToken: r.refresh_token || refreshToken, expiresIn: r.expires_in };
}

/* ---------- 4) Xbox Live -> XSTS -> Minecraft 完整交换 ---------- */
async function completeLogin(msAccessToken, msRefreshToken) {
  // a) Xbox Live
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  const xblToken = xbl.Token;
  const uhs = xbl.DisplayClaims.xui[0].uhs;

  // b) XSTS
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  const xstsToken = xsts.Token;

  // c) Minecraft
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  });

  // d) Profile
  let profile = null;
  try {
    profile = await getJson('https://api.minecraftservices.com/minecraft/profile', {
      Authorization: `Bearer ${mc.access_token}`
    });
  } catch (e) {
    // 无正版账号的场合可能拿不到 profile，但令牌有效
    profile = null;
  }

  return {
    accessToken: mc.access_token,
    refreshToken: msRefreshToken,
    expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
    uuid: profile ? profile.id : '',
    name: profile ? profile.name : 'Player'
  };
}

module.exports = { startDeviceLogin, pollToken, refreshToken, completeLogin, CLIENT_ID };
