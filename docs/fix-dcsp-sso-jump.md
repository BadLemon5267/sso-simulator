# 修复"无法跳转进数据脱敏子系统"操作手册

> 2026-11-11 排查结论。共三层问题：①dcsp 后端指向旧网段 IP（当前报"平台认证服务异常"的直接原因）②浏览器 iframe 被 5173 自签证书拦截（点菜单进不去的直接原因，`verify_ssl` 管不到浏览器）③后端证书校验（你已关闭，✅ 已解决）。
>
> 环境事实：本机当前 IP `192.168.77.89`（原 `192.168.3.89`，DHCP 变更）；dcsp 部署于 `~/文档/ayth/gitlab/dcsp/docker`；sso-simulator 部署于本仓库；容器访问宿主机端口**只能走局域网 IP**（docker 网关 172.24.0.1 与 172.17.0.1 均被宿主机防火墙拒绝）。

---

## 第一步：修正 dcsp 后端地址（立即生效，解决"平台认证服务异常"）

二选一：

**方式 A（推荐，走页面）**：数据脱敏系统 → 系统配置 → 单点登录
- 平台服务地址：`https://192.168.77.89:3000`
- 平台门户地址：`https://192.168.77.89:3000`

**方式 B（SQL 直改）**：

```bash
docker exec dcsp-postgres psql -U dcsp_user -d dcsp -c \
  "UPDATE core_system_config SET value='https://192.168.77.89:3000' WHERE key IN ('sso.platform_base_url','sso.portal_url');"
```

配置每次校验时从库里现读，无需重启。验证：`docker logs dcsp-backend --since 2m | grep SSO` 不再出现 `SSO 平台接口调用失败`。

> ⚠️ DHCP 换网段后需同步改 3 处：`sso.platform_base_url`、`sso.portal_url`、门户"菜单管理"里的菜单 URL。

---

## 第二步：本地 CA + 新证书（根治 iframe，一次性）

```bash
# 0) 工作目录
mkdir -p ~/.local-dev-ca && cd ~/.local-dev-ca

# 1) 生成 10 年本地 CA
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=Local Dev SSO CA" -keyout dev-ca.key -out dev-ca.crt

# 2) SAN 配置：新旧网段都备上（以后在 3.x/77.x 网段都能用）
cat > san.cnf <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.3.89,IP:192.168.77.89
extendedKeyUsage=serverAuth
EOF

# 3) 签两张服务证书（helper）
issue() {
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout $2.key -out $2.csr
  openssl x509 -req -in $2.csr -CA dev-ca.crt -CAkey dev-ca.key -CAcreateserial \
    -days 3650 -extfile san.cnf -out $2.crt
}
issue dcsp-dev dcsp-dev      # 数据脱敏前端
issue sso-simulator server   # 模拟器
```

### 4) 替换 dcsp 前端证书（compose 已挂载 `docker/dev-certs → /certs`，机制现成）

```bash
cp ~/.local-dev-ca/dcsp-dev.{crt,key} ~/文档/ayth/gitlab/dcsp/docker/dev-certs/
docker restart dcsp-frontend
```

### 5) 替换模拟器证书（加卷挂载，重建后也持久）

`docker-compose.yml` 的 `volumes` 增加一行：

```yaml
    volumes:
      - ./data:/app/data
      - ./certs:/app/certs     # ← 新增
```

```bash
cp ~/.local-dev-ca/server.crt ~/git/sso-simulator/certs/server.crt
cp ~/.local-dev-ca/server.key ~/git/sso-simulator/certs/server.key
cd ~/git/sso-simulator && docker compose up -d
```

### 6) CA 导入 Chrome 信任库（NSS，本机已装 certutil）

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Local Dev SSO CA" -i ~/.local-dev-ca/dev-ca.crt
```

然后**完全退出 Chrome 再重开**（地址栏输入 `chrome://restart` 或杀掉进程）。Firefox 无此库：设置 → 隐私与安全 → 证书 → 导入 `dev-ca.crt` 并勾选信任。

---

## 第三步：验证

1. 新标签直接开 `https://192.168.77.89:5173/` —— 应**无**"您的连接不是私密连接"警告
2. 开 `https://192.168.77.89:3000/portal` 登录 → 点"数据脱敏"菜单 → iframe 内正常进入系统
3. 仍报"平台认证服务异常" → 回第一步检查地址；`docker logs dcsp-backend --since 5m | grep -i sso` 看具体报错

## 可选收尾

- **恢复 dcsp 的 HTTPS 证书校验**（更接近真实环境）：backend 服务挂 CA 并设环境变量后，重新打开"校验HTTPS证书"：
  ```yaml
  # dcsp docker-compose.yml 的 backend:
  environment:
    REQUESTS_CA_BUNDLE: /certs/dev-ca.crt
  volumes:
    - ./dev-certs/dev-ca.crt:/certs/dev-ca.crt:ro
  ```
- **换网段痛点**：证书 SAN 已同时覆盖 3.x/77.x 两个网段；再换新网段时需重签（重复第二步 2-5，SAN 加新 IP）并重导证书，或改用固定 IP / `/etc/hosts` 域名方案。
