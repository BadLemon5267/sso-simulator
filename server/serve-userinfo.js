'use strict';
const { userAttributes, renderResponse, matchPath } = require('./userinfo');

const USERNAME_KEY_RE = /user|principal|account|login|emp|staff/i;
const TICKET_KEY_RE = /ticket|token|code|credential|secret/i;

/**
 * 「用户信息查询接口」服务端：模拟器按配置在本地实现平台方的接口。
 *
 * 标准用法（与平台一致）：子系统在平台登录完成后拿到 ticket，
 * 携带 ticket 调用本接口查询用户信息。ticket 可出现在：
 *   - 路径占位符里（如 /userInfo/{principal} 的 principal 填 ST-xxx）
 *   - 查询参数（?ticket= / ?token= / ?code= …）
 *   - 请求头（Authorization: Bearer / ticket / token …）
 *   - 请求体（JSON 字段或表单字段）
 *
 * 用户名方式仅作为调试兜底（路径/参数里直接给用户名也能查，便于快速验证）。
 */
module.exports = function createUserInfoServer(ctx) {
  const { store, logs } = ctx;

  /** 按值在票据库中找用户（不消费票据；已消费但未过期的 service ticket 仍可识别身份） */
  function findTicketUser(value) {
    if (typeof value !== 'string' || value.length < 8) return null;
    for (const type of ['access-token', 'service-ticket', 'oauth-code']) {
      const t = store.findTicket(value, type);
      if (t && t.expiresAt > Date.now()) {
        const u = store.findUser(t.userId);
        if (u && u.enabled) return u;
      }
    }
    return null;
  }

  /** 收集请求中所有可能携带票据/用户名的候选值 */
  function collectCandidates(req, params, query) {
    const out = [];
    const push = (key, value) => {
      if (typeof value === 'string' && value.trim()) {
        out.push({ key: key || '', value: value.trim(), ticketHint: key ? TICKET_KEY_RE.test(key) : false });
      }
    };
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) push('authorization', auth.slice(7));
    if (auth && !auth.toLowerCase().startsWith('bearer ')) push('authorization', auth);
    for (const h of ['ticket', 'token', 'access_token', 'access-token', 'x-ticket']) {
      if (req.headers[h]) push(h, req.headers[h]);
    }
    for (const [k, v] of Object.entries(params || {})) push(k, v);
    for (const [k, v] of Object.entries(query || {})) push(k, Array.isArray(v) ? v[0] : v);
    const body = req.body;
    if (body && typeof body === 'object') {
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') push(k, v);
      }
    }
    return out;
  }

  function resolveUser(req, params, query) {
    const candidates = collectCandidates(req, params, query);
    // 1) 票据优先：先看名字带票据暗示的（ticket/token/code…），再看全部候选值
    for (const c of candidates.filter((x) => x.ticketHint)) {
      const u = findTicketUser(c.value);
      if (u) return u;
    }
    for (const c of candidates) {
      const u = findTicketUser(c.value);
      if (u) return u;
    }
    // 2) 用户名兜底（快速调试用）：名字像用户名的优先
    const byName = [];
    for (const c of candidates) {
      if (USERNAME_KEY_RE.test(c.key)) byName.unshift(c.value); else byName.push(c.value);
    }
    for (const v of byName) {
      const u = store.findUserByUsername(v) || store.findUser(v);
      if (u && u.enabled) return u;
    }
    return null;
  }

  /**
   * 校验配置声明的请求头（强制）：
   * - 值留空 → 仅要求该头存在；填了值 → 要求精确匹配（去除首尾空白后比较）
   * - Header 名不区分大小写（HTTP 语义）；返回全部不满足项，便于子系统排查
   */
  function checkHeaders(cfg, req) {
    const failures = [];
    for (const h of cfg.headers || []) {
      const name = String(h.name || '').trim();
      if (!name) continue;
      const want = String(h.value || '').trim();
      const got = req.headers[name.toLowerCase()];
      if (got === undefined) {
        failures.push(`缺少请求头 ${name}`);
      } else if (want && String(got).trim() !== want) {
        failures.push(`请求头 ${name} 值不匹配（期望 "${want}"，实际 "${String(got).trim()}"）`);
      }
    }
    return failures;
  }

  return function userInfoServer(req, res, next) {
    const cfgs = store.data.configs.filter((c) => c.enabled && c.path);
    for (const cfg of cfgs) {
      if ((cfg.method || 'GET') !== req.method) continue;
      const params = matchPath(cfg.path, req.path);
      if (!params) continue;

      // 先校验请求头（模拟真实平台“先验应用身份、再验票据”的顺序），不满足直接 403
      const headerFails = checkHeaders(cfg, req);
      if (headerFails.length) {
        const note = `请求头校验失败：${headerFails.join('；')}`;
        logs.push({
          t: new Date().toISOString(),
          method: req.method,
          path: req.path,
          query: Object.keys(req.query || {}).length ? req.query : undefined,
          headers: { authorization: req.headers.authorization || undefined, 'content-type': req.headers['content-type'] || undefined },
          note,
          source: `接口模拟:${cfg.name}`,
          status: 403,
          durationMs: 0,
          ip: req.ip,
        });
        return res.status(403).json({
          success: false, code: 403,
          message: note,
          _simulatedBy: cfg.name,
        });
      }

      const user = resolveUser(req, params, req.query || {});

      logs.push({
        t: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: Object.keys(req.query || {}).length ? req.query : undefined,
        headers: { authorization: req.headers.authorization || undefined, 'content-type': req.headers['content-type'] || undefined },
        source: `接口模拟:${cfg.name}`,
        status: user ? 200 : 401,
        durationMs: 0,
        ip: req.ip,
      });

      if (!user) {
        return res.status(401).json({
          success: false, code: 401,
          message: 'ticket 无效或已过期：请携带登录后回传的 ticket（可放路径、query、Header 或请求体），或提供存在的用户名',
          _simulatedBy: cfg.name,
        });
      }
      const attrs = userAttributes(store, user);
      const body = renderResponse(cfg, attrs);
      return res.status(200).json(body);
    }
    next();
  };
};
