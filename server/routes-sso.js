'use strict';
const express = require('express');
const { xmlEsc, attrTagName, pickRedirectParam } = require('./util');
const { getSession, clearSession } = require('./sessions');
const { userAttributes } = require('./userinfo');

function appendParam(url, k, v) {
  return url + (url.includes('?') ? '&' : '?') + `${k}=${encodeURIComponent(v)}`;
}

function casFailure(res, code, message, wantsJson) {
  if (wantsJson) {
    return res.status(200).json({ serviceResponse: { authenticationFailure: { code, description: message } } });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="${code}">${xmlEsc(message)}</cas:authenticationFailure></cas:serviceResponse>`;
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(xml);
}

function casSuccess(res, user, attrs, wantsJson) {
  if (wantsJson) {
    return res.status(200).json({ serviceResponse: { authenticationSuccess: { user: user.username, attributes: attrs } } });
  }
  const attrXml = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const tag = attrTagName(k);
      if (Array.isArray(v)) return v.map((x) => `<cas:${tag}>${xmlEsc(x)}</cas:${tag}>`).join('');
      const val = typeof v === 'object' ? JSON.stringify(v) : v;
      return `<cas:${tag}>${xmlEsc(val)}</cas:${tag}>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${xmlEsc(user.username)}</cas:user><cas:attributes>${attrXml}</cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`;
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(xml);
}

/**
 * CAS 协议端点。挂载于 /sso 与 /cas 两个前缀。
 * 组件系统对接地址：
 *   登录：GET  {base}/sso/login?service=<回调地址>
 *   校验：GET  {base}/sso/serviceValidate?ticket=ST-xxx&service=<回调地址>[&format=JSON]
 *   登出：GET  {base}/sso/logout?service=<组件登录页>   ← 退出后跳回组件登录页
 */
module.exports = function createSsoRouter(ctx) {
  const { store, selfBase } = ctx;
  const router = express.Router();

  /** 从请求里按配置识别回跳地址（参数名可在设置页自定义，如 service / redirect_url / returnUrl…） */
  const redirectNames = () => store.data.settings.loginRedirectParams || ['service'];
  const ticketName = () => store.data.settings.ticketParam || 'ticket';
  const pickService = (req) => {
    const hit = pickRedirectParam(req.query, redirectNames()) || pickRedirectParam(req.body, redirectNames());
    return hit ? hit.value : '';
  };

  /* ---------- 登录 ---------- */
  router.get('/login', (req, res) => {
    const hitParam = pickRedirectParam(req.query, redirectNames());
    const service = hitParam ? hitParam.value : '';
    const renew = req.query.renew === 'true' || req.query.renew === '1';
    // 已有门户会话则直接签发票据（单点登录核心语义）
    if (service && !renew) {
      const hit = getSession(req, store, 'portal');
      if (hit) {
        const user = store.findUser(hit.session.userId);
        if (user && user.enabled) {
          const t = store.issueServiceTicket({ userId: user.id, service, sessionId: hit.sid });
          return res.redirect(302, appendParam(service, ticketName(), t.token));
        }
      }
    }
    const target = hitParam ? `/portal?${hitParam.name}=${encodeURIComponent(service)}` : '/portal';
    res.redirect(302, target);
  });

  // 兼容表单直接 POST（标准 CAS 客户端表单提交）
  router.post('/login', (req, res) => {
    const { username = '', password = '', continue: continueUrl = '' } = req.body || {};
    const hitParam = pickRedirectParam(req.body, redirectNames());
    const service = hitParam ? hitParam.value : '';
    const user = store.findUserByUsername(String(username).trim());
    if (!user || !user.enabled || user.password !== password) {
      const back = hitParam ? `?${hitParam.name}=${encodeURIComponent(service)}&error=1` : '?error=1';
      return res.redirect(302, `/portal${back}`);
    }
    const sid = require('./sessions').createSession(req, res, store, 'portal', user.id);
    if (service) {
      const t = store.issueServiceTicket({ userId: user.id, service, sessionId: sid });
      return res.redirect(302, appendParam(service, ticketName(), t.token));
    }
    res.redirect(302, continueUrl || '/portal');
  });

  /* ---------- 登出（支持退回组件登录页） ---------- */
  const logout = (req, res) => {
    const q = req.query || {};
    const b = req.body || {};
    const target =
      q.service || q.url || (pickRedirectParam(q, redirectNames()) || {}).value || b.service ||
      store.data.settings.defaultLogoutUrl || '/portal';
    clearSession(req, res, store, 'portal');
    res.redirect(302, target);
  };
  router.get('/logout', logout);
  router.post('/logout', logout);

  /* ---------- CAS 1.0 简单校验 ---------- */
  router.get('/validate', async (req, res) => {
    const { ticket = '' } = req.query;
    const service = String(req.query.service || (pickRedirectParam(req.query, redirectNames()) || {}).value || '');
    const hit = store.checkServiceTicket(ticket, service);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    if (hit.user) {
      store.consumeTicket(hit.t);
      return res.send(`yes\n${hit.user.username}\n`);
    }
    res.send('no\n\n');
  });

  /* ---------- CAS 2.0 / 3.0 校验 ---------- */
  const serviceValidate = async (req, res) => {
    const q = req.query || {};
    const b = req.body || {};
    const ticket = String(q.ticket || b.ticket || '');
    const service = String(q.service || b.service || (pickRedirectParam(q, redirectNames()) || {}).value || '');
    const wantsJson = q.format === 'JSON' || q.format === 'json'
      || String(req.headers.accept || '').includes('application/json');

    if (!ticket) return casFailure(res, 'INVALID_REQUEST', '缺少 ticket 参数', wantsJson);
    const hit = store.checkServiceTicket(ticket, service);
    if (hit.reason === 'notfound') return casFailure(res, 'INVALID_TICKET', `ticket '${ticket}' 不存在`, wantsJson);
    if (hit.reason === 'consumed') return casFailure(res, 'INVALID_TICKET', 'ticket 已被使用（一次性）', wantsJson);
    if (hit.reason === 'expired') return casFailure(res, 'INVALID_TICKET', 'ticket 已过期', wantsJson);
    if (hit.reason === 'service') return casFailure(res, 'INVALID_SERVICE', 'ticket 与 service 不匹配', wantsJson);
    if (hit.reason === 'user') return casFailure(res, 'INVALID_TICKET', '用户不存在或已禁用', wantsJson);

    store.consumeTicket(hit.t);
    casSuccess(res, hit.user, userAttributes(store, hit.user), wantsJson);
  };
  router.get('/serviceValidate', serviceValidate);
  router.post('/serviceValidate', serviceValidate);
  router.get('/p3/serviceValidate', serviceValidate);
  router.post('/p3/serviceValidate', serviceValidate);
  router.get('/proxyValidate', serviceValidate);

  /* ---------- 通用 JSON 校验（自研系统适配友好） ---------- */
  router.get('/validatejson', async (req, res) => {
    const { ticket = '' } = req.query;
    const service = String(req.query.service || (pickRedirectParam(req.query, redirectNames()) || {}).value || '');
    const hit = store.checkServiceTicket(ticket, service);
    if (!hit.user) return res.status(401).json({ valid: false, message: 'ticket 无效' });
    store.consumeTicket(hit.t);
    res.json({ valid: true, user: hit.user.username, attributes: userAttributes(store, hit.user) });
  });

  return router;
};
