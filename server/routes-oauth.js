'use strict';
const express = require('express');
const { randomToken } = require('./util');
const { getSession } = require('./sessions');
const { userAttributes } = require('./userinfo');

/**
 * OAuth2 端点（授权码模式 + password 模式，调试用途，宽松校验）。
 *   授权：GET  {base}/oauth2/authorize?client_id=&redirect_uri=&response_type=code&state=
 *   令牌：POST {base}/oauth2/token
 *   用户：GET  {base}/oauth2/userinfo   (Authorization: Bearer <token>)
 *   发现：GET  {base}/.well-known/openid-configuration
 */
module.exports = function createOAuthRouter(ctx) {
  const { store, selfBase, publicBase } = ctx;
  const router = express.Router();

  const base = (req) => publicBase || `${req.protocol}://${req.get('host')}`;

  /* ---------- OIDC 发现文档 ---------- */
  router.get('/.well-known/openid-configuration', (req, res) => {
    const b = base(req);
    res.json({
      issuer: b,
      authorization_endpoint: `${b}/oauth2/authorize`,
      token_endpoint: `${b}/oauth2/token`,
      userinfo_endpoint: `${b}/oauth2/userinfo`,
      jwks_uri: `${b}/oauth2/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'password'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['none'],
      scopes_supported: ['openid', 'profile', 'roles'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      claims_supported: ['sub', 'username', 'displayName', 'email', 'phone', 'department', 'position', 'roles', 'permissions'],
    });
  });

  router.get('/oauth2/jwks', (req, res) => res.json({ keys: [] }));

  /* ---------- 授权端点 ---------- */
  router.get('/oauth2/authorize', (req, res) => {
    const { redirect_uri = '', state = '', response_type = 'code' } = req.query;
    if (response_type !== 'code') return res.status(400).send('only response_type=code is supported');
    if (!redirect_uri) return res.status(400).send('missing redirect_uri');

    const issue = (userId, sessionId) => {
      const code = store.createTicket({
        type: 'oauth-code', token: randomToken('CODE'), userId,
        redirectUri: String(redirect_uri), sessionId, ttlSeconds: store.data.settings.ticketTtlSeconds,
      });
      let url = String(redirect_uri) + (String(redirect_uri).includes('?') ? '&' : '?') + `code=${encodeURIComponent(code.token)}`;
      if (state) url += `&state=${encodeURIComponent(String(state))}`;
      res.redirect(302, url);
    };

    const hit = getSession(req, store, 'portal');
    if (hit) {
      const user = store.findUser(hit.session.userId);
      if (user && user.enabled) return issue(user.id, hit.sid);
    }
    // 未登录 → 门户登录后回跳
    const continueUrl = base(req) + req.originalUrl;
    res.redirect(302, `/portal?continue=${encodeURIComponent(continueUrl)}`);
  });

  /* ---------- 令牌端点 ---------- */
  router.post('/oauth2/token', async (req, res) => {
    const b = req.body || {};
    const grantType = b.grant_type || '';
    res.set('Cache-Control', 'no-store');

    if (grantType === 'authorization_code') {
      const code = store.findTicket(String(b.code || ''), 'oauth-code');
      if (!code || code.consumed || code.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code 无效、已使用或已过期' });
      }
      if (b.redirect_uri && code.redirectUri && b.redirect_uri !== code.redirectUri) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri 不匹配' });
      }
      code.consumed = true; store.save();
      const token = store.createTicket({
        type: 'access-token', token: randomToken('AT'), userId: code.userId,
        ttlSeconds: store.data.settings.accessTokenTtlSeconds,
      });
      return res.json({
        access_token: token.token, token_type: 'Bearer',
        expires_in: store.data.settings.accessTokenTtlSeconds, scope: 'openid profile roles',
      });
    }

    if (grantType === 'password') {
      const user = store.findUserByUsername(String(b.username || ''));
      if (!user || !user.enabled || user.password !== String(b.password || '')) {
        return res.status(400).json({ error: 'invalid_grant', error_description: '用户名或密码错误' });
      }
      const token = store.createTicket({
        type: 'access-token', token: randomToken('AT'), userId: user.id,
        ttlSeconds: store.data.settings.accessTokenTtlSeconds,
      });
      return res.json({
        access_token: token.token, token_type: 'Bearer',
        expires_in: store.data.settings.accessTokenTtlSeconds, scope: 'openid profile roles',
      });
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  /* ---------- 用户信息端点 ---------- */
  const userinfo = async (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.query.access_token || req.body?.access_token || '');
    const t = store.findTicket(token, 'access-token');
    if (!t || t.consumed || t.expiresAt < Date.now()) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'access_token 无效或已过期' });
    }
    const user = store.findUser(t.userId);
    if (!user || !user.enabled) return res.status(401).json({ error: 'invalid_token' });
    const attrs = userAttributes(store, user);
    res.json({ sub: user.id, ...attrs });
  };
  router.get('/oauth2/userinfo', userinfo);
  router.post('/oauth2/userinfo', userinfo);

  return router;
};
