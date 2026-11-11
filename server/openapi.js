'use strict';
const yaml = require('js-yaml');

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

/** 解析 OpenAPI/Swagger 文本（JSON 或 YAML），返回文档对象 */
function parseSpec(text) {
  let doc;
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('内容为空');
  try {
    doc = JSON.parse(trimmed);
  } catch {
    try {
      doc = yaml.load(trimmed);
    } catch (e) {
      throw new Error(`YAML 解析失败：${e.message}`);
    }
  }
  if (!doc || typeof doc !== 'object' || !doc.paths) {
    throw new Error('不是有效的 OpenAPI/Swagger 规范（缺少 paths 字段）');
  }
  return doc;
}

function resolveRef(doc, ref, depth = 0) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/') || depth > 10) return undefined;
  let cur = doc;
  for (const p of ref.slice(2).split('/')) {
    cur = cur?.[decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~'))];
  }
  return cur;
}

function deref(doc, obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.$ref) {
    const target = resolveRef(doc, obj.$ref, depth);
    return deref(doc, target, depth + 1);
  }
  return obj;
}

/** 列出文档中全部操作 */
function listOperations(doc) {
  const ops = [];
  const baseUrl = (doc.servers && doc.servers[0] && doc.servers[0].url) || '';
  for (const [p, item] of Object.entries(doc.paths || {})) {
    const pathItem = deref(doc, item) || {};
    for (const [m, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.includes(m)) continue;
      const operation = deref(doc, op) || {};
      ops.push({
        method: m.toUpperCase(),
        path: p,
        url: baseUrl + p,
        summary: operation.summary || operation.description || operation.operationId || '',
      });
    }
  }
  return ops;
}

/** 由响应 schema 展平出字段路径列表 */
function flattenSchema(doc, schema, prefix = '$', depth = 0, out = []) {
  if (depth > 4) return out;
  const s = deref(doc, schema);
  if (!s || typeof s !== 'object') return out;
  if (s.type === 'array') {
    flattenSchema(doc, s.items, prefix, depth + 1, out);
    return out;
  }
  if (s.properties) {
    const keys = Object.keys(s.properties);
    if (!keys.length) { if (prefix !== '$') out.push(prefix); return out; }
    for (const k of keys) flattenSchema(doc, s.properties[k], `${prefix}.${k}`, depth + 1, out);
    return out;
  }
  if (prefix !== '$') out.push(prefix);
  return out;
}

/** 根据字段名猜目标属性 */
function guessTarget(leafName) {
  const n = String(leafName).toLowerCase().replace(/[_\s-]/g, '');
  const table = [
    [/^(realname|displayname|nickname|fullname|uname)$/, 'displayName'],
    [/^(username|account|loginname|useraccount|userno)$/, 'username'],
    [/^(email|mail|useremail)$/, 'email'],
    [/^(phone|mobile|tel|telephone|cellphone)$/, 'phone'],
    [/^(dept|deptname|department|org|orgname|organization|orgfullname)$/, 'department'],
    [/^(role|roles|rolecode|rolecodes|authorities|userrole)$/, 'roles'],
    [/^(position|job|jobtitle|title|duty|post)$/, 'position'],
    [/^(userid|id|uid|employeeno|staffid)$/, 'userId'],
  ];
  for (const [re, target] of table) if (re.test(n)) return target;
  return null;
}

/**
 * 把某个操作导入为接口配置（替身模式）：模拟器在本地按此契约提供接口，
 * 并按响应 Schema 生成「响应字段 ← 用户属性/固定值」的初始映射。
 */
function toConfig(doc, method, path) {
  const pathItem = deref(doc, (doc.paths || {})[path]) || {};
  const op = deref(doc, pathItem[String(method).toLowerCase()]) || {};
  const rawParams = [
    ...(op.parameters || []),
    ...(pathItem.parameters || []),
  ];
  const headers = [];
  const pathParams = [];
  const queryParams = [];
  const schemaByParam = {};
  for (const p of rawParams) {
    const param = deref(doc, p) || {};
    const example = param.example ?? param.schema?.example ?? param.schema?.default ?? '';
    const row = { name: param.name || '', value: String(example) };
    if (param.in === 'path') pathParams.push(row);
    else if (param.in === 'query') queryParams.push(row);
    else if (param.in === 'header') headers.push(row);
    schemaByParam[`${param.in}:${param.name}`] = param.schema || {};
  }

  // 响应映射：取 200/201 响应 schema 展平；字段名能对上用户属性则映射，否则按类型给样例固定值
  const responseMapping = [];
  const responses = op.responses || {};
  const okKey = Object.keys(responses).find((k) => k === '200' || k === '201' || k === 'default');
  if (okKey) {
    const resp = deref(doc, responses[okKey]) || {};
    const jsonContent = resp.content && (resp.content['application/json'] || Object.values(resp.content)[0]);
    if (jsonContent && jsonContent.schema) {
      const paths = flattenSchema(doc, jsonContent.schema);
      for (const src of paths) {
        const leaf = String(src).split('.').pop().replace(/[^\w]/g, '');
        const userAttr = guessTarget(leaf);
        if (userAttr) responseMapping.push({ kind: 'user', source: userAttr, target: src });
        else responseMapping.push({ kind: 'const', value: '', target: src });
      }
    }
  }

  return {
    name: op.summary || `${method.toUpperCase()} ${path}`.slice(0, 60),
    enabled: false,
    path,
    method: method.toUpperCase(),
    headers,
    pathParams,
    queryParams,
    responseMapping,
  };
}

module.exports = { parseSpec, listOperations, toConfig };
