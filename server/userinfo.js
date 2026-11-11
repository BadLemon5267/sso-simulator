'use strict';
const { getPath, setPath } = require('./util');

/** 用户属性全集（响应模板可用的一切变量） */
function userAttributes(store, user) {
  const roles = (user.roleIds || []).map((id) => store.findRole(id)).filter(Boolean);
  return {
    username: user.username,
    userId: user.id,
    displayName: user.displayName || user.username,
    email: user.email || '',
    phone: user.phone || '',
    department: user.department || '',
    position: user.position || '',
    roles: roles.map((r) => r.code),
    roleNames: roles.map((r) => r.name),
    permissions: [...new Set(roles.flatMap((r) => r.permissions || []))],
  };
}

/**
 * 按「响应参数」配置渲染响应体（模拟平台返回格式）。
 * 每行映射：目标字段路径 $.a.b ← 用户属性 | 固定值
 */
function renderResponse(cfg, attrs) {
  const out = {};
  for (const m of cfg.responseMapping || []) {
    if (!m || !m.target) continue;
    let val;
    if (m.kind === 'const') {
      try { val = JSON.parse(m.value); } catch { val = m.value; }
    } else {
      val = getPath(attrs, m.source || '');
    }
    if (val !== undefined) setPath(out, m.target, val);
  }
  return out;
}

/** 把配置路径中的占位符替换成示例值（用于展示完整调用地址）；用户名类参数优先代入 sample */
function previewUrl(cfg, origin, sample) {
  let p = String(cfg.path || '');
  const keyRe = /user|principal|account|login|emp|staff/i;
  for (const pp of cfg.pathParams || []) {
    if (!pp.name) continue;
    const v = sample && keyRe.test(pp.name) ? sample : (pp.value || sample || '');
    p = p.split(`{${pp.name}}`).join(encodeURIComponent(v));
  }
  return (origin || '') + p;
}

/** 服务路径 → 匹配结果（{param: value}）或 null */
function matchPath(pattern, pathname) {
  if (!pattern || !pattern.startsWith('/')) return null;
  const names = [];
  const rx = pattern
    .replace(/[{}]/g, (ch) => (ch === '{' ? '\u0001' : '\u0002'))
    .replace(/[.+*?^$()|[\]\\]/g, '\\$&')
    .replace(/\u0001(\w+)\u0002/g, (m, name) => { names.push(name); return '([^/]+)'; });
  try {
    const match = new RegExp(`^${rx}/?$`).exec(pathname);
    if (!match) return null;
    const params = {};
    names.forEach((n, i) => { params[n] = decodeURIComponent(match[i + 1]); });
    return params;
  } catch { return null; }
}

module.exports = { userAttributes, renderResponse, previewUrl, matchPath };
