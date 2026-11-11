'use strict';
const express = require('express');
const { uid } = require('./util');
const { createSession, clearSession, requireAdmin } = require('./sessions');
const { userAttributes, renderResponse, previewUrl } = require('./userinfo');
const openapi = require('./openapi');
const { DEFAULT_SETTINGS } = require('./store');

/**
 * 管理控制台后端：接口配置 / 用户 / 角色 / 设置 / OpenAPI / 调试日志
 */
module.exports = function createAdminRouter(ctx) {
  const { store, selfBase, logs } = ctx;
  const router = express.Router();

  const ok = (res, data) => res.json({ ok: true, data });
  const fail = (res, status, message) => res.status(status).json({ ok: false, message });

  /* ---------- 登录 ---------- */
  router.post('/api/admin/login', (req, res) => {
    const { password = '' } = req.body || {};
    if (password !== ctx.adminPassword) return fail(res, 401, '管理密码错误');
    createSession(req, res, store, 'admin', 'admin');
    ok(res, { user: 'admin' });
  });
  router.post('/api/admin/logout', (req, res) => {
    clearSession(req, res, store, 'admin');
    ok(res, {});
  });

  /* ---------- 以下接口统一要求管理员会话 ---------- */
  router.use('/api/admin', requireAdmin(store));

  router.get('/api/admin/me', (req, res) => {
    ok(res, { user: 'admin' });
  });

  /* ---------- 用户管理 ---------- */
  const sanitizeUser = (u) => { const { password, ...rest } = u; return rest; };

  router.get('/api/admin/users', (req, res) => {
    ok(res, store.data.users.map(sanitizeUser));
  });

  router.post('/api/admin/users', (req, res) => {
    const { username, password, displayName, email, phone, department, position, roleIds = [], enabled = true } = req.body || {};
    if (!username || !String(username).trim()) return fail(res, 400, '用户名必填');
    if (!password) return fail(res, 400, '密码必填');
    if (store.findUserByUsername(String(username).trim())) return fail(res, 400, '用户名已存在');
    const user = {
      id: uid('u'), username: String(username).trim(), password: String(password),
      displayName: displayName || '', email: email || '', phone: phone || '',
      department: department || '', position: position || '',
      roleIds: roleIds.filter((id) => store.findRole(id)), enabled: !!enabled, createdAt: Date.now(),
    };
    store.data.users.push(user); store.save();
    ok(res, sanitizeUser(user));
  });

  router.put('/api/admin/users/:id', (req, res) => {
    const user = store.findUser(req.params.id);
    if (!user) return fail(res, 404, '用户不存在');
    const b = req.body || {};
    if (b.username && String(b.username).trim() !== user.username) {
      const exist = store.findUserByUsername(String(b.username).trim());
      if (exist && exist.id !== user.id) return fail(res, 400, '用户名已存在');
      user.username = String(b.username).trim();
    }
    if (b.password) user.password = String(b.password);
    user.displayName = b.displayName ?? user.displayName;
    user.email = b.email ?? user.email;
    user.phone = b.phone ?? user.phone;
    user.department = b.department ?? user.department;
    user.position = b.position ?? user.position;
    if (Array.isArray(b.roleIds)) user.roleIds = b.roleIds.filter((id) => store.findRole(id));
    if (b.enabled !== undefined) user.enabled = !!b.enabled;
    store.save();
    ok(res, sanitizeUser(user));
  });

  router.delete('/api/admin/users/:id', (req, res) => {
    const i = store.data.users.findIndex((u) => u.id === req.params.id);
    if (i < 0) return fail(res, 404, '用户不存在');
    store.data.users.splice(i, 1); store.save();
    ok(res, {});
  });

  /* ---------- 角色管理 ---------- */
  router.get('/api/admin/roles', (req, res) => {
    ok(res, store.data.roles.map((r) => ({
      ...r,
      userCount: store.data.users.filter((u) => (u.roleIds || []).includes(r.id)).length,
    })));
  });

  router.post('/api/admin/roles', (req, res) => {
    const { code, name, description = '', permissions = [] } = req.body || {};
    if (!code || !String(code).trim()) return fail(res, 400, '角色编码必填');
    if (store.data.roles.some((r) => r.code === String(code).trim())) return fail(res, 400, '角色编码已存在');
    const role = {
      id: uid('r'), code: String(code).trim(), name: name || String(code).trim(),
      description, permissions: (permissions || []).map(String).filter(Boolean), createdAt: Date.now(),
    };
    store.data.roles.push(role); store.save();
    ok(res, role);
  });

  router.put('/api/admin/roles/:id', (req, res) => {
    const role = store.findRole(req.params.id);
    if (!role) return fail(res, 404, '角色不存在');
    const b = req.body || {};
    if (b.code && String(b.code).trim() !== role.code) {
      if (store.data.roles.some((r) => r.code === String(b.code).trim() && r.id !== role.id)) {
        return fail(res, 400, '角色编码已存在');
      }
      role.code = String(b.code).trim();
    }
    role.name = b.name ?? role.name;
    role.description = b.description ?? role.description;
    if (Array.isArray(b.permissions)) role.permissions = b.permissions.map(String).filter(Boolean);
    store.save();
    ok(res, role);
  });

  router.delete('/api/admin/roles/:id', (req, res) => {
    const i = store.data.roles.findIndex((r) => r.id === req.params.id);
    if (i < 0) return fail(res, 404, '角色不存在');
    store.data.roles.splice(i, 1);
    for (const u of store.data.users) u.roleIds = (u.roleIds || []).filter((id) => id !== req.params.id);
    store.save();
    ok(res, {});
  });

  /* ---------- 子系统菜单管理（iframe 内嵌 + 跳转携带票据） ---------- */
  router.get('/api/admin/menus', (req, res) => {
    ok(res, [...(store.data.menus || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.createdAt - b.createdAt));
  });

  const validateMenu = (b, forCreate) => {
    if (!b.name || !String(b.name).trim()) return { error: '菜单名称必填' };
    const url = String(b.url || '').trim();
    if (!url) return { error: '子系统访问地址必填' };
    if (!/^(https?:\/\/|\/)/i.test(url)) return { error: '地址必须以 http(s):// 或 / 开头' };
    if (forCreate && (store.data.menus || []).some((m) => m.name === String(b.name).trim())) {
      return { error: '菜单名称已存在' };
    }
    return {
      value: {
        name: String(b.name).trim(),
        url,
        ticketMode: b.ticketMode === 'path' ? 'path' : 'query',
        sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 99,
        enabled: b.enabled !== false,
      },
    };
  };

  router.post('/api/admin/menus', (req, res) => {
    const v = validateMenu(req.body || {}, true);
    if (v.error) return fail(res, 400, v.error);
    const item = { id: uid('m'), createdAt: Date.now(), ...v.value };
    store.data.menus.push(item); store.save();
    ok(res, item);
  });

  router.put('/api/admin/menus/:id', (req, res) => {
    const item = (store.data.menus || []).find((m) => m.id === req.params.id);
    if (!item) return fail(res, 404, '菜单不存在');
    const v = validateMenu(req.body || {}, false);
    if (v.error) return fail(res, 400, v.error);
    Object.assign(item, v.value);
    store.save();
    ok(res, item);
  });

  router.delete('/api/admin/menus/:id', (req, res) => {
    const i = (store.data.menus || []).findIndex((m) => m.id === req.params.id);
    if (i < 0) return fail(res, 404, '菜单不存在');
    store.data.menus.splice(i, 1); store.save();
    ok(res, {});
  });

  /* ---------- 用户信息查询接口配置（模拟器本地提供） ---------- */
  router.get('/api/admin/configs', (req, res) => ok(res, store.data.configs));

  router.post('/api/admin/configs', (req, res) => {
    const cfg = validateConfig(req.body || {});
    if (cfg.error) return fail(res, 400, cfg.error);
    const item = { id: uid('cfg'), createdAt: Date.now(), ...cfg.value };
    store.data.configs.push(item); store.save();
    ok(res, item);
  });

  router.put('/api/admin/configs/:id', (req, res) => {
    const item = store.data.configs.find((c) => c.id === req.params.id);
    if (!item) return fail(res, 404, '配置不存在');
    const cfg = validateConfig(req.body || {});
    if (cfg.error) return fail(res, 400, cfg.error);
    Object.assign(item, cfg.value);
    store.save();
    ok(res, item);
  });

  router.delete('/api/admin/configs/:id', (req, res) => {
    const i = store.data.configs.findIndex((c) => c.id === req.params.id);
    if (i < 0) return fail(res, 404, '配置不存在');
    store.data.configs.splice(i, 1); store.save();
    ok(res, {});
  });

  /* ---------- 配置预览测试（本地渲染，并签发一张真实 ticket 供试调） ---------- */
  router.post('/api/admin/configs/:id/test', (req, res) => {
    const cfg = store.data.configs.find((c) => c.id === req.params.id);
    if (!cfg) return fail(res, 404, '配置不存在');
    const user = store.findUser((req.body || {}).userId) || store.data.users.find((u) => u.enabled);
    if (!user) return fail(res, 400, '没有可用的测试用户');
    const attrs = userAttributes(store, user);
    const body = renderResponse(cfg, attrs);

    // 现场签发一张短时 ticket，展示「按票据调用」的标准用法
    const t = store.createTicket({
      type: 'service-ticket', token: require('./util').randomToken('ST'), userId: user.id,
      service: '(preview)', ttlSeconds: store.data.settings.ticketTtlSeconds,
    });
    let ticketPath = String(cfg.path || '');
    for (const pp of cfg.pathParams || []) {
      if (pp.name) ticketPath = ticketPath.split(`{${pp.name}}`).join(encodeURIComponent(t.token));
    }
    const ticketUrl = selfBase + ticketPath;

    const displayUrl = previewUrl(cfg, selfBase, user.username);
    // 生成的 curl 带上配置的必需请求头，复制即可通过校验
    const reqHeaders = (cfg.headers || []).filter((h) => h && h.name);
    const headerArgs = reqHeaders.map((h) => `-H '${h.name}: ${h.value || ''}'`);
    const curlPrefix = `curl ${headerArgs.join(' ')}`.trim() + ' ';
    ok(res, {
      user: { username: user.username, displayName: user.displayName },
      request: { method: cfg.method, url: displayUrl, headers: reqHeaders },
      ticket: t.token,
      ticketUrl,
      ticketTtlSeconds: store.data.settings.ticketTtlSeconds,
      response: body,
      curl: `${curlPrefix}'${displayUrl}'`,
      curlTicket: `${curlPrefix}'${ticketUrl}'`,
    });
  });

  /* ---------- OpenAPI 解析 / 导入 ---------- */
  router.post('/api/admin/openapi/parse', (req, res) => {
    try {
      const doc = openapi.parseSpec((req.body || {}).text || '');
      ok(res, {
        info: { title: doc.info?.title || 'Untitled', version: doc.info?.version || '' },
        operations: openapi.listOperations(doc),
      });
    } catch (e) {
      fail(res, 400, e.message);
    }
  });

  router.post('/api/admin/openapi/import', (req, res) => {
    try {
      const { text = '', method = '', path = '' } = req.body || {};
      const doc = openapi.parseSpec(text);
      const ops = openapi.listOperations(doc).filter((o) => o.method === String(method).toUpperCase() && o.path === path);
      if (!ops.length) return fail(res, 400, `未找到操作 ${method.toUpperCase()} ${path}`);
      const cfg = openapi.toConfig(doc, String(method).toUpperCase(), path);
      const item = { id: uid('cfg'), createdAt: Date.now(), ...cfg };
      store.data.configs.push(item); store.save();
      ok(res, item);
    } catch (e) {
      fail(res, 400, e.message);
    }
  });

  /* ---------- 设置 ---------- */
  router.get('/api/admin/settings', (req, res) => ok(res, store.data.settings));
  router.put('/api/admin/settings', (req, res) => {
    const b = req.body || {};
    const s = store.data.settings;
    if (typeof b.defaultLogoutUrl === 'string') s.defaultLogoutUrl = b.defaultLogoutUrl.trim();
    if (Array.isArray(b.loginRedirectParams)) {
      const names = b.loginRedirectParams.map((x) => String(x).trim()).filter(Boolean);
      if (names.length) s.loginRedirectParams = names;
    }
    if (typeof b.ticketParam === 'string' && b.ticketParam.trim()) s.ticketParam = b.ticketParam.trim();
    if (typeof b.ticketSingleUse === 'boolean') s.ticketSingleUse = b.ticketSingleUse;
    if (b.ticketTtlSeconds) s.ticketTtlSeconds = Math.max(5, parseInt(b.ticketTtlSeconds, 10) || DEFAULT_SETTINGS.ticketTtlSeconds);
    if (b.accessTokenTtlSeconds) s.accessTokenTtlSeconds = Math.max(60, parseInt(b.accessTokenTtlSeconds, 10) || DEFAULT_SETTINGS.accessTokenTtlSeconds);
    store.save();
    ok(res, s);
  });

  /* ---------- 调试日志 ---------- */
  router.get('/api/admin/logs', (req, res) => ok(res, logs.list()));
  router.post('/api/admin/logs/clear', (req, res) => { logs.clear(); ok(res, {}); });

  return router;
};

const USER_ATTRS = ['username', 'userId', 'displayName', 'email', 'phone', 'department', 'position', 'roles', 'roleNames', 'permissions'];

function validateConfig(b) {
  if (!b.name || !String(b.name).trim()) return { error: '配置名称必填' };
  const path = String(b.path || '').trim();
  if (!path) return { error: '服务路径必填' };
  if (!path.startsWith('/')) return { error: '服务路径必须以 / 开头（模拟器在本地提供该接口，不需要填写主机地址）' };
  if (/\s/.test(path)) return { error: '服务路径不能包含空格' };
  const kv = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && x.name).map((x) => ({ name: String(x.name).trim(), value: String(x.value || '') })) : []);
  return {
    value: {
      name: String(b.name).trim(),
      enabled: !!b.enabled,
      path,
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(b.method) ? b.method : 'GET',
      headers: kv(b.headers),
      pathParams: kv(b.pathParams),
      queryParams: kv(b.queryParams),
      responseMapping: (Array.isArray(b.responseMapping) ? b.responseMapping : [])
        .filter((m) => m && m.target && (m.kind === 'const' ? m.value !== undefined : USER_ATTRS.includes(m.source)))
        .map((m) => (m.kind === 'const'
          ? { kind: 'const', value: String(m.value ?? ''), target: String(m.target).trim() }
          : { kind: 'user', source: m.source, target: String(m.target).trim() })),
    },
  };
}
