'use strict';
/* ============ SSO Simulator 门户 ============ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const qs = new URLSearchParams(location.search);

/* 回跳地址识别：参数名从服务端配置读取（service / redirect_url / returnUrl… 可在管理台设置） */
const PCFG = { redirectParams: ['service'], ticketParam: 'ticket' };
let SERVICE = '';
let SERVICE_PARAM = '';
for (const n of PCFG.redirectParams) {
  const v = qs.get(n);
  if (v) { SERVICE = v; SERVICE_PARAM = n; break; }
}
const CONTINUE = qs.get('continue') || '';
const ERR = qs.get('error') === '1';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
  return j;
}

/* ---------- 登录视图 ---------- */
function showLogin() {
  $('#dashView').style.display = 'none';
  $('#loginView').style.display = 'block';
  if (ERR) {
    const box = $('#loginError');
    box.textContent = '用户名或密码错误';
    box.style.display = 'block';
  }
  if (SERVICE) {
    const box = $('#svcNote');
    box.innerHTML = `组件系统请求登录，完成后将携带 <span class="mono">${esc(PCFG.ticketParam)}</span> 返回（识别参数 <span class="mono">${esc(SERVICE_PARAM)}</span>）：<br><span class="mono" style="font-size:11.5px">${esc(SERVICE)}</span>`;
    box.style.display = 'block';
  }
  fetch('/api/portal/users').then((r) => r.json()).then(({ data }) => {
    if (!data.length) return;
    $('#quickBox').style.display = 'block';
    const chips = $('#quickChips');
    data.slice(0, 8).forEach((u) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-chip';
      chip.innerHTML = `<span class="dot green"></span>${esc(u.displayName || u.username)} <span style="color:var(--ink-3);font-size:11px">${esc(u.username)}</span>`;
      chip.onclick = () => {
        $('#username').value = u.username;
        $('#password').value = '123456';
        $('#loginForm').requestSubmit();
      };
      chips.appendChild(chip);
    });
  }).catch(() => {});
  $('#username').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').style.display = 'none';
  const btn = $('#btnLogin');
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const { data } = await api('/api/portal/login', {
      method: 'POST',
      body: { username: $('#username').value.trim(), password: $('#password').value, service: SERVICE, continue: CONTINUE },
    });
    if (data.redirectUrl) {
      showRedirectBox(data.redirectUrl, data.ticket, data.ticketParam);
      setTimeout(() => { location.href = data.redirectUrl; }, 1500);
    } else {
      await showDash();
    }
  } catch (err) {
    const box = $('#loginError');
    box.textContent = err.message;
    box.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
  }
});

function showRedirectBox(url, ticket, ticketParam) {
  $('#loginView').style.display = 'none';
  $('#dashView').style.display = 'block';
  const tp = ticketParam || 'ticket';
  $('#redirectBox').innerHTML = `
    <div class="redirect-box">
      <div class="t"><span class="dot green"></span>登录成功，正在携带 ${esc(tp)} 返回组件系统…</div>
      ${ticket ? `<div>${esc(tp)}：<span class="token-chip">${esc(ticket)}</span></div>` : ''}
      <div class="url">${esc(url)}</div>
      <a href="${esc(url)}" class="btn sm primary">立即跳转</a>
      <div class="bar"><i></i></div>
    </div>`;
}

/* ---------- 已登录视图 ---------- */
async function showDash() {
  const { data } = await api('/api/portal/me');
  $('#loginView').style.display = 'none';
  $('#dashView').style.display = 'block';
  const u = data.user;
  $('#whoName').textContent = `${u.displayName || u.username}（${u.username}）`;
  $('#hiText').textContent = `你好，${u.displayName || u.username}`;
  $('#metaText').textContent = `${u.department || '未分配部门'}${u.position ? ' · ' + u.position : ''}`;

  const a = data.attributes || {};
  const roles = Array.isArray(a.roles) ? a.roles : [];
  const roleNames = Array.isArray(a.roleNames) ? a.roleNames : [];
  $('#roleRow').innerHTML = roles.length
    ? roles.map((r, i) => `<span class="badge blue">${esc(r)}${roleNames[i] && roleNames[i] !== r ? ' · ' + esc(roleNames[i]) : ''}</span>`).join('')
    : '<span class="badge gray">无角色</span>';

  const grid = $('#attrGrid');
  grid.innerHTML = '';
  for (const [k, v] of Object.entries(a)) {
    const kd = document.createElement('div');
    kd.className = 'k';
    kd.textContent = k;
    const vd = document.createElement('div');
    if (Array.isArray(v)) {
      vd.className = 'v arr';
      vd.innerHTML = v.length ? v.map((x) => `<span class="badge gray">${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join('') : '<span style="color:var(--ink-3)">—</span>';
    } else {
      vd.className = 'v';
      vd.textContent = v === '' || v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : v);
    }
    grid.appendChild(kd);
    grid.appendChild(vd);
  }

  // 已登录状态下带回跳参数访问（如从 /sso/login 跳来且会话仍有效）
  if (SERVICE && !$('#redirectBox').innerHTML.trim()) {
    $('#redirectBox').innerHTML = `
      <div class="redirect-box" style="border-color:#c7cbff;background:var(--accent-soft)">
        <div class="t" style="color:var(--accent)"><span class="dot green"></span>检测到组件登录请求</div>
        <div class="url">${esc(SERVICE)}</div>
        <a class="btn sm primary" href="/sso/login?${encodeURIComponent(SERVICE_PARAM || 'service')}=${encodeURIComponent(SERVICE)}">签发票据并返回组件 →</a>
      </div>`;
  }

  await renderMenus();
}

/* ============================================================
   动态菜单（子系统 iframe 内嵌）
   ============================================================ */
let MENUS = [];
let currentMenu = null;
let loadTimer = null;

async function renderMenus() {
  try {
    const { data } = await api('/api/portal/menus');
    MENUS = data || [];
  } catch { MENUS = []; }
  const box = $('#menuList');
  box.innerHTML = '';
  $('#menuGroup').style.display = MENUS.length ? 'block' : 'none';
  MENUS.forEach((m) => {
    const btn = document.createElement('button');
    btn.className = 'side-item';
    btn.dataset.id = m.id;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5v10"/></svg>
      <span>${esc(m.name)}</span>`;
    btn.onclick = () => openMenu(m);
    box.appendChild(btn);
  });
}

function setActiveSide(el) {
  $$('.portal-side .side-item').forEach((b) => b.classList.remove('on'));
  el.classList.add('on');
}

function showHome() {
  currentMenu = null;
  clearTimeout(loadTimer);
  setActiveSide($('#sideHome'));
  $('#subView').style.display = 'none';
  $('#homeView').style.display = 'block';
}
$('#sideHome').onclick = showHome;

const FRAME_TIMEOUT_MS = 20000;

async function openMenu(menu, isRetry) {
  clearTimeout(loadTimer);
  currentMenu = menu;
  const sideBtn = document.querySelector(`.portal-side .side-item[data-id="${menu.id}"]`);
  if (sideBtn) setActiveSide(sideBtn);
  $('#homeView').style.display = 'none';
  $('#subView').style.display = 'block';

  // 仅展示加载页（子系统登录期间不露出 iframe）
  $('#subName').textContent = menu.name;
  $('#subFrame').style.display = 'none';
  $('#subError').style.display = 'none';
  $('#subLoading').style.display = 'flex';
  $('#subLoadingText').textContent = `正在进入「${menu.name}」并完成登录…`;
  $('#subTicketLine').textContent = '正在为当前用户签发票据…';

  let d;
  try {
    ({ data: d } = await api(`/api/portal/menu-ticket?menuId=${encodeURIComponent(menu.id)}`));
  } catch (err) {
    showLoadError(err.message.includes('登录已过期') || err.message.includes('未登录')
      ? '登录已过期，请重新登录后重试'
      : `无法签发票据：${err.message}`);
    return;
  }

  $('#subTicketLine').innerHTML = `${esc(d.ticketParam)}：<span class="token-chip">${esc(d.ticket)}</span>`;
  $('#subNewTab').href = d.url;
  $('#subErrNewTab').href = d.url;

  const frame = $('#subFrame');
  frame.onload = () => {
    clearTimeout(loadTimer);
    $('#subLoading').style.display = 'none';
    $('#subError').style.display = 'none';
    frame.style.display = 'block';
  };
  // 重试时追加无关参数强制刷新，避免 src 相同不触发加载
  const url = isRetry ? d.url + (d.url.includes('?') ? '&' : '?') + '_r=' + Date.now() : d.url;
  frame.src = url;
  loadTimer = setTimeout(() => {
    if ($('#subLoading').style.display !== 'none') showLoadError('在限定时间内没有收到页面加载完成事件');
  }, FRAME_TIMEOUT_MS);
}

function showLoadError(text) {
  clearTimeout(loadTimer);
  $('#subLoading').style.display = 'none';
  $('#subFrame').style.display = 'none';
  $('#subErrorText').textContent = text;
  $('#subError').style.display = 'flex';
}

$('#subRetry').onclick = () => currentMenu && openMenu(currentMenu, true);
$('#subReload').onclick = () => currentMenu && openMenu(currentMenu, true);

/* ---------- 退出：优先跳配置的组件登录页 ---------- */
$('#btnLogout').onclick = async () => {
  try {
    const { data } = await api('/api/portal/logout', { method: 'POST' });
    if (data.redirect && data.redirect !== '/portal') {
      toast(`已退出，正在返回组件登录页：${data.redirect}`);
      setTimeout(() => { location.href = data.redirect; }, 600);
    } else {
      location.href = '/portal';
    }
  } catch {
    location.href = '/portal';
  }
};

/* ---------- 启动 ---------- */
(async function init() {
  // 先取配置（回跳参数名），再识别 URL 中的回跳地址
  try {
    const { data } = await api('/api/portal/config');
    PCFG.redirectParams = data.redirectParams || PCFG.redirectParams;
    PCFG.ticketParam = data.ticketParam || PCFG.ticketParam;
  } catch { /* 用默认 */ }
  for (const n of PCFG.redirectParams) {
    const v = qs.get(n);
    if (v) { SERVICE = v; SERVICE_PARAM = n; break; }
  }
  try {
    await api('/api/portal/me');
    await showDash();
  } catch {
    showLogin();
  }
})();
