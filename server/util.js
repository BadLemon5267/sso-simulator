'use strict';
const crypto = require('crypto');

/** 生成短 id */
exports.uid = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

/** 生成票据/令牌：ST-xxxx / CODE-xxxx / AT-xxxx */
exports.randomToken = (prefix) => `${prefix}-${crypto.randomBytes(24).toString('hex')}`;

/**
 * 模板渲染：把 {{username}} / {{ticket}} 等占位符替换为变量值。
 * 未命中的占位符原样保留（便于发现配置错误）。
 */
exports.renderTemplate = (str, vars) =>
  String(str ?? '').replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, key) => {
    const v = vars ? vars[key] : undefined;
    return v === undefined || v === null ? m : String(v);
  });

/** 按路径读取对象值，支持 $.a.b[0].c / a.b.c */
exports.getPath = (obj, path) => {
  if (!path) return undefined;
  const parts = String(path).replace(/^\$\.?/, '').split(/[.[\]]+/).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
};

/** 按配置的参数名顺序，从 query/body 中找出第一个非空的回跳地址 */
exports.pickRedirectParam = (obj, names) => {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of Array.isArray(names) ? names : []) {
    if (!n) continue;
    const v = obj[n];
    if (typeof v === 'string' && v.trim()) return { name: n, value: v.trim() };
  }
  return null;
};

/** 按点分路径写入对象值（映射目标支持嵌套，如 data.profile.name） */
exports.setPath = (obj, path, value) => {
  const keys = String(path).replace(/^\$\.?/, '').split('.').filter(Boolean);
  if (!keys.length) return;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
};

exports.xmlEsc = (s) =>
  String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** 属性名转合法 XML 元素名 */
exports.attrTagName = (k) => {
  const t = String(k).replace(/[^\w.-]/g, '_').replace(/[.-]/g, '_');
  return /^[A-Za-z_]/.test(t) ? t : `_${t}`;
};

exports.parseCookies = (header) => {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
};

exports.serializeCookie = (name, value, opts = {}) => {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${opts.path || '/'}`;
  s += `; HttpOnly`;
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${opts.maxAge}`;
  return s;
};

/** 展平 JSON 对象，返回所有叶子路径（用于响应字段点选映射） */
exports.flattenObject = (obj, prefix = '$', depth = 0, out = []) => {
  if (depth > 6 || obj === null || typeof obj !== 'object') {
    if (prefix !== '$') out.push(prefix);
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === 'object') exports.flattenObject(obj[0], `${prefix}[0]`, depth + 1, out);
    else out.push(prefix);
    return out;
  }
  const keys = Object.keys(obj);
  if (!keys.length) { out.push(prefix); return out; }
  for (const k of keys) exports.flattenObject(obj[k], `${prefix}.${k}`, depth + 1, out);
  return out;
};
