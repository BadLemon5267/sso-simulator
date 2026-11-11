'use strict';
const express = require('express');
const { pickRedirectParam } = require('./util');
const { getSession, createSession, clearSession } = require('./sessions');
const { userAttributes } = require('./userinfo');

/**
 * 门户后端 + 内置演示用户信息接口。
 */
module.exports = function createPortalRouter(ctx) {
  const { store, selfBase } = ctx;
  const router = express.Router();

  const publicUser = (u) => ({
    id: u.id, username: u.username, displayName: u.displayName,
    department: u.department, position: u.position,
  });

  /* ---------- 快捷登录用户列表 ---------- */
  router.get('/api/portal/users', (req, res) => {
    res.json({ ok: true, data: store.data.users.filter((u) => u.enabled).map(publicUser) });
  });

  /* ---------- 门户运行配置（回跳参数名等，供前端识别 URL） ---------- */
  router.get('/api/portal/config', (req, res) => {
    const s = store.data.settings;
    res.json({
      ok: true,
      data: {
        redirectParams: s.loginRedirectParams || ['service'],
        ticketParam: s.ticketParam || 'ticket',
      },
    });
  });

  /* ---------- 门户登录 ---------- */
  router.post('/api/portal/login', (req, res) => {
    const { username = '', password = '', service = '', continue: continueUrl = '' } = req.body || {};
    const names = store.data.settings.loginRedirectParams || ['service'];
    const ticketParam = store.data.settings.ticketParam || 'ticket';
    // 兼容前端直接透传任意回跳参数名（redirect_url / returnUrl…）
    const svc = String(service || (pickRedirectParam(req.body, names) || {}).value || '');
    const user = store.findUserByUsername(String(username).trim());
    if (!user || !user.enabled || user.password !== password) {
      return res.status(401).json({ ok: false, message: '用户名或密码错误' });
    }
    const sid = createSession(req, res, store, 'portal', user.id);
    const data = { user: publicUser(user), redirectUrl: '', ticket: '', ticketParam };
    if (svc) {
      const t = store.issueServiceTicket({ userId: user.id, service: svc, sessionId: sid });
      data.ticket = t.token;
      data.redirectUrl = svc + (svc.includes('?') ? '&' : '?') + `${ticketParam}=${encodeURIComponent(t.token)}`;
    } else if (continueUrl) {
      data.redirectUrl = String(continueUrl);
    }
    res.json({ ok: true, data });
  });

  /* ---------- 门户登出：优先跳配置的组件登录页 ---------- */
  router.post('/api/portal/logout', (req, res) => {
    clearSession(req, res, store, 'portal');
    res.json({ ok: true, data: { redirect: store.data.settings.defaultLogoutUrl || '/portal' } });
  });

  /* ---------- 当前登录用户（返回本地用户属性 + 角色） ---------- */
  router.get('/api/portal/me', (req, res) => {
    const hit = getSession(req, store, 'portal');
    if (!hit) return res.status(401).json({ ok: false, message: '未登录' });
    const user = store.findUser(hit.session.userId);
    if (!user) return res.status(401).json({ ok: false, message: '用户不存在' });
    const attrs = userAttributes(store, user);
    res.json({ ok: true, data: { user: publicUser(user), attributes: attrs } });
  });

  /* ---------- 动态菜单（子系统 iframe 内嵌入口） ---------- */
  router.get('/api/portal/menus', (req, res) => {
    const menus = (store.data.menus || [])
      .filter((m) => m.enabled)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.createdAt - b.createdAt);
    res.json({ ok: true, data: menus });
  });

  /** 按菜单携带方式（query / path）把票据拼进子系统地址 */
  function buildSubUrl(menu, ticket, ticketParam) {
    const url = String(menu.url || '');
    if (menu.ticketMode === 'path') {
      if (url.includes('{ticket}')) return url.split('{ticket}').join(encodeURIComponent(ticket));
      const qi = url.indexOf('?');
      const base = qi < 0 ? url : url.slice(0, qi);
      const qs = qi < 0 ? '' : url.slice(qi);
      return base.replace(/\/+$/, '') + '/' + encodeURIComponent(ticket) + qs;
    }
    return url + (url.includes('?') ? '&' : '?') + `${ticketParam}=${encodeURIComponent(ticket)}`;
  }

  /* ---------- 点击菜单：为当前用户现签发票据并给出最终跳转地址 ---------- */
  router.get('/api/portal/menu-ticket', (req, res) => {
    const hit = getSession(req, store, 'portal');
    if (!hit) return res.status(401).json({ ok: false, message: '登录已过期，请重新登录' });
    const user = store.findUser(hit.session.userId);
    if (!user || !user.enabled) return res.status(401).json({ ok: false, message: '用户不可用' });
    const menu = (store.data.menus || []).find((m) => m.id === req.query.menuId && m.enabled);
    if (!menu) return res.status(404).json({ ok: false, message: '菜单不存在或已停用' });

    const t = store.issueServiceTicket({ userId: user.id, service: menu.url, sessionId: hit.sid });
    const ticketParam = store.data.settings.ticketParam || 'ticket';
    res.json({
      ok: true,
      data: {
        menuId: menu.id, name: menu.name,
        ticket: t.token, ticketParam,
        url: buildSubUrl(menu, t.token, ticketParam),
      },
    });
  });

  return router;
};
