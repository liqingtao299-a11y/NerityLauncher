// Nerity 启动器 - 界面逻辑
const api = window.nerity;
const $ = (sel) => document.querySelector(sel);

const state = { config: null, versions: [], local: [], downloading: false };

/* ---------- 导航 ---------- */
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.view).classList.add('active');
  });
});

/* ---------- 工具 ---------- */
function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = cls ? 'launch-status ' + cls : 'launch-status';
}

/* ---------- 初始化 ---------- */
async function init() {
  state.config = await api.getConfig();
  await loadAuth();
  await loadJava();
  await loadVersions();
  await loadLocal();
  fillSettings();
  fillLaunchSelect();
}

async function loadAuth() {
  const auth = await api.getAuthState();
  const name = auth.offlineUsername || '未登录';
  $('#accName').textContent = name;
  $('#accMode').textContent = auth.authMode === 'microsoft' ? '微软账号' : '离线模式';
  $('#avatar').textContent = (name[0] || 'S').toUpperCase();
  $('#offlineName').value = auth.offlineUsername || '';
  $('#cfgName').value = auth.offlineUsername || '';
  $('#accBadge').textContent = auth.authMode === 'microsoft' ? '微软' : '离线';
}

async function loadJava() {
  const j = await api.detectJava();
  const el = $('#javaInfo');
  if (j.found) el.innerHTML = `✔ Java ${j.raw} <span class="muted">(${j.javaPath})</span>`;
  else el.innerHTML = `✘ 未检测到 Java，<a class="muted">请在设置中指定路径</a>`;
  if (j.found) $('#cfgJavaPath').value = j.javaPath;
}

async function loadVersions() {
  const res = await api.fetchVersions();
  if (!res.ok) {
    $('#versionList').innerHTML = `<div class="muted">拉取版本失败：${res.error}</div>`;
    return;
  }
  state.versions = res.data.versions || [];
  renderVersionList();
}

async function loadLocal() {
  state.local = await api.listLocalVersions();
  renderVersionList();
  fillLaunchSelect();
}

function renderVersionList() {
  const filter = $('#typeFilter').value;
  const list = state.versions.filter((v) => filter === 'all' || v.type === filter);
  const box = $('#versionList');
  if (!list.length) { box.innerHTML = '<div class="muted">没有版本</div>'; return; }
  box.innerHTML = '';
  list.slice(0, 120).forEach((v) => {
    const installed = state.local.includes(v.id);
    const item = document.createElement('div');
    item.className = 'version-item';
    const date = (v.releaseTime || '').slice(0, 10);
    item.innerHTML = `
      <div class="vid">${v.id}</div>
      <div class="vmeta">${date}</div>
      <div class="vrow">
        <span class="tag ${v.type === 'release' ? 'release' : ''}">${v.type}</span>
        ${installed ? '<span class="tag installed">已安装</span>' : ''}
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = installed ? '已安装' : '下载';
    if (installed) btn.disabled = true;
    btn.addEventListener('click', () => downloadVersion(v.id));
    item.appendChild(btn);
    box.appendChild(item);
  });
}

function fillLaunchSelect() {
  const sel = $('#launchVersion');
  sel.innerHTML = '';
  if (state.local.length) {
    const g = document.createElement('optgroup');
    g.label = '已下载';
    state.local.forEach((id) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = id;
      g.appendChild(o);
    });
    sel.appendChild(g);
  }
  // 未下载的正式版
  const releases = state.versions.filter((v) => v.type === 'release').slice(0, 10);
  if (releases.length) {
    const g = document.createElement('optgroup');
    g.label = '可下载的正式版';
    releases.forEach((v) => {
      if (state.local.includes(v.id)) return;
      const o = document.createElement('option');
      o.value = v.id; o.textContent = `${v.id}（需下载）`;
      g.appendChild(o);
    });
    sel.appendChild(g);
  }
}

/* ---------- 下载 ---------- */
async function downloadVersion(id) {
  if (state.downloading) return;
  state.downloading = true;
  const prog = $('#dlProgress');
  prog.classList.remove('hidden');
  setBar(0, `开始下载 ${id}…`);
  const off = api.onDownloadProgress((p) => {
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
    setBar(pct, `${p.label}  ${pct}%`);
  });
  const res = await api.downloadVersion(id);
  off();
  if (res.ok) {
    setBar(100, `✔ ${id} 下载完成`);
    await loadLocal();
  } else {
    setBar(0, `下载出现部分错误：${(res.errors || []).slice(0, 3).join('；') || '未知错误'}`);
  }
  setTimeout(() => { prog.classList.add('hidden'); state.downloading = false; }, 3000);
}

function setBar(pct, text) {
  $('#dlBar').style.width = pct + '%';
  $('#dlProgressText').textContent = text;
}

/* ---------- 启动 ---------- */
$('#memSlider').addEventListener('input', () => {
  const v = $('#memSlider').value;
  $('#memVal').textContent = v + ' MB';
});
$('#saveOfflineBtn').addEventListener('click', async () => {
  const name = $('#offlineName').value.trim();
  if (!name) return setStatus($('#launchStatus'), '请输入昵称', 'err');
  await api.loginOffline(name);
  await loadAuth();
  setStatus($('#launchStatus'), `已保存离线账号：${name}`, 'ok');
});

$('#launchBtn').addEventListener('click', async () => {
  const versionId = $('#launchVersion').value;
  const st = $('#launchStatus');
  if (!versionId) return setStatus(st, '请先选择版本', 'err');
  setStatus(st, '正在启动…');
  $('#launchBtn').disabled = true;
  try {
    const res = await api.launch({
      versionId,
      memory: parseInt($('#memSlider').value, 10),
      username: $('#accName').textContent !== '未登录' ? $('#accName').textContent : undefined
    });
    setStatus(st, `✔ 游戏已启动（进程 PID ${res.pid}），日志：${res.logPath}`, 'ok');
  } catch (err) {
    setStatus(st, `启动失败：${err.message || err}`, 'err');
  }
  $('#launchBtn').disabled = false;
});

/* ---------- 版本管理事件 ---------- */
$('#typeFilter').addEventListener('change', renderVersionList);
$('#refreshVersions').addEventListener('click', async () => {
  $('#versionList').innerHTML = '<div class="muted">刷新中…</div>';
  await loadVersions();
  await loadLocal();
});
$('#sourceSel').addEventListener('change', () => {
  // 记录到本地（主进程默认镜像，切换在下载时生效）
  localStorage.setItem('nerity.source', $('#sourceSel').value);
});

/* ---------- 设置 ---------- */
function fillSettings() {
  $('#cfgGameDir').value = state.config.gameDir;
  $('#cfgJavaPath').value = state.config.javaPath || '';
  $('#cfgMemory').value = state.config.memory || 2048;
  $('#cfgName').value = state.config.offlineUsername || '';
  $('#cfgRes').value = state.config.resolution || '';
  $('#cfgJvm').value = state.config.jvmArgs || '';
}
$('#chooseDirBtn').addEventListener('click', async () => {
  const dir = await api.chooseDir('选择游戏目录');
  if (dir) $('#cfgGameDir').value = dir;
});
$('#detectJavaBtn').addEventListener('click', async () => {
  const j = await api.detectJava();
  if (j.found) $('#cfgJavaPath').value = j.javaPath;
  $('#settingsMsg').textContent = j.found ? `检测到 Java ${j.raw}` : '未检测到 Java';
});
$('#saveSettings').addEventListener('click', async () => {
  await api.saveConfig({
    gameDir: $('#cfgGameDir').value.trim() || undefined,
    javaPath: $('#cfgJavaPath').value.trim(),
    memory: parseInt($('#cfgMemory').value, 10) || 2048,
    offlineUsername: $('#cfgName').value.trim(),
    resolution: $('#cfgRes').value.trim(),
    jvmArgs: $('#cfgJvm').value.trim()
  });
  state.config = await api.getConfig();
  await loadAuth();
  $('#settingsMsg').textContent = '✔ 设置已保存';
  setTimeout(() => { $('#settingsMsg').textContent = ''; }, 2500);
});

init();

/* ---------- 模组中心 ---------- */
function fmtCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

async function searchMods() {
  const query = $('#modQuery').value.trim();
  if (!query) { $('#modList').innerHTML = '<div class="muted">请输入模组关键词</div>'; return; }
  const opts = {
    mcVersion: $('#modVersion').value.trim() || undefined,
    loader: $('#modLoader').value || undefined
  };
  $('#modList').innerHTML = '<div class="muted">搜索中…</div>';
  const res = await api.searchMods(query, opts);
  if (!res.ok) { $('#modList').innerHTML = `<div class="muted">搜索失败：${res.error}</div>`; return; }
  renderModList(res.data);
}

function renderModList(hits) {
  const box = $('#modList');
  if (!hits.length) { box.innerHTML = '<div class="muted">没有找到匹配的模组，试试调整关键词或筛选</div>'; return; }
  box.innerHTML = '';
  hits.forEach((h) => {
    const item = document.createElement('div');
    item.className = 'mod-item';
    const icon = h.icon
      ? `<img class="mod-icon" src="${h.icon}" referrerpolicy="no-referrer" alt="" onerror="this.style.visibility='hidden'"/>`
      : `<div class="mod-icon">${(h.title[0] || 'M').toUpperCase()}</div>`;
    item.innerHTML = `
      ${icon}
      <div class="mod-body">
        <div class="mod-title">${h.title}</div>
        <div class="mod-meta">作者：${h.author} · 下载 ${fmtCount(h.downloads)}</div>
        <div class="mod-desc">${h.description}</div>
        <div class="mod-foot">
          <span class="mod-downloads">Modrinth</span>
          <button class="btn dl">下载</button>
        </div>
      </div>
    `;
    const dlBtn = item.querySelector('.dl');
    dlBtn.addEventListener('click', () => downloadMod(h.projectId, h.title, dlBtn));
    box.appendChild(item);
  });
}

async function downloadMod(projectId, title, btn) {
  btn.disabled = true;
  btn.textContent = '获取中…';
  const prog = $('#modDlProgress');
  prog.classList.remove('hidden');
  setModBar(0, `准备下载 ${title}…`);
  const off = api.onDownloadProgress((p) => {
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
    setModBar(pct, `${p.label || title}  ${pct}%`);
  });
  try {
    const res = await api.downloadMod(projectId, {
      mcVersion: $('#modVersion').value.trim() || undefined,
      loader: $('#modLoader').value || undefined
    });
    off();
    if (res && res.ok) {
      setModBar(100, `✔ ${res.fileName} 已下载到 mods 目录`);
      btn.textContent = '已下载';
    } else {
      setModBar(0, `下载失败：${(res && res.error) || '未知错误'}`);
      btn.textContent = '重试';
      btn.disabled = false;
    }
  } catch (err) {
    off();
    setModBar(0, `下载失败：${err.message || err}`);
    btn.textContent = '重试';
    btn.disabled = false;
  }
  setTimeout(() => { prog.classList.add('hidden'); }, 4000);
}

function setModBar(pct, text) {
  $('#modDlBar').style.width = pct + '%';
  $('#modDlText').textContent = text;
}

$('#modSearchBtn').addEventListener('click', searchMods);
$('#modQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(); });
// 默认填入当前所选 MC 版本
$('#launchVersion').addEventListener('change', () => {
  const v = $('#launchVersion').value;
  if (v) $('#modVersion').value = v;
});

/* ---------- Java 自动下载 ---------- */
document.querySelectorAll('[data-java]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const feature = btn.dataset.java;
    btn.disabled = true;
    $('#javaDlStatus').textContent = `正在下载 Java ${feature}…`;
    const off = api.onDownloadProgress((p) => {
      const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
      $('#javaDlStatus').textContent = `${p.label}  ${pct}%`;
    });
    try {
      const res = await api.downloadJava(parseInt(feature, 10));
      off();
      $('#javaDlStatus').textContent = res.ok ? `✔ Java ${feature} 安装完成` : `✘ ${res.error}`;
      if (res.ok) await loadJava();
    } catch (err) {
      off();
      $('#javaDlStatus').textContent = '✘ ' + (err.message || err);
    }
    btn.disabled = false;
  });
});

/* ---------- 微软账号登录 ---------- */
let msPolling = false;
$('#msLoginBtn').addEventListener('click', async () => {
  if (msPolling) return;
  const box = $('#msBox');
  box.classList.remove('hidden');
  $('#msStatus').textContent = '正在获取设备码…';
  const r = await api.msStartLogin();
  if (!r.ok) { $('#msStatus').textContent = '获取失败：' + r.error; return; }
  $('#msCode').textContent = r.userCode;
  $('#msStatus').textContent = '已打开浏览器，请在网页中输入上面的代码完成授权';
  // 打开系统浏览器（主进程 setWindowOpenHandler 会转外部浏览器）
  window.open(r.verificationUri);

  msPolling = true;
  const start = Date.now();
  const timeout = (r.expiresIn || 900) * 1000;
  while (msPolling) {
    await new Promise((res) => setTimeout(res, r.interval * 1000));
    if (Date.now() - start > timeout) {
      $('#msStatus').textContent = '设备码已过期，请重新点击登录';
      msPolling = false;
      break;
    }
    const res = await api.msPoll(r.deviceCode);
    if (res.status === 'done') {
      $('#msStatus').textContent = `✔ 登录成功：${res.profile.name}`;
      msPolling = false;
      await loadAuth();
      setTimeout(() => box.classList.add('hidden'), 4000);
      break;
    } else if (res.status === 'error') {
      $('#msStatus').textContent = '✘ ' + res.error;
      msPolling = false;
      break;
    }
    // authorization_pending -> 继续轮询
  }
});
