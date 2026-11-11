'use strict';
const { parseCookies, serializeCookie } = require('./util');

const PORTAL_TTL_MS = 24 * 3600 * 1000;
const ADMIN_TTL_MS = 12 * 3600 * 1000;

/** 从请求中取现有会话（不新建） */
function getSession(req, store, type = 'portal') {
  const sid = parseCookies(req.headers.cookie)[type === 'admin' ? 'admin_sid' : 'sso_sid'];
  if (!sid) return null;
  const sess = store.getSession(sid);
  if (!sess || sess.type !== type) return null;
  return { sid, session: sess };
}

/** 创建会话并种 cookie */
function createSession(req, res, store, type, userId) {
  const ttl = type === 'admin' ? ADMIN_TTL_MS : PORTAL_TTL_MS;
  const sid = store.createSession(type, userId, ttl);
  res.setHeader('Set-Cookie', serializeCookie(type === 'admin' ? 'admin_sid' : 'sso_sid', sid, { maxAge: Math.floor(ttl / 1000) }));
  return sid;
}

function clearSession(req, res, store, type = 'portal') {
  const sid = parseCookies(req.headers.cookie)[type === 'admin' ? 'admin_sid' : 'sso_sid'];
  if (sid) {
    store.deleteSession(sid);
    store.revokeSessionTickets(sid);   // 复用模式下：登出即作废该会话签发的长效票据
  }
  res.setHeader('Set-Cookie', serializeCookie(type === 'admin' ? 'admin_sid' : 'sso_sid', '', { maxAge: 0 }));
}

/** 管理端鉴权中间件 */
function requireAdmin(store) {
  return (req, res, next) => {
    const hit = getSession(req, store, 'admin');
    if (!hit) return res.status(401).json({ ok: false, message: '未登录或会话已过期' });
    next();
  };
}

module.exports = { getSession, createSession, clearSession, requireAdmin };
