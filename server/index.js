'use strict';
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawnSync } = require('child_process');
const express = require('express');
const { Store } = require('./store');
const createSsoRouter = require('./routes-sso');
const createOAuthRouter = require('./routes-oauth');
const createPortalRouter = require('./routes-portal');
const createAdminRouter = require('./routes-admin');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'db.json');
const SELF_BASE = `https://127.0.0.1:${PORT}`;

/* ---------- TLS 证书（自签名，缺失时自动生成） ---------- */
const TLS_KEY = process.env.TLS_KEY || path.join(__dirname, '..', 'certs', 'server.key');
const TLS_CERT = process.env.TLS_CERT || path.join(__dirname, '..', 'certs', 'server.crt');
function ensureCertificate() {
  try {
    return { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };
  } catch (_) { /* 首次运行，自动生成 */ }
  fs.mkdirSync(path.dirname(TLS_KEY), { recursive: true });
  fs.mkdirSync(path.dirname(TLS_CERT), { recursive: true });
  const subj = '/CN=sso-simulator';
  const san = 'subjectAltName=DNS:localhost,DNS:sso-simulator,IP:127.0.0.1';
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', TLS_KEY, '-out', TLS_CERT, '-days', '3650', '-subj', subj,
    '-addext', san], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('无法生成自签名证书，请安装 openssl 或通过 TLS_KEY/TLS_CERT 指定证书');
  console.log(`[sso-simulator] 已生成自签名证书: ${TLS_CERT}`);
  return { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };
}

const store = new Store(DATA_FILE);
store.init();

/* ---------- 调试日志（内存环形缓冲，仅记录认证相关流量） ---------- */
const LOG_MAX = 200;
const logEntries = [];
const logs = {
  push(entry) {
    entry.id = `${entry.t}-${Math.random().toString(36).slice(2, 6)}`;
    logEntries.unshift(entry);
    if (logEntries.length > LOG_MAX) logEntries.length = LOG_MAX;
  },
  list: () => logEntries.slice(),
  clear: () => { logEntries.length = 0; },
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ---------- CORS：调试环境全放行 ---------- */
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/* ---------- 认证流量日志 ---------- */
app.use((req, res, next) => {
  const hit = /^(\/sso|\/cas|\/oauth2|\/api\/validate|\/demo|\/\.well-known)/.test(req.path);
  const started = Date.now();
  res.on('finish', () => {
    if (hit) {
      logs.push({
        t: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: Object.keys(req.query || {}).length ? req.query : undefined,
        status: res.statusCode,
        durationMs: Date.now() - started,
        ip: req.ip,
      });
    }
  });
  next();
});

/* ---------- 静态资源与页面 ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'sso-simulator', time: new Date().toISOString() }));
app.get('/', (req, res) => res.redirect(302, '/portal'));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'portal.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
// 内置演示子系统（可被 iframe 内嵌，支持 query / path 两种票据携带方式）
app.get(['/demo-sub', '/demo-sub/:ticket'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'demo-sub.html')));

/* ---------- 业务路由 ---------- */
const createUserInfoServer = require('./serve-userinfo');
const ctx = { store, selfBase: SELF_BASE, publicBase: PUBLIC_BASE, adminPassword: ADMIN_PASSWORD, logs };
app.use(createPortalRouter(ctx));
app.use(createAdminRouter(ctx));
app.use(createOAuthRouter(ctx));
app.use('/sso', createSsoRouter(ctx));
app.use('/cas', createSsoRouter(ctx));

/* ---------- 用户信息查询接口（按配置在本地提供，模拟平台） ---------- */
app.use(createUserInfoServer(ctx));

/* ---------- 通用 JSON 票据校验（自研系统适配友好） ---------- */
app.get('/api/validate', async (req, res) => {
  const { ticket = '' } = req.query;
  const { pickRedirectParam } = require('./util');
  const names = store.data.settings.loginRedirectParams || ['service'];
  const service = String(req.query.service || (pickRedirectParam(req.query, names) || {}).value || '');
  const hit = store.checkServiceTicket(ticket, service);
  if (!hit.user) return res.status(401).json({ valid: false, message: 'ticket 无效' });
  store.consumeTicket(hit.t);
  const { userAttributes } = require('./userinfo');
  res.json({ valid: true, user: hit.user.username, attributes: userAttributes(store, hit.user) });
});

/* ---------- 404 与错误处理 ---------- */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, message: 'not found' });
  res.status(404).send('Not Found');
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  if (req.path.startsWith('/api/') || req.path.startsWith('/oauth2/')) {
    return res.status(500).json({ ok: false, message: err.message || 'internal error' });
  }
  res.status(500).send('Internal Server Error');
});

/* ---------- 过期票据清理 ---------- */
setInterval(() => store.purgeExpired(), 60 * 1000);
setInterval(() => store.flush(), 30 * 1000);
process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

https.createServer(ensureCertificate(), app).listen(PORT, '0.0.0.0', () => {
  console.log(`[sso-simulator] listening on https://0.0.0.0:${PORT} (自签名证书，客户端需信任或跳过校验)`);
  console.log(`[sso-simulator] 门户:     https://localhost:${PORT}/portal`);
  console.log(`[sso-simulator] 管理台:   https://localhost:${PORT}/admin  (ADMIN_PASSWORD=${ADMIN_PASSWORD === 'admin123' ? 'admin123' : '***'})`);
  console.log(`[sso-simulator] CAS 登录: https://localhost:${PORT}/sso/login?service=<回调地址>`);
});
