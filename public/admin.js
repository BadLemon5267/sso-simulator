'use strict';
/* ============ SSO Simulator 管理控制台 ============ */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

const S = {
  tab: 'config',
  users: [], roles: [], configs: [], settings: {},
  cfg: null,            // 当前编辑中的配置（副本）
  cfgId: null,
  logTimer: null,
};

/* ---------- 基础工具 ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let j = {};
  try { j = await res.json(); } catch { /* 非 JSON */ }
  if (res.status === 401 && !path.includes('/api/admin/login')) { showLogin(); throw new Error(j.message || '未登录'); }
  if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
  return j;
}

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
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast('已复制到剪贴板'),
    () => toast('复制失败', true),
  );
}

/* ---------- 模态框 ---------- */
function modal({ title, body, footer, wide, onClose }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x">✕</button></div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  $('.modal-body', mask).appendChild(body);
  if (footer) $('.modal-foot', mask).appendChild(footer);
  const close = () => { mask.remove(); onClose && onClose(); };
  $('.x', mask).onclick = close;
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  $('#modalRoot').appendChild(mask);
  return { close, el: mask };
}

/* ---------- KV 编辑器 ---------- */
function kvEditor(container, arr, opts = {}) {
  const keyPH = opts.keyPH || '名称';
  const valPH = opts.valPH || '值，支持 {{username}} 模板';
  const render = () => {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'kv-editor';
    arr.forEach((row, i) => {
      const r = document.createElement('div');
      r.className = 'kv-row';
      r.innerHTML = `<input class="k" placeholder="${esc(keyPH)}"><input class="v" placeholder="${esc(valPH)}"><button class="del" title="删除">✕</button>`;
      $('.k', r).value = row.name || '';
      $('.v', r).value = row.value || '';
      $('.k', r).oninput = (e) => { arr[i].name = e.target.value.trim(); };
      $('.v', r).oninput = (e) => { arr[i].value = e.target.value; };
      $('.del', r).onclick = () => { arr.splice(i, 1); render(); };
      box.appendChild(r);
    });
    const add = document.createElement('div');
    add.className = 'kv-add';
    const btn = document.createElement('button');
    btn.className = 'btn sm ghost';
    btn.textContent = `＋ 添加${opts.label || ''}`;
    btn.onclick = () => { arr.push({ name: '', value: '' }); render(); };
    add.appendChild(btn);
    box.appendChild(add);
    container.appendChild(box);
  };
  render();
}

/* ---------- 响应参数映射编辑器（响应字段 ← 用户属性 / 固定值） ---------- */
const USER_ATTR_OPTIONS = ['username', 'userId', 'displayName', 'email', 'phone', 'department', 'position', 'roles', 'roleNames', 'permissions'];
const CONST_OPTION = '__const__';

function respMapEditor(container, arr) {
  const render = () => {
    container.innerHTML = '';
    arr.forEach((row, i) => {
      if (row.kind !== 'const') row.kind = 'user';
      const r = document.createElement('div');
      r.className = 'resp-row';
      const selOpts = USER_ATTR_OPTIONS.map((a) => `<option value="${a}">${a}</option>`).join('')
        + `<option value="${CONST_OPTION}">固定值…</option>`;
      r.innerHTML = `
        <input class="tgt" placeholder="响应字段 $.data.realName">
        <select class="kind">${selOpts}</select>
        <input class="val" placeholder="固定值（true / 0 / ok…）">
        <button class="del" title="删除">✕</button>`;
      $('.tgt', r).value = row.target || '';
      $('.kind', r).value = row.kind === 'const' ? CONST_OPTION : (row.source || USER_ATTR_OPTIONS[0]);
      const syncVal = () => {
        const isConst = $('.kind', r).value === CONST_OPTION;
        $('.val', r).disabled = !isConst;
        $('.val', r).value = isConst ? (row.value ?? '') : '';
      };
      $('.tgt', r).oninput = (e) => { arr[i].target = e.target.value.trim(); };
      $('.kind', r).onchange = (e) => {
        if (e.target.value === CONST_OPTION) { arr[i].kind = 'const'; arr[i].source = ''; }
        else { arr[i].kind = 'user'; arr[i].source = e.target.value; arr[i].value = ''; }
        syncVal();
      };
      $('.val', r).oninput = (e) => { arr[i].value = e.target.value; };
      $('.del', r).onclick = () => { arr.splice(i, 1); render(); };
      syncVal();
      container.appendChild(r);
    });
    const btn = document.createElement('button');
    btn.className = 'btn sm ghost';
    btn.textContent = '＋ 添加响应字段';
    btn.onclick = () => { arr.push({ kind: 'user', source: 'username', value: '', target: '' }); render(); };
    container.appendChild(btn);
  };
  render();
}

/* ============================================================
   登录
   ============================================================ */
function showLogin() {
  $('#appView').style.display = 'none';
  $('#loginView').style.display = 'block';
  $('#loginPassword').focus();
}
function showApp() {
  $('#loginView').style.display = 'none';
  $('#appView').style.display = 'block';
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').style.display = 'none';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('#loginPassword').value } });
    await boot();
  } catch (err) {
    const box = $('#loginError');
    box.textContent = err.message;
    box.style.display = 'block';
  }
});
$('#btnAdminLogout').onclick = async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* 忽略 */ }
  location.reload();
};

async function boot() {
  showApp();
  await Promise.all([loadUsers(), loadRoles(), loadConfigs(), loadSettings(), loadMenus()]);
  renderUsers(); // 角色全部就绪后重渲染一次（避免徽标显示角色 ID）
  switchTab(S.tab);
}

/* ============================================================
   Tab 切换
   ============================================================ */
$$('#nav .nav-item').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  S.tab = tab;
  $$('#nav .nav-item').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => (p.style.display = 'none'));
  $(`#tab-${tab}`).style.display = 'block';
  if (tab === 'integrate') renderIntegrate();
  if (tab === 'logs') { renderLogs(); startLogTimer(); } else { stopLogTimer(); }
  if (tab === 'settings') fillSettings();
}

/* ============================================================
   用户接口配置
   ============================================================ */
async function loadConfigs() {
  const { data } = await api('/api/admin/configs');
  S.configs = data;
  if (!S.cfgId && data.length) S.cfgId = data[0].id;
  renderCfgList();
  renderCfgEditor();
}
function renderCfgList() {
  const el = $('#cfgList');
  if (!S.configs.length) {
    el.innerHTML = '<div class="empty"><div class="big">🔌</div>还没有接口配置<br>点击右上角「新增配置」或「上传 OpenAPI」</div>';
    return;
  }
  el.innerHTML = '';
  S.configs.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'cfg-item' + (c.id === S.cfgId ? ' on' : '');
    item.innerHTML = `
      <div class="ops"></div>
      <div class="nm"><span class="m-chip m-${esc(c.method)}">${esc(c.method)}</span>${esc(c.name)}
        ${c.enabled ? '<span class="badge green" style="margin-left:auto">提供中</span>' : '<span class="badge gray" style="margin-left:auto">停用</span>'}</div>
      <div class="url">${esc(c.path)}</div>`;
    item.onclick = (e) => {
      if (e.target.closest('.ops')) return;
      S.cfgId = c.id;
      renderCfgList();
      renderCfgEditor();
    };
    const ops = $('.ops', item);
    const toggle = document.createElement('button');
    toggle.className = 'btn sm ghost';
    toggle.textContent = c.enabled ? '停用' : '启用';
    toggle.onclick = async (e) => {
      e.stopPropagation();
      try {
        const { data } = await api(`/api/admin/configs/${c.id}`, { method: 'PUT', body: { ...c, enabled: !c.enabled } });
        toast(data.enabled ? `已启用「${data.name}」，子系统可调用 ${location.origin}${data.path}` : `已停用「${data.name}」`);
        await loadConfigs();
      } catch (err) { toast(err.message, true); }
    };
    ops.appendChild(toggle);
    el.appendChild(item);
  });
}

function renderCfgEditor() {
  const el = $('#cfgEditor');
  const cfg = S.configs.find((c) => c.id === S.cfgId);
  if (!cfg) {
    el.innerHTML = '<div class="empty"><div class="big">📋</div>选择左侧配置，或新增一个</div>';
    return;
  }
  S.cfg = JSON.parse(JSON.stringify(cfg));
  el.innerHTML = `
    <div class="row-2" style="grid-template-columns:1fr 130px 110px">
      <div class="field"><label>配置名称</label><input type="text" id="cfgName"></div>
      <div class="field"><label>请求方式</label>
        <select id="cfgMethod">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => `<option>${m}</option>`).join('')}</select></div>
      <div class="field"><label>状态</label>
        <label class="switch" style="margin-top:9px"><input type="checkbox" id="cfgEnabled"><span class="track"></span><span class="lbl">启用</span></label></div>
    </div>
    <div class="field"><label>服务路径（模拟器在本地提供该接口）</label>
      <input type="text" id="cfgPath" style="font-family:var(--mono);font-size:12.5px">
      <div class="hint">照抄平台方的接口路径即可，如 <code>/TsmAas/resources/client/login/userInfo/{principal}</code>；
        <code>{参数名}</code> 占位符与下方「地址参数」对应——<b>标准用法是子系统把登录回传的 ticket 填在这里</b>（如 <code>/userInfo/ST-xxxx</code>），模拟器按票据解析用户；给用户名也能查（调试兜底）</div>
      <div class="hint" style="margin-top:6px">完整调用地址：<span class="mono" id="cfgFullUrl" style="word-break:break-all"></span>
        <a id="cfgCopyUrl" style="cursor:pointer;margin-left:6px">复制</a></div></div>

    <div class="form-section"><h4>请求头 <span class="cnt">${S.cfg.headers.length} 项 · 强制校验：未携带或不匹配返回 403</span></h4><div id="edHeaders"></div>
      <div class="hint" style="margin-top:8px">模拟真实平台"先验应用身份、再验票据"：子系统请求缺这些头会被拒绝。<b>值留空=仅要求存在；填值=精确匹配</b>。无需校验就删除对应行。</div></div>
    <div class="form-section"><h4>地址参数（Path） <span class="cnt">${S.cfg.pathParams.length} 项</span></h4><div id="edPath"></div></div>
    <div class="form-section"><h4>请求参数（Query） <span class="cnt">${S.cfg.queryParams.length} 项 · 预期</span></h4><div id="edQuery"></div></div>

    <div class="form-section"><h4>响应参数 <span class="cnt">${S.cfg.responseMapping.length} 条 · 定义模拟器返回的响应结构</span></h4>
      <div id="edMap"></div>
      <div class="hint" style="margin-top:8px">每行 = 响应 JSON 里的一个字段：<b>字段路径</b>（如 <code>$.data.realName</code>）取
        <b>用户属性</b>（用户/角色管理里维护的数据）或<b>固定值</b>（如 <code>true</code>、<code>0</code>、<code>ok</code>）。
        照着平台接口的真实返回格式搭出来，子系统无需任何改动</div></div>

    <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
      <button class="btn primary" id="btnCfgSave">保存配置</button>
      <button class="btn" id="btnCfgTest">响应预览</button>
      <span style="flex:1"></span>
      <button class="btn danger" id="btnCfgDelete">删除</button>
    </div>`;

  const syncFullUrl = () => {
    let p = $('#cfgPath').value.trim();
    for (const pp of S.cfg.pathParams) {
      if (pp.name) p = p.split(`{${pp.name}}`).join(`{${pp.name}}`);
    }
    $('#cfgFullUrl').textContent = location.origin + (p || '（待填写路径）');
  };
  $('#cfgName').value = S.cfg.name;
  $('#cfgMethod').value = S.cfg.method;
  $('#cfgEnabled').checked = S.cfg.enabled;
  $('#cfgPath').value = S.cfg.path;
  $('#cfgPath').oninput = () => { S.cfg.path = $('#cfgPath').value.trim(); syncFullUrl(); };
  $('#cfgCopyUrl').onclick = () => copyText($('#cfgFullUrl').textContent);
  syncFullUrl();
  kvEditor($('#edHeaders'), S.cfg.headers, { label: '请求头', keyPH: 'Header 名', valPH: '留空=仅要求存在；填值=精确匹配' });
  kvEditor($('#edPath'), S.cfg.pathParams, { label: '地址参数', keyPH: '占位符名', valPH: '示例值，如 zhangsan' });
  kvEditor($('#edQuery'), S.cfg.queryParams, { label: '请求参数', keyPH: '参数名', valPH: '示例值' });
  respMapEditor($('#edMap'), S.cfg.responseMapping);

  $('#btnCfgSave').onclick = saveCfg;
  $('#btnCfgTest').onclick = () => testModal();
  $('#btnCfgDelete').onclick = async () => {
    if (!confirm(`确认删除配置「${S.cfg.name}」？`)) return;
    try {
      await api(`/api/admin/configs/${S.cfg.id}`, { method: 'DELETE' });
      S.cfgId = null;
      await loadConfigs();
      toast('已删除');
    } catch (err) { toast(err.message, true); }
  };
}

async function saveCfg() {
  S.cfg.name = $('#cfgName').value.trim();
  S.cfg.method = $('#cfgMethod').value;
  S.cfg.enabled = $('#cfgEnabled').checked;
  S.cfg.path = $('#cfgPath').value.trim();
  try {
    const { data } = await api(`/api/admin/configs/${S.cfg.id}`, { method: 'PUT', body: S.cfg });
    S.cfgId = data.id;
    toast('配置已保存' + (data.enabled ? `，子系统调用地址：${location.origin}${data.path}` : ''));
    await loadConfigs();
  } catch (err) { toast(err.message, true); }
}

$('#btnAddConfig').onclick = async () => {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>配置名称</label><input id="ncName" placeholder="例如：Tsm单点登录"></div>
    <div class="field"><label>服务路径（平台方的接口路径）</label><input id="ncPath" placeholder="/TsmAas/resources/client/login/userInfo/{principal}" style="font-family:var(--mono);font-size:12.5px"></div>
    <div class="row-2">
      <div class="field"><label>请求方式</label><select id="ncMethod"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></div>
      <div class="field"><label>用户名占位符示例值</label><input id="ncUser" placeholder="zhangsan" style="font-family:var(--mono)"></div>
    </div>`;
  const foot = document.createElement('div');
  foot.innerHTML = '<button class="btn">取消</button> <button class="btn primary">创建</button>';
  const m = modal({ title: '新增接口配置', body, footer: foot });
  foot.querySelectorAll('button')[0].onclick = m.close;
  foot.querySelectorAll('button')[1].onclick = async () => {
    const path = $('#ncPath', body).value.trim();
    const pathName = (path.match(/\{(\w+)\}/) || [])[1];
    const pp = [];
    if (pathName) pp.push({ name: pathName, value: $('#ncUser', body).value.trim() || 'zhangsan' });
    try {
      const { data } = await api('/api/admin/configs', {
        method: 'POST',
        body: {
          name: $('#ncName', body).value.trim(), path,
          method: $('#ncMethod', body).value, headers: [], pathParams: pp,
          queryParams: [], responseMapping: [], enabled: false,
        },
      });
      m.close();
      S.cfgId = data.id;
      await loadConfigs();
      toast('已创建，请继续完善响应参数（按平台真实返回格式）');
    } catch (err) { toast(err.message, true); }
  };
};

/* ---------- 响应预览（本地渲染，无外部请求） ---------- */
function testModal() {
  if (!S.cfg) return;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-2" style="grid-template-columns:1fr auto">
      <div class="field"><label>以该用户渲染响应</label><select id="testUser"></select></div>
      <div class="field"><label>&nbsp;</label><button class="btn primary" id="testRun">预览</button></div>
    </div>
    <div id="testResult"></div>`;
  const sel = $('#testUser', body);
  S.users.filter((u) => u.enabled).forEach((u) => {
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = `${u.username}（${u.displayName || u.username}）`;
    sel.appendChild(o);
  });
  const m = modal({ title: `响应预览 · ${S.cfg.name}`, body, wide: true });
  const run = async () => {
    const out = $('#testResult', body);
    out.innerHTML = '<div class="empty">渲染中…</div>';
    try {
      const { data } = await api(`/api/admin/configs/${S.cfg.id}/test`, { method: 'POST', body: { userId: sel.value } });
      renderTestResult(out, data);
    } catch (err) {
      out.innerHTML = `<div class="login-error">${esc(err.message)}</div>`;
    }
  };
  $('#testRun', body).onclick = run;
  run();
}

function renderTestResult(out, d) {
  out.innerHTML = `
    <div class="form-section" style="margin-top:0"><h4>标准调用方式：携带登录回传的 ticket <span class="cnt">已现场签发，${d.ticketTtlSeconds || 60}s 内有效</span></h4>
      <div class="codeblock"><span class="k">${esc(d.request.method)}</span> ${esc(d.ticketUrl)}</div>
      ${(d.request.headers || []).length ? `<div class="hint" style="margin-top:6px">必需请求头（未携带或不匹配将被模拟器 403 拒绝）：<span class="mono">${d.request.headers.map((h) => esc(`${h.name}: ${h.value || '（任意值）'}`)).join('、')}</span></div>` : ''}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" id="copyCurlTicket">复制 curl（按 ticket）</button>
        <a class="btn sm ghost" href="${esc(d.ticketUrl)}" target="_blank">直接试调 →</a>
      </div>
      <div class="hint" style="margin-top:6px">子系统登录后拿到的 <span class="token-chip" style="font-size:11px">${esc(d.ticket)}</span> 就这样携带：路径占位符、query（?ticket=）、Header（ticket / Bearer）、请求体均可</div></div>
    <div class="form-section"><h4>调试兜底：按用户名调用</h4>
      <div class="codeblock"><span class="k">${esc(d.request.method)}</span> ${esc(d.request.url)}</div>
      <div style="margin-top:8px"><button class="btn sm" id="copyCurl">复制 curl（按用户名）</button></div></div>
    <div class="form-section"><h4>模拟器返回的响应（本地用户数据渲染）</h4>
      <div class="codeblock">${esc(JSON.stringify(d.response, null, 2))}</div></div>`;
  $('#copyCurl', out).onclick = () => copyText(d.curl);
  $('#copyCurlTicket', out).onclick = () => copyText(d.curlTicket);
}

/* ---------- OpenAPI 上传 / 导入 ---------- */
$('#btnOpenapi').onclick = () => {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-2" style="grid-template-columns:1fr 1fr;align-items:end;margin-bottom:12px">
      <div class="field" style="margin:0"><label>上传规范文件（JSON / YAML）</label><input type="file" id="oaFile" accept=".json,.yaml,.yml,text/json,text/yaml" style="padding:6px"></div>
      <button class="btn" id="oaParse2">解析文本 ↓</button>
    </div>
    <div class="field"><label>或直接粘贴 OpenAPI / Swagger 内容</label>
      <textarea id="oaText" style="min-height:150px" placeholder='{"openapi":"3.0.0", ...}'></textarea></div>
    <div id="oaResult"></div>`;
  const foot = document.createElement('div');
  const m = modal({ title: '上传 OpenAPI 规范', body, footer: foot, wide: true });
  $('#oaFile', body).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#oaText', body).value = await f.text();
    parse();
  });
  $('#oaParse2', body).onclick = parse;

  async function parse() {
    const out = $('#oaResult', body);
    const text = $('#oaText', body).value.trim();
    if (!text) return toast('请先选择文件或粘贴内容', true);
    out.innerHTML = '<div class="empty">解析中…</div>';
    try {
      const { data } = await api('/api/admin/openapi/parse', { method: 'POST', body: { text } });
      out.innerHTML = `
        <div class="form-section" style="margin-top:4px"><h4>${esc(data.info.title)} <span class="cnt">${esc(data.info.version)} · ${data.operations.length} 个操作</span></h4></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th style="width:80px">方法</th><th>路径</th><th>说明</th><th style="width:80px"></th></tr></thead>
        <tbody>${data.operations.map((o) => `<tr>
          <td><span class="m-chip m-${esc(o.method)}">${esc(o.method)}</span></td>
          <td class="mono" style="font-size:12px">${esc(o.path)}</td>
          <td style="color:var(--ink-2)">${esc(o.summary || '')}</td>
          <td><button class="btn sm primary" data-m="${esc(o.method)}" data-p="${esc(o.path)}">导入</button></td>
        </tr>`).join('')}</tbody></table></div>`;
      $$('button[data-p]', out).forEach((btn) => {
        btn.onclick = async () => {
          try {
            const { data: cfg } = await api('/api/admin/openapi/import', {
              method: 'POST', body: { text, method: btn.dataset.m, path: btn.dataset.p },
            });
            m.close();
            S.cfgId = cfg.id;
            await loadConfigs();
            toast(`已导入「${cfg.name}」，已自动生成建议映射，请检查后启用`);
          } catch (err) { toast(err.message, true); }
        };
      });
    } catch (err) {
      out.innerHTML = `<div class="login-error">${esc(err.message)}</div>`;
    }
  }
};

/* ============================================================
   用户管理
   ============================================================ */
async function loadUsers() {
  const { data } = await api('/api/admin/users');
  S.users = data;
  renderUsers();
}
function renderUsers() {
  const kw = ($('#userSearch').value || '').toLowerCase();
  const roleById = Object.fromEntries(S.roles.map((r) => [r.id, r]));
  const rows = S.users.filter((u) =>
    !kw || [u.username, u.displayName, u.department].some((v) => (v || '').toLowerCase().includes(kw)));
  const tb = $('#userTbody');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty">没有匹配的用户</div></td></tr>';
    return;
  }
  tb.innerHTML = rows.map((u) => `
    <tr>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.displayName || '—')}</td>
      <td>${esc(u.department || '—')}</td>
      <td>${(u.roleIds || []).map((id) => `<span class="badge blue">${esc(roleById[id]?.name || id)}</span>`).join(' ') || '<span style="color:var(--ink-3)">—</span>'}</td>
      <td>${u.enabled ? '<span class="badge green"><span class="dot green"></span>启用</span>' : '<span class="badge red"><span class="dot red"></span>禁用</span>'}</td>
      <td>
        <button class="btn sm" data-act="edit" data-id="${u.id}">编辑</button>
        <button class="btn sm ghost" data-act="toggle" data-id="${u.id}">${u.enabled ? '禁用' : '启用'}</button>
        <button class="btn sm danger" data-act="del" data-id="${u.id}">删除</button>
      </td>
    </tr>`).join('');
  $$('#userTbody button[data-act]').forEach((btn) => {
    const u = S.users.find((x) => x.id === btn.dataset.id);
    btn.onclick = async () => {
      if (btn.dataset.act === 'edit') return userModal(u);
      if (btn.dataset.act === 'toggle') {
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { enabled: !u.enabled } });
          await loadUsers();
        } catch (err) { toast(err.message, true); }
      }
      if (btn.dataset.act === 'del') {
        if (!confirm(`确认删除用户「${u.username}」？`)) return;
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
          await loadUsers();
          toast('已删除');
        } catch (err) { toast(err.message, true); }
      }
    };
  });
}
$('#userSearch').oninput = renderUsers;
$('#btnAddUser').onclick = () => userModal(null);

function userModal(user) {
  const isEdit = !!user;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-2">
      <div class="field"><label>用户名 *</label><input id="uUsername" placeholder="登录账号"></div>
      <div class="field"><label>密码 ${isEdit ? '（留空则不修改）' : '*'}</label><input id="uPassword" type="text" placeholder="${isEdit ? '••••••' : '登录密码'}"></div>
    </div>
    <div class="row-2">
      <div class="field"><label>姓名 / 显示名</label><input id="uDisplay" ${isEdit ? `value="${esc(user.displayName)}"` : ''}></div>
      <div class="field"><label>邮箱</label><input id="uEmail" ${isEdit ? `value="${esc(user.email)}"` : ''}></div>
    </div>
    <div class="row-2">
      <div class="field"><label>手机号</label><input id="uPhone" ${isEdit ? `value="${esc(user.phone)}"` : ''}></div>
      <div class="field"><label>部门</label><input id="uDept" ${isEdit ? `value="${esc(user.department)}"` : ''} placeholder="如：研发部/平台组"></div>
    </div>
    <div class="row-2">
      <div class="field"><label>职位</label><input id="uPosition" ${isEdit ? `value="${esc(user.position)}"` : ''}></div>
      <div class="field"><label>状态</label>
        <label class="switch" style="margin-top:9px"><input type="checkbox" id="uEnabled" ${!isEdit || user.enabled ? 'checked' : ''}><span class="track"></span><span class="lbl">启用登录</span></label></div>
    </div>
    <div class="field"><label>角色</label><div id="uRoles" style="display:flex;gap:14px;flex-wrap:wrap;padding-top:6px"></div></div>`;
  const roleBox = $('#uRoles', body);
  S.roles.forEach((r) => {
    const lab = document.createElement('label');
    lab.className = 'switch';
    lab.innerHTML = `<input type="checkbox" value="${esc(r.id)}" ${isEdit && (user.roleIds || []).includes(r.id) ? 'checked' : ''}><span class="track"></span><span class="lbl">${esc(r.name)}（${esc(r.code)}）</span>`;
    roleBox.appendChild(lab);
  });
  const foot = document.createElement('div');
  foot.innerHTML = '<button class="btn">取消</button> <button class="btn primary">保存</button>';
  const m = modal({ title: isEdit ? `编辑用户 · ${user.username}` : '新增用户', body, footer: foot });
  if (isEdit) $('#uUsername', body).value = user.username;
  foot.querySelectorAll('button')[0].onclick = m.close;
  foot.querySelectorAll('button')[1].onclick = async () => {
    const payload = {
      username: $('#uUsername', body).value.trim(),
      displayName: $('#uDisplay', body).value.trim(),
      email: $('#uEmail', body).value.trim(),
      phone: $('#uPhone', body).value.trim(),
      department: $('#uDept', body).value.trim(),
      position: $('#uPosition', body).value.trim(),
      enabled: $('#uEnabled', body).checked,
      roleIds: $$('input:checked', roleBox).map((i) => i.value),
    };
    try {
      if (isEdit) {
        if ($('#uPassword', body).value) payload.password = $('#uPassword', body).value;
        await api(`/api/admin/users/${user.id}`, { method: 'PUT', body: payload });
      } else {
        payload.password = $('#uPassword', body).value;
        await api('/api/admin/users', { method: 'POST', body: payload });
      }
      m.close();
      await loadUsers();
      toast('已保存');
    } catch (err) { toast(err.message, true); }
  };
}

/* ============================================================
   角色管理
   ============================================================ */
async function loadRoles() {
  const { data } = await api('/api/admin/roles');
  S.roles = data;
  renderRoles();
}
function renderRoles() {
  const tb = $('#roleTbody');
  if (!S.roles.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty">还没有角色</div></td></tr>';
    return;
  }
  tb.innerHTML = S.roles.map((r) => `
    <tr>
      <td><span class="badge blue mono">${esc(r.code)}</span></td>
      <td><b>${esc(r.name)}</b></td>
      <td style="color:var(--ink-2)">${esc(r.description || '—')}</td>
      <td>${(r.permissions || []).map((p) => `<span class="badge gray mono" style="font-size:11px">${esc(p)}</span>`).join(' ') || '—'}</td>
      <td class="num">${r.userCount ?? 0}</td>
      <td>
        <button class="btn sm" data-act="edit" data-id="${r.id}">编辑</button>
        <button class="btn sm danger" data-act="del" data-id="${r.id}">删除</button>
      </td>
    </tr>`).join('');
  $$('#roleTbody button[data-act]').forEach((btn) => {
    const r = S.roles.find((x) => x.id === btn.dataset.id);
    btn.onclick = async () => {
      if (btn.dataset.act === 'edit') return roleModal(r);
      if (!confirm(`确认删除角色「${r.name}」？会同时从所有用户移除。`)) return;
      try {
        await api(`/api/admin/roles/${r.id}`, { method: 'DELETE' });
        await Promise.all([loadRoles(), loadUsers()]);
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    };
  });
}
$('#btnAddRole').onclick = () => roleModal(null);

function roleModal(role) {
  const isEdit = !!role;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-2">
      <div class="field"><label>角色编码 *</label><input id="rCode" placeholder="如：manager" style="font-family:var(--mono)"></div>
      <div class="field"><label>角色名称 *</label><input id="rName" ${isEdit ? `value="${esc(role.name)}"` : ''}></div>
    </div>
    <div class="field"><label>描述</label><input id="rDesc" ${isEdit ? `value="${esc(role.description)}"` : ''}></div>
    <div class="field"><label>权限标识</label><input id="rPerms" ${isEdit ? `value="${esc((role.permissions || []).join(', '))}"` : ''} placeholder="逗号分隔，如：read, write, approve">
      <div class="hint">会合并到票据校验返回的 permissions 属性</div></div>`;
  const foot = document.createElement('div');
  foot.innerHTML = '<button class="btn">取消</button> <button class="btn primary">保存</button>';
  const m = modal({ title: isEdit ? `编辑角色 · ${role.name}` : '新增角色', body, footer: foot });
  if (isEdit) $('#rCode', body).value = role.code;
  foot.querySelectorAll('button')[0].onclick = m.close;
  foot.querySelectorAll('button')[1].onclick = async () => {
    const payload = {
      code: $('#rCode', body).value.trim(),
      name: $('#rName', body).value.trim(),
      description: $('#rDesc', body).value.trim(),
      permissions: $('#rPerms', body).value.split(/[,，\s]+/).filter(Boolean),
    };
    try {
      if (isEdit) await api(`/api/admin/roles/${role.id}`, { method: 'PUT', body: payload });
      else await api('/api/admin/roles', { method: 'POST', body: payload });
      m.close();
      await loadRoles();
      toast('已保存');
    } catch (err) { toast(err.message, true); }
  };
}

/* ============================================================
   菜单管理（子系统 iframe 内嵌）
   ============================================================ */
let MENUS_ADMIN = [];
async function loadMenus() {
  const { data } = await api('/api/admin/menus');
  MENUS_ADMIN = data;
  renderMenusAdmin();
}
function renderMenusAdmin() {
  const tb = $('#menuTbody');
  if (!MENUS_ADMIN.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty">还没有子系统菜单<br>新增一个，把子系统提供的页面地址填进来</div></td></tr>';
    return;
  }
  tb.innerHTML = MENUS_ADMIN.map((m) => `
    <tr>
      <td class="num">${m.sort ?? 99}</td>
      <td><b>${esc(m.name)}</b></td>
      <td class="mono" style="font-size:12px;color:var(--ink-2)">${esc(m.url)}</td>
      <td>${m.ticketMode === 'path'
        ? '<span class="badge amber">路径参数</span>'
        : '<span class="badge blue">查询参数</span>'}</td>
      <td>${m.enabled ? '<span class="badge green"><span class="dot green"></span>启用</span>' : '<span class="badge gray">停用</span>'}</td>
      <td>
        <button class="btn sm" data-act="edit" data-id="${m.id}">编辑</button>
        <button class="btn sm ghost" data-act="toggle" data-id="${m.id}">${m.enabled ? '停用' : '启用'}</button>
        <button class="btn sm danger" data-act="del" data-id="${m.id}">删除</button>
      </td>
    </tr>`).join('');
  $$('#menuTbody button[data-act]').forEach((btn) => {
    const m = MENUS_ADMIN.find((x) => x.id === btn.dataset.id);
    btn.onclick = async () => {
      if (btn.dataset.act === 'edit') return menuModal(m);
      if (btn.dataset.act === 'toggle') {
        try {
          await api(`/api/admin/menus/${m.id}`, { method: 'PUT', body: { ...m, enabled: !m.enabled } });
          await loadMenus();
        } catch (err) { toast(err.message, true); }
      }
      if (btn.dataset.act === 'del') {
        if (!confirm(`确认删除菜单「${m.name}」？`)) return;
        try {
          await api(`/api/admin/menus/${m.id}`, { method: 'DELETE' });
          await loadMenus();
          toast('已删除');
        } catch (err) { toast(err.message, true); }
      }
    };
  });
}
$('#btnAddMenu').onclick = () => menuModal(null);

function menuModal(menu) {
  const isEdit = !!menu;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="row-2">
      <div class="field"><label>菜单名称 *</label><input id="mName" placeholder="如：TSM 管理后台"></div>
      <div class="field"><label>排序（小的在前）</label><input id="mSort" type="number" value="${isEdit ? (menu.sort ?? 99) : (MENUS_ADMIN.length + 1)}"></div>
    </div>
    <div class="field"><label>子系统页面地址 *</label>
      <input id="mUrl" placeholder="子系统提供的页面访问 URL，如 http://sub-system:8081/index" style="font-family:var(--mono);font-size:12.5px">
      <div class="hint">门户点击菜单时，会在 iframe 中打开此地址并自动拼上当前用户的登录票据</div></div>
    <div class="row-2">
      <div class="field"><label>票据携带方式</label>
        <select id="mMode">
          <option value="query">查询参数 —— 地址后追加 ?ticket=ST-xxx</option>
          <option value="path">路径参数 —— 地址末尾追加 /ST-xxx（若地址含 {ticket} 则替换占位符）</option>
        </select></div>
      <div class="field"><label>状态</label>
        <label class="switch" style="margin-top:9px"><input type="checkbox" id="mEnabled" ${!isEdit || menu.enabled ? 'checked' : ''}><span class="track"></span><span class="lbl">在门户菜单中显示</span></label></div>
    </div>`;
  if (isEdit) {
    $('#mName', body).value = menu.name;
    $('#mUrl', body).value = menu.url;
    $('#mMode', body).value = menu.ticketMode || 'query';
  }
  const foot = document.createElement('div');
  foot.innerHTML = '<button class="btn">取消</button> <button class="btn primary">保存</button>';
  const m2 = modal({ title: isEdit ? `编辑菜单 · ${menu.name}` : '新增子系统菜单', body, footer: foot });
  foot.querySelectorAll('button')[0].onclick = m2.close;
  foot.querySelectorAll('button')[1].onclick = async () => {
    const payload = {
      name: $('#mName', body).value.trim(),
      url: $('#mUrl', body).value.trim(),
      ticketMode: $('#mMode', body).value,
      sort: Number($('#mSort', body).value) || 99,
      enabled: $('#mEnabled', body).checked,
    };
    try {
      if (isEdit) await api(`/api/admin/menus/${menu.id}`, { method: 'PUT', body: payload });
      else await api('/api/admin/menus', { method: 'POST', body: payload });
      m2.close();
      await loadMenus();
      toast('已保存');
    } catch (err) { toast(err.message, true); }
  };
}

/* ============================================================
   接入信息
   ============================================================ */
function renderIntegrate() {
  const origin = location.origin;
  const row = (method, path, desc) => `
    <div class="endpoint-row">
      <span class="m-chip m-${esc(method)}">${esc(method)}</span>
      <span class="path" data-copy="${esc(origin + path)}">${esc(origin + path)}</span>
      <span class="desc">${esc(desc)}</span>
      <button class="btn sm ghost" data-copy="${esc(origin + path)}">复制</button>
    </div>`;
  const served = S.configs.filter((c) => c.enabled && c.path);
  $('#integrateBody').innerHTML = `
    <div class="card card-pad">
      <h3>用户信息查询接口 <span class="tag">模拟器本地提供（替身），把地址配到子系统即可</span></h3>
      ${served.length ? served.map((c) => row(c.method || 'GET', c.path, `${c.name} · 响应格式见「用户接口」页配置`)).join('')
        : '<div class="empty">尚未启用任何接口配置 —— 到「用户接口」页启用，或照平台返回格式新建一个</div>'}
      <div style="font-size:12.5px;color:var(--ink-3);margin-top:8px"><b>标准用法</b>：子系统携带登录回传的 ticket 调用（路径占位符 / <code>?ticket=</code> / Header <code>ticket</code>、<code>Authorization: Bearer</code> / 请求体均可），模拟器按票据解析用户并返回其信息；直接给用户名也可查（调试兜底）</div>
    </div>
    <div class="card card-pad">
      <h3>CAS 协议（支持 /sso 与 /cas 两个前缀）</h3>
      ${row('GET', '/sso/login?service=' + encodeURIComponent('http://组件地址/callback'), '组件登录入口（回跳参数名可在「设置」自定义：redirect_url / returnUrl…）')}
      ${row('GET', '/sso/serviceValidate?ticket=ST-xxx&service=' + encodeURIComponent('http://组件地址/callback'), 'CAS 2.0/3.0 票据校验（XML，加 &format=JSON 返回 JSON）')}
      ${row('GET', '/sso/validate?ticket=ST-xxx&service=…', 'CAS 1.0 校验（yes/no 纯文本）')}
      ${row('GET', '/api/validate?ticket=ST-xxx&service=…', '通用 JSON 校验（自研系统友好）')}
      ${row('GET', '/sso/logout?service=' + encodeURIComponent('http://组件地址/login'), '登出并跳回组件登录页（退出到组件登录页）')}
    </div>
    <div class="card card-pad">
      <h3>OAuth2 / OIDC</h3>
      ${row('GET', '/oauth2/authorize?client_id=demo&response_type=code&redirect_uri=' + encodeURIComponent('http://组件地址/callback') + '&state=xyz', '授权端点（未登录会先进门户）')}
      ${row('POST', '/oauth2/token', '令牌端点：authorization_code / password 两种 grant')}
      ${row('GET', '/oauth2/userinfo', '用户信息（Authorization: Bearer <access_token>）')}
      ${row('GET', '/.well-known/openid-configuration', 'OIDC 发现文档')}
    </div>
    <div class="card card-pad">
      <h3>响应可用的用户属性 <span class="tag">「用户接口」响应参数取值来源</span></h3>
      <div class="table-wrap" style="box-shadow:none"><table class="tbl">
        <thead><tr><th style="width:180px">属性</th><th>含义</th></tr></thead>
        <tbody>
          <tr><td class="mono">username / userId</td><td>用户名 / 用户 ID（用户管理里维护）</td></tr>
          <tr><td class="mono">displayName</td><td>姓名 / 显示名</td></tr>
          <tr><td class="mono">email / phone</td><td>邮箱 / 手机号</td></tr>
          <tr><td class="mono">department / position</td><td>部门 / 职位</td></tr>
          <tr><td class="mono">roles / roleNames</td><td>角色编码 / 角色名称（数组，角色管理里维护）</td></tr>
          <tr><td class="mono">permissions</td><td>角色权限标识（合并去重后的数组）</td></tr>
          <tr><td class="mono">固定值</td><td>如 <code>success=true</code>、<code>code=0</code> 等协议性字段</td></tr>
        </tbody></table></div>
    </div>`;
  $$('#integrateBody [data-copy]').forEach((el) => {
    if (el.tagName === 'BUTTON') el.onclick = () => copyText(el.dataset.copy);
    else el.title = '点击复制';
  });
}

/* ============================================================
   调试日志
   ============================================================ */
async function renderLogs() {
  let logs = [];
  try { ({ data: logs } = await api('/api/admin/logs')); } catch { return; }
  const tb = $('#logTbody');
  if (!logs.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty">暂无认证请求。<br>用组件系统走一次登录 / 校验流程，这里会记录全部来回。</div></td></tr>';
    return;
  }
  tb.innerHTML = logs.map((l) => {
    const qs = l.query ? '?' + Object.entries(l.query).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v}`).join('&') : '';
    const st = l.status < 300 ? 'green' : l.status < 400 ? 'amber' : 'red';
    return `<tr>
      <td class="num">${esc(new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false }))}</td>
      <td><span class="m-chip m-${esc(l.method)}">${esc(l.method)}</span></td>
      <td class="mono" style="font-size:12px">${esc(l.path + qs)}</td>
      <td><span class="badge ${st === 'green' ? 'green' : st === 'amber' ? 'amber' : 'red'}"${l.note ? ` title="${esc(l.note)}"` : ''}>${l.status}</span></td>
      <td class="num">${l.durationMs}ms</td>
      <td class="num" style="color:var(--ink-3)">${esc((l.ip || '').replace(/^::ffff:/, ''))}</td>
    </tr>`;
  }).join('');
}
function startLogTimer() {
  stopLogTimer();
  if ($('#logAuto').checked) S.logTimer = setInterval(renderLogs, 3000);
}
function stopLogTimer() {
  if (S.logTimer) { clearInterval(S.logTimer); S.logTimer = null; }
}
$('#logAuto').onchange = startLogTimer;
$('#btnLogRefresh').onclick = renderLogs;
$('#btnLogClear').onclick = async () => {
  try { await api('/api/admin/logs/clear', { method: 'POST' }); renderLogs(); } catch (err) { toast(err.message, true); }
};

/* ============================================================
   设置
   ============================================================ */
async function loadSettings() {
  const { data } = await api('/api/admin/settings');
  S.settings = data;
  fillSettings();
}
function fillSettings() {
  const s = S.settings;
  if (!s) return;
  $('#setRedirectParams').value = (s.loginRedirectParams || []).join(', ');
  $('#setTicketParam').value = s.ticketParam || 'ticket';
  $('#setTicketSingleUse').checked = s.ticketSingleUse !== false;
  $('#setLogoutUrl').value = s.defaultLogoutUrl || '';
  $('#setTicketTtl').value = s.ticketTtlSeconds;
  $('#setTokenTtl').value = s.accessTokenTtlSeconds;
}
$('#btnSaveSettings').onclick = async () => {
  try {
    const { data } = await api('/api/admin/settings', {
      method: 'PUT',
      body: {
        loginRedirectParams: $('#setRedirectParams').value.split(/[,，\s]+/).filter(Boolean),
        ticketParam: $('#setTicketParam').value.trim(),
        ticketSingleUse: $('#setTicketSingleUse').checked,
        defaultLogoutUrl: $('#setLogoutUrl').value,
        ticketTtlSeconds: Number($('#setTicketTtl').value),
        accessTokenTtlSeconds: Number($('#setTokenTtl').value),
      },
    });
    S.settings = data;
    toast('设置已保存');
  } catch (err) { toast(err.message, true); }
};

/* ============================================================
   启动
   ============================================================ */
(async function init() {
  try {
    await api('/api/admin/me');
    await boot();
  } catch {
    showLogin();
  }
})();
