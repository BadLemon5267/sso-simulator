'use strict';
const fs = require('fs');
const path = require('path');
const { uid } = require('./util');

const DEFAULT_SETTINGS = {
  defaultLogoutUrl: '',            // 门户退出后默认跳转（组件登录页）
  ticketTtlSeconds: 60,            // CAS service ticket 有效期
  accessTokenTtlSeconds: 7200,     // OAuth2 access token 有效期
  loginRedirectParams: [           // 登录页识别的回跳地址参数名（按优先级）
    'service', 'redirect_url', 'redirectUrl', 'returnUrl', 'callback', 'backUrl',
  ],
  ticketParam: 'ticket',           // 跳回组件时携带票据的参数名
  ticketSingleUse: true,           // true=票据单次唯一（标准 CAS）；false=登录态内复用同一张票、可被子系统重复消费
};

function seedMenus() {
  return [
    {
      id: uid('m'), name: '演示子系统', url: '/demo-sub', ticketMode: 'query',
      sort: 1, enabled: true, createdAt: Date.now(),
    },
  ];
}

function seed() {
  const rAdmin = { id: uid('r'), code: 'admin', name: '管理员', description: '系统管理员角色', permissions: ['*'], createdAt: Date.now() };
  const rUser = { id: uid('r'), code: 'user', name: '普通用户', description: '默认角色', permissions: ['read'], createdAt: Date.now() };
  const rManager = { id: uid('r'), code: 'manager', name: '部门经理', description: '示例业务角色', permissions: ['read', 'approve'], createdAt: Date.now() };
  const users = [
    { id: uid('u'), username: 'admin', password: '123456', displayName: '模拟管理员', email: 'admin@demo.local', phone: '13800000001', department: '信息中心', position: '运维工程师', roleIds: [rAdmin.id], enabled: true, createdAt: Date.now() },
    { id: uid('u'), username: 'zhangsan', password: '123456', displayName: '张三', email: 'zhangsan@demo.local', phone: '13800000002', department: '研发部/平台组', position: 'Java 工程师', roleIds: [rUser.id], enabled: true, createdAt: Date.now() },
    { id: uid('u'), username: 'lisi', password: '123456', displayName: '李四', email: 'lisi@demo.local', phone: '13800000003', department: '产品部', position: '产品经理', roleIds: [rManager.id, rUser.id], enabled: true, createdAt: Date.now() },
  ];
  const configs = [
    {
      id: uid('cfg'),
      name: '示例：演示用户信息接口',
      enabled: true,
      path: '/demo/api/user/{username}',   // 模拟器在此路径提供该接口
      method: 'GET',
      headers: [{ name: 'X-App-Id', value: 'sso-simulator' }],   // 声明后为强制校验：未携带/不匹配返回 403
      pathParams: [{ name: 'username', value: 'zhangsan（或登录回传的 ticket）' }],
      queryParams: [{ name: 'ticket', value: '登录后回传的票据 ST-xxx' }],
      responseMapping: [
        { kind: 'const', value: 'true', target: '$.success' },
        { kind: 'const', value: '0', target: '$.code' },
        { kind: 'const', value: 'ok', target: '$.message' },
        { kind: 'user', source: 'userId', target: '$.data.userId' },
        { kind: 'user', source: 'username', target: '$.data.account' },
        { kind: 'user', source: 'displayName', target: '$.data.realName' },
        { kind: 'user', source: 'department', target: '$.data.deptName' },
        { kind: 'user', source: 'email', target: '$.data.email' },
        { kind: 'user', source: 'phone', target: '$.data.mobile' },
        { kind: 'user', source: 'position', target: '$.data.jobTitle' },
        { kind: 'user', source: 'roles', target: '$.data.roles' },
        { kind: 'user', source: 'roleNames', target: '$.data.roleNames' },
      ],
      createdAt: Date.now(),
    },
  ];
  return {
    roles: [rAdmin, rUser, rManager],
    users,
    configs,
    menus: seedMenus(),
    settings: { ...DEFAULT_SETTINGS },
    tickets: [],      // { id, type, token, userId, service, redirectUri, sessionId, createdAt, expiresAt, consumed, reusable }
    sessions: {},     // sid -> { type:'portal'|'admin', userId, createdAt, expiresAt }
  };
}

class Store {
  constructor(file) {
    this.file = file;
    this._migrated = false;
    this.data = this.#load();
    this._timer = null;
  }
  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // 补齐缺失的设置项（升级兼容）
      raw.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      raw.tickets = raw.tickets || [];
      raw.menus = Array.isArray(raw.menus) ? raw.menus : seedMenus();
      raw.sessions = raw.sessions || {};
      const migrated = (raw.configs || []).map(migrateConfig);
      if (migrated.some((c, i) => c !== (raw.configs || [])[i])) this._migrated = true;
      raw.configs = migrated.filter(Boolean);
      return raw;
    } catch {
      return null;
    }
  }
  init() {
    if (!this.data) {
      this.data = seed();
      this.save();
      console.log(`[store] 初始化种子数据完成：${this.file}`);
    } else if (this._migrated) {
      this.save();
      console.log(`[store] 已将接口配置迁移为「本地替身」模式：${this.file}`);
    }
  }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 50);
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] 写入失败:', e.message);
    }
  }

  /* ---------- 用户 / 角色 ---------- */
  findUser(id) { return this.data.users.find((u) => u.id === id); }
  findUserByUsername(username) { return this.data.users.find((u) => u.username === username); }
  findRole(id) { return this.data.roles.find((r) => r.id === id); }

  /* ---------- 接口配置 ---------- */

  /* ---------- 会话 ---------- */
  getSession(sid) {
    const s = this.data.sessions[sid];
    if (!s) return null;
    if (s.expiresAt < Date.now()) { delete this.data.sessions[sid]; this.save(); return null; }
    return s;
  }
  createSession(type, userId, ttlMs) {
    const sid = require('./util').uid('s');
    this.data.sessions[sid] = { type, userId, createdAt: Date.now(), expiresAt: Date.now() + ttlMs };
    this.save();
    return sid;
  }
  deleteSession(sid) { delete this.data.sessions[sid]; this.save(); }

  /* ---------- 票据 ---------- */
  createTicket({ type, token, userId, service, redirectUri, sessionId, ttlSeconds, reusable, expiresAt }) {
    const t = {
      id: require('./util').uid('t'), type, token, userId,
      service: service || '', redirectUri: redirectUri || '', sessionId: sessionId || '',
      createdAt: Date.now(), expiresAt: expiresAt || Date.now() + ttlSeconds * 1000,
      consumed: false, reusable: !!reusable,
    };
    this.data.tickets.push(t);
    this.save();
    return t;
  }
  findTicket(token, type) { return this.data.tickets.find((t) => t.token === token && (!type || t.type === type)); }

  /** 是否单次唯一票据模式（缺省 true，兼容旧数据） */
  isSingleUseTicket() { return this.data.settings.ticketSingleUse !== false; }

  /**
   * 签发 service ticket（门户菜单 / 登录回跳 / CAS 登录共用入口）。
   * - 单次模式（默认，标准 CAS）：每次现签一张短时效票据。
   * - 复用模式（模拟“票据可重复消费”平台）：登录会话存续期间始终下发同一张票，
   *   有效期跟随会话；不绑定单一 service（多子系统共用，校验时通配）。
   */
  issueServiceTicket({ userId, service, sessionId }) {
    if (!this.isSingleUseTicket()) {
      const existing = this.data.tickets.find((t) => t.type === 'service-ticket' && t.reusable && !t.consumed
        && t.sessionId === (sessionId || '') && t.expiresAt > Date.now());
      if (existing) {
        const sess = sessionId ? this.data.sessions[sessionId] : null;
        if (sess && sess.expiresAt > existing.expiresAt) { existing.expiresAt = sess.expiresAt; this.save(); }
        return existing;
      }
      const sess = sessionId ? this.data.sessions[sessionId] : null;
      return this.createTicket({
        type: 'service-ticket', token: require('./util').randomToken('ST'), userId,
        service: '', sessionId, reusable: true,
        expiresAt: sess ? sess.expiresAt : Date.now() + this.data.settings.ticketTtlSeconds * 1000,
      });
    }
    return this.createTicket({
      type: 'service-ticket', token: require('./util').randomToken('ST'), userId,
      service, sessionId, ttlSeconds: this.data.settings.ticketTtlSeconds,
    });
  }

  /**
   * 统一校验 service ticket（各校验端点共用；按 notfound→consumed→expired→service→user 顺序判定）。
   * @returns {{t, user}} 校验通过；或 {{reason, t?}} 失败原因。service 为空表示不校验 service 绑定；
   *          票据自身未绑定 service（复用模式通配票）时放行任意 service。
   */
  checkServiceTicket(token, service = '') {
    const t = this.findTicket(String(token || ''), 'service-ticket');
    if (!t) return { reason: 'notfound' };
    if (t.consumed) return { reason: 'consumed', t };
    if (t.expiresAt < Date.now()) return { reason: 'expired', t };
    if (service && t.service && t.service !== service) return { reason: 'service', t };
    const user = this.findUser(t.userId);
    if (!user || !user.enabled) return { reason: 'user', t };
    return { t, user };
  }

  /** 校验通过后消费票据：单次票标记一次性已用；复用票保持可重复消费直至过期/登出 */
  consumeTicket(t) {
    if (!t || t.reusable) return false;
    t.consumed = true;
    this.save();
    return true;
  }

  /** 会话结束（登出/过期清理）时回收其名下复用票据 */
  revokeSessionTickets(sessionId) {
    if (!sessionId) return;
    const before = this.data.tickets.length;
    this.data.tickets = this.data.tickets.filter((t) => !(t.sessionId === sessionId && t.reusable));
    if (this.data.tickets.length !== before) this.save();
  }

  purgeExpired() {
    const now = Date.now();
    const before = this.data.tickets.length;
    this.data.tickets = this.data.tickets.filter((t) => t.expiresAt > now);
    for (const sid of Object.keys(this.data.sessions)) {
      if (this.data.sessions[sid].expiresAt < now) delete this.data.sessions[sid];
    }
    if (this.data.tickets.length !== before || Object.keys(this.data.sessions).length !== before) this.save();
  }
}

/**
 * 旧版（代理模式：baseUrl + 上游响应→属性 映射）→ 新版（替身模式：本地服务路径 + 属性→响应 映射）迁移。
 * 旧映射 $.a.b → displayName 反转为 $.a.b ← displayName，接口形状保持不变。
 */
function migrateConfig(c) {
  if (!c || c.path || !c.baseUrl) return c || null;
  const mapping = (c.responseMapping || [])
    .filter((m) => m && m.source && m.target)
    .map((m) => ({ kind: 'user', source: m.target, target: m.source }));
  return {
    id: c.id,
    name: c.name,
    enabled: !!c.enabled,
    path: c.baseUrl,
    method: c.method || 'GET',
    headers: (c.headers || []).map((h) => ({ name: h.name, value: String(h.value || '').replace(/\{\{(\w+)\}\}/g, '$1') })),
    pathParams: (c.pathParams || []).map((p) => ({ name: p.name, value: 'zhangsan' })),
    queryParams: (c.queryParams || []).map((q) => ({ name: q.name, value: String(q.value || '').replace(/\{\{(\w+)\}\}/g, '') })),
    responseMapping: mapping,
    createdAt: c.createdAt,
  };
}

module.exports = { Store, DEFAULT_SETTINGS };
