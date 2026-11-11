# SSO Simulator —— 单点登录适配调试环境

**平台的替身**：子系统要适配平台单点登录，但平台因故无法开放联调地址——本系统在本地顶替平台，让子系统不改一行代码完成 SSO 调试。模拟器提供登录/票据/校验全套协议端点，并在本地**实现平台方的用户信息查询接口**（按平台契约配置，返回格式一致），全程无需访问真实平台。

## 架构

```
                       ┌─────────────────────────────┐
   子系统（被调试）      │        SSO Simulator        │      管理台维护
  ┌──────────┐  登录    │  ┌───────────────────────┐  │    ┌──────────┐
  │  重定向到  │ ──────▶ │  │ 门户登录页 / CAS / OAuth │  │◀───│ 用户管理  │
  │  模拟器    │ ◀────── │  │  票据签发 / 校验 / 登出  │  │    │ 角色管理  │
  └──────────┘  携票据  │  └───────────────────────┘  │    └──────────┘
       │                 │  ┌───────────────────────┐  │    ┌──────────┐
       │  调用户信息接口   │  │ 用户信息查询接口（替身） │  │◀───│ 接口契约   │
       └───────────────▶ │  │ 路径/Method/参数/响应格式 │  │    │ (响应参数) │
                        │  └───────────────────────┘  │    └──────────┘
                        └─────────────────────────────┘
```

## 特性

- **CAS 协议**：`/sso/login`（`/cas/login` 同样可用）、`/sso/serviceValidate`（CAS 2.0/3.0，XML & JSON）、`/sso/validate`（CAS 1.0）、一次性短时 ticket
- **OAuth2 / OIDC**：授权码模式 + `password` 模式、`/oauth2/userinfo`、`/.well-known/openid-configuration` 发现文档
- **用户信息查询接口（本地替身）**：照平台契约在模拟器上实现该接口，子系统直接调用，无需平台可达：
  - 手动配置服务路径 / Method / 请求头 / 地址参数（Path）/ 请求参数（Query），或**上传 OpenAPI 规范自动生成**
  - 响应参数：`$.data.realName ← displayName`，每行定义响应 JSON 的一个字段（取用户属性或固定值），照平台真实返回格式搭出来
  - 识别请求用户：**用 ticket 查询（平台标准模式）**——子系统携带登录回传的 ticket 调用，路径占位符 / `?ticket=` / Header / 请求体均可；给用户名也能查（调试兜底）
  - 响应预览：选用户即时看渲染结果 + curl 一键复制；可同时启用多个接口
- **角色管理 / 用户管理**：角色随校验结果以 `roles` / `roleNames` / `permissions` 返回
- **门户页面**：模拟 SSO 登录页（支持模拟用户一键登录）、登录后展示全部返回属性
- **退出到组件登录页**：`/sso/logout?service=<组件登录页>`，或在设置里配置默认登出跳转地址
- **调试日志**：最近 200 条认证相关请求（含模拟接口的调用），组件发了什么一目了然
- **内置演示配置** `GET /demo/api/user/{username}`，开箱即可跑通全链路

## 快速启动（Docker Compose）

```bash
docker compose up -d --build
```

| 地址 | 说明 |
|---|---|
| https://localhost:3000/portal | 门户（模拟 SSO 登录页） |
| https://localhost:3000/admin | 管理控制台（默认密码 `admin123`） |

- 管理密码：环境变量 `ADMIN_PASSWORD`（默认 `admin123`）
- 数据持久化：`./data/db.json`（用户、角色、接口配置、设置）
- 换端口：改 `docker-compose.yml` 里 `ports` 左侧
- 反向代理 / 自定义域名时：设置 `PUBLIC_BASE_URL`（仅影响 OIDC 发现文档中的绝对地址）

本地开发（Node ≥ 18）：

```bash
npm install && npm start
```

## 模拟账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | 123456 | admin |
| zhangsan | 123456 | user |
| lisi | 123456 | manager, user |

> 密码为明文存储（`data/db.json`），仅用于模拟调试环境，切勿放入生产或填入真实密码。

## 组件系统对接地址

设 `BASE = https://localhost:3000`（管理台"接入信息"页可一键复制）：

### CAS 方式

```
1. 登录：   GET  {BASE}/sso/login?service={组件回调地址}
           （回跳参数名可自定义：redirect_url / returnUrl / callback… 见「设置」页）
2. 校验：   GET  {BASE}/sso/serviceValidate?ticket={ticket}&service={组件回调地址}
           （加 &format=JSON 返回 JSON；CAS 1.0 用 /sso/validate；纯 JSON 也可用 /api/validate）
3. 登出：   GET  {BASE}/sso/logout?service={组件登录页}
```

子系统也可以直接把用户重定向到**门户**并携带回跳参数（`{BASE}/portal?redirect_url=...`），登录成功后同样签发票据跳回。跳回时携带的票据参数名默认 `ticket`，可在「设置」页改为 `code` / `token` 等以适配组件取参习惯。

`serviceValidate` 成功响应（节选，属性含角色 + 上游接口映射结果）：

```xml
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>zhangsan</cas:user>
    <cas:attributes>
      <cas:displayName>张三</cas:displayName>
      <cas:department>研发部/平台组</cas:department>
      <cas:roles>user</cas:roles>
      ...
    </cas:attributes>
  </cas:authenticationSuccess>
</cas:serviceResponse>
```

### OAuth2 / OIDC 方式

```
1. 授权：  GET  {BASE}/oauth2/authorize?client_id=demo&response_type=code&redirect_uri={回调}&state=xyz
2. 令牌：  POST {BASE}/oauth2/token   (form: grant_type=authorization_code&code=...&redirect_uri=...)
          也支持 grant_type=password&username=...&password=...
3. 用户：  GET  {BASE}/oauth2/userinfo   (Authorization: Bearer {access_token})
4. 发现：  GET  {BASE}/.well-known/openid-configuration
```

## 用户信息查询接口（本地替身）配置说明

管理台 →「用户接口」页。照平台方的接口契约配置，模拟器即在本地提供该接口；可同时启用多个。例如模拟 TSM：

```
配置名称    Tsm单点登录
服务路径    /TsmAas/resources/client/login/userInfo/{principal}     ← 照抄平台路径
请求方式    GET
地址参数    principal（用户名类占位符，用于识别用户）
响应参数    $.userInfo.userName ← username
            $.userInfo.realName ← displayName
            $.code ← 固定值 0
            ...
```

启用后，子系统把"用户信息查询地址"从平台换成模拟器即可（例如 `https://sso-simulator:3000/TsmAas/...`），请求返回与平台一致格式的 JSON。

- **强制校验请求头**：配置里声明的每个请求头都会被校验——**值留空=仅要求存在；填值=精确匹配**（Header 名不区分大小写）。缺头或值不匹配时，模拟器先于票据校验直接返回 `403 {"success":false,"code":403,"message":"请求头校验失败：缺少请求头 X-App-Id",…}`（贴近真实平台“先验应用身份、再验票据”的顺序）；失败详情记入「调试日志」（悬停状态码可见）。无需校验则删除对应请求头行
- **识别请求用户（ticket 优先）**：子系统携带**登录后回传的 ticket** 调用即可，位置不限——路径占位符（如 `/userInfo/ST-xxx`）、查询参数（`?ticket=`、`?token=`、`?code=`）、请求头（`ticket` / `Authorization: Bearer`）、JSON/表单请求体均可；模拟器按票据找到登录用户。ticket 有效期与 CAS 校验一致（设置页可调），已消费但未过期的 ticket 仍可识别身份。给用户名也能查（调试兜底），识别不到返回 401
- **响应取值**：用户属性（`username userId displayName email phone department position roles roleNames permissions`，来自用户/角色管理）或固定值（`true`、`0`、`ok` 等协议性字段）
- **上传 OpenAPI**：粘贴或上传平台的规范（`examples/user-api-openapi.json` 有示例），按操作导入——自动带出路径、Method、Path/Query/Header 参数，并按响应 Schema 生成初始映射（字段名对得上用户属性的自动关联，如 `realName ← displayName`、`mobile ← phone`），再微调即可
- **响应预览**：选一个用户即时查看渲染出的响应和调用地址，可复制 curl
- 这些请求会进入「调试日志」（含来源标记），方便核对子系统实际发了什么

## 子系统菜单（iframe 内嵌呈现）

登录门户后左侧出现工作台菜单：**「用户信息」为首页**（展示当前用户与全部返回属性），下方按顺序排列各**子系统菜单**（管理台 →「菜单管理」维护）。流程：

```
点击菜单 → 模拟器为当前用户现签发一张 ticket
        → 按配置拼到子系统地址后（查询参数 ?ticket=… 或 路径参数 …/ST-xxx）
        → iframe 打开；期间仅展示加载页
        → 子系统拿 ticket 调「用户信息查询接口」完成登录
        → 加载完成呈现子系统页面（超时则展示失败页，可重试/新窗口打开）
```

菜单配置项：**菜单名称**、**子系统页面地址**（子系统提供的 URL）、**票据携带方式**（查询参数 / 路径参数；地址含 `{ticket}` 占位符时按占位符替换）、**排序**、**启用**。查询参数名复用「设置」里的票据参数名（默认 `ticket`）。

内置「演示子系统」（`/demo-sub`）演示子系统侧完整对接：从 URL 取 ticket → 调用户信息接口 → 渲染登录后的页面，可直接切换其票据携带方式体验两种模式。

## 登录回跳与票据参数（可自定义）

子系统跳转到模拟器登录页时，回跳地址的参数名不必是 `service`。管理台 →「设置」：

- **登录回跳参数名**（默认 `service, redirect_url, redirectUrl, returnUrl, callback, backUrl`，按优先级取第一个命中的）
- **票据参数名**（默认 `ticket`，可改 `code` / `token` 等）
- **票据单次有效**（默认开启）：开启即标准 CAS——每次进入子系统现签一张短时效 ticket，校验一次即消费；关闭则模拟「票据可重复消费」平台——门户登录态期间，门户菜单、登录回跳、`/sso/login` 下发的都是**同一张有效票据**（不绑定单一 service，多个子系统可共用），各校验端点（`/api/validate`、`/sso/validate`、`/sso/serviceValidate`、`/sso/validatejson`）可反复校验通过，直到门户登出或会话过期才失效。适用于调试子系统侧票据缓存/重放类的对接行为。

生效范围：门户 `/portal?redirect_url=…`、`/sso/login`、票据校验时的 service 匹配、登出跳转，全链路一致。例如子系统用 `redirect_url` + 取 `code`：

```
GET {BASE}/portal?redirect_url=http://子系统/cb
→ 登录成功后 302：http://子系统/cb?code=ST-xxxxxxxx
```

## 退出到组件登录页

三种方式任选：

1. 组件主动登出：重定向到 `GET {BASE}/sso/logout?service={组件登录页}`（也接受 `url` 参数及自定义回跳参数名）
2. 默认登出地址：管理台 →「设置」→「默认登出跳转地址」，门户点「退出登录」即跳组件登录页
3. 都不配置时，退出回到模拟器自身门户

## 目录结构

```
├── docker-compose.yml
├── Dockerfile
├── server/
│   ├── index.js            # 应用装配、CORS、调试日志
│   ├── store.js            # JSON 文件持久化 + 种子数据 + 旧配置迁移
│   ├── sessions.js         # 门户 / 管理员会话
│   ├── userinfo.js         # 用户属性 + 响应渲染（本地替身）
│   ├── serve-userinfo.js   # 按配置动态提供用户信息查询接口
│   ├── openapi.js          # OpenAPI 解析与导入
│   ├── routes-sso.js       # CAS 协议端点
│   ├── routes-oauth.js     # OAuth2/OIDC 端点
│   ├── routes-portal.js    # 门户后端 + 内置演示接口
│   └── routes-admin.js     # 管理控制台后端
├── public/                 # 门户与管理台前端（无构建步骤）
└── examples/
    ├── user-api-openapi.json   # 示例规范，用于测试导入
    └── test-flow.sh            # 端到端流程验证脚本
```

## 验证

```bash
./examples/test-flow.sh https://localhost:3000
```

脚本覆盖：模拟接口直连与令牌识别、CAS 登录/校验（XML+JSON）、票据一次性、OAuth2 授权码全流程、OIDC 发现文档、登出跳转组件登录页。

## 常见问题

**子系统调用模拟的用户信息接口返回 404？**

- 配置未**启用**：到「用户接口」页启用对应配置
- 路径不一致：子系统调用的路径必须与配置的「服务路径」完全一致（含大小写，如 `userInfo` ≠ `userinfo`）
- 请求方式不一致：配置 GET 时 POST 不会命中
- 占位符（如 `{principal}`）需与「地址参数」的参数名一致，仅用于识别用户，不影响路径匹配

**返回 401（ticket 无效或已过期）？**

- 标准用法是携带**登录后回传的 ticket**（路径占位符 / `?ticket=` / Header / 请求体均可）；票据须为模拟器签发且未过期
- ticket 默认 60 秒有效（与 CAS 校验一致），手工调试嫌短可在「设置」里调大 `CAS Ticket 有效期`；已消费但未过期的 ticket 仍能识别身份
- 或在路径/参数里带上存在的用户名（调试兜底）；用户被禁用同样识别不到

**响应里缺字段？**

用「响应预览」核对渲染结果：确认响应参数每行的字段路径（如 `$.userInfo.realName`）层级正确、来源属性拼写正确（可用下拉选择）、固定值留空的行不会输出。

**子系统在另一台机器/容器里，怎么访问模拟器？**

用模拟器所在机器的 IP 或主机名（不要用 `localhost`），例如 `https://192.168.1.10:3000/...`；Docker 部署时端口映射默认已发布到宿主机 `0.0.0.0:3000`。
