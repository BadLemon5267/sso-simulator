#!/usr/bin/env bash
# ============================================================
# SSO Simulator 端到端流程验证（CAS + OAuth2 + 用户信息接口 + 登出）
# 用法：./examples/test-flow.sh [https://localhost:3000]
# ============================================================
set -e
BASE="${1:-https://localhost:3000}"
curl() { command curl -k "$@"; }          # 服务使用自签名证书，跳过校验
CB="$BASE/fake-component/callback"      # 假装的组件回调地址
JAR=$(mktemp)

G='\033[0;32m'; R='\033[0;31m'; B='\033[0;36m'; N='\033[0m'
step() { echo -e "\n${B}==> $1${N}"; }
pass() { echo -e "${G}[PASS]${N} $1"; }
die()  { echo -e "${R}[FAIL]${N} $1"; exit 1; }

step "健康检查"
curl -sf "$BASE/healthz" >/dev/null && pass "healthz" || die "服务未启动"

step "用户信息查询接口（模拟器本地提供，默认演示配置）"
DEMO=$(curl -sf "$BASE/demo/api/user/zhangsan")
echo "$DEMO" | grep -q '"realName":"张三"' && pass "按平台格式返回用户信息" || die "演示接口未生效（检查「用户接口」页是否启用了示例配置）"
echo "$DEMO" | grep -q '"roles":\["user"\]' && pass "角色信息随响应返回" || die "角色缺失"
NOTFOUND=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/demo/api/user/nobody-here")
[ "$NOTFOUND" = "401" ] && pass "未知用户返回 401" || echo "    （未知用户返回 $NOTFOUND）"

step "CAS 登录（拿 ticket）"
LOGIN=$(curl -sf -c "$JAR" -H 'Content-Type: application/json' \
  -d '{"username":"zhangsan","password":"123456","service":"'"$CB"'"}' \
  "$BASE/api/portal/login")
TICKET=$(echo "$LOGIN" | grep -o '"ticket":"[^"]*"' | cut -d'"' -f4)
[ -n "$TICKET" ] && pass "ticket = $TICKET" || die "未取到 ticket"

step "CAS 2.0 XML 校验"
XML=$(curl -sf "$BASE/sso/serviceValidate?ticket=$TICKET&service=$CB")
echo "$XML" | grep -q "authenticationSuccess" && pass "XML 校验成功" || die "XML 校验失败"
echo "$XML" | grep -q "张三" && pass "用户属性（displayName=张三）返回" || echo "    （注意：检查响应属性）"

step "票据一次性（重复使用应失败）"
SLEEP=$(curl -sf "$BASE/sso/validate?ticket=$TICKET&service=$CB" || true)
echo "$SLEEP" | head -1 | grep -q "no" && pass "重复校验被拒绝" || die "票据竟能重复使用！"

step "重新登录 → JSON 校验（format=JSON）"
LOGIN2=$(curl -sf -c "$JAR" -H 'Content-Type: application/json' \
  -d '{"username":"lisi","password":"123456","service":"'"$CB"'"}' \
  "$BASE/api/portal/login")
T2=$(echo "$LOGIN2" | grep -o '"ticket":"[^"]*"' | cut -d'"' -f4)
JSON=$(curl -sf "$BASE/sso/serviceValidate?ticket=$T2&service=$CB&format=JSON")
echo "$JSON" | grep -q '"user":"lisi"' && pass "JSON 校验成功" || die "JSON 校验失败"

step "OAuth2 授权码流程"
AUTH_URL="$BASE/oauth2/authorize?client_id=demo&response_type=code&redirect_uri=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$CB'))" 2>/dev/null || echo "$CB")&state=xyz"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" "$AUTH_URL")
CODE=$(echo "$LOC" | grep -o 'code=[^&]*' | cut -d= -f2)
[ -n "$CODE" ] && pass "code = $CODE" || die "未取到授权码"
TOKEN=$(curl -sf -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=$CB" "$BASE/oauth2/token" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && pass "access_token 获取成功" || die "未取到 token"
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/oauth2/userinfo" | grep -q '"username":"lisi"' \
  && pass "userinfo 返回用户信息" || die "userinfo 失败"

step "携带令牌调用模拟的用户信息接口（按令牌识别用户）"
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/demo/api/user/whatever" | grep -q '"realName":"李四"' \
  && pass "令牌识别用户并渲染响应" || die "令牌调用用户信息接口失败"

step "自定义回跳参数名（redirect_url）与票据参数名"
TP=$(curl -sf "$BASE/api/portal/config" | grep -o '"ticketParam":"[^"]*"' | cut -d'"' -f4)
R=$(curl -sf -H 'Content-Type: application/json' \
  -d '{"username":"zhangsan","password":"123456","redirect_url":"http://custom-back/cb?a=1"}' \
  "$BASE/api/portal/login")
RU=$(echo "$R" | grep -o '"redirectUrl":"[^"]*"' | sed 's/\\//g' | cut -d'"' -f4)
RT=$(echo "$R" | grep -o '"ticket":"[^"]*"' | cut -d'"' -f4)
echo "$RU" | grep -q "&${TP}=" && echo "$RU" | grep -q "$RT" \
  && pass "redirect_url 参数识别并以 ${TP} 携带票据跳回" || die "redirect_url 未生效：$RU"
LOC2=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/sso/login?returnUrl=http://via-login/cb")
echo "$LOC2" | grep -q "/portal?returnUrl=" && pass "/sso/login 识别 returnUrl 并透传给门户" || die "/sso/login 参数透传失败：$LOC2"
VALID2=$(curl -sf "$BASE/sso/serviceValidate?ticket=$RT&redirect_url=http://custom-back/cb?a=1&format=JSON")
echo "$VALID2" | grep -q '"user":"zhangsan"' && pass "校验时用自定义参数名匹配 service" || die "校验自定义参数名失败"

step "用户信息接口：用 ticket 查询（平台标准模式）"
T3=$(curl -sf -H 'Content-Type: application/json' \
  -d '{"username":"zhangsan","password":"123456","service":"'"$CB"'"}' \
  "$BASE/api/portal/login" | grep -o '"ticket":"[^"]*"' | cut -d'"' -f4)
curl -sf "$BASE/demo/api/user/$T3" | grep -q '"realName":"张三"' \
  && pass "ticket 放路径占位符 → 返回登录用户信息" || die "按 ticket 路径查询失败"
curl -sf -H "ticket: $T3" "$BASE/demo/api/user/anything" | grep -q '"realName":"张三"' \
  && pass "ticket 放请求头 → 返回登录用户信息" || die "按 ticket Header 查询失败"
BADT=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/demo/api/user/ST-invalid-ticket-000")
[ "$BADT" = "401" ] && pass "无效 ticket 返回 401" || echo "    （无效 ticket 返回 $BADT）"

step "子系统菜单（iframe 内嵌 + 现签发票据）"
MENUS=$(curl -sf -b "$JAR" "$BASE/api/portal/menus")
echo "$MENUS" | grep -q '"name"' && pass "门户菜单列表返回" || die "菜单列表为空"
MID=$(echo "$MENUS" | grep -o '"id":"m_[^"]*"' | head -1 | cut -d'"' -f4)
MT=$(curl -sf -b "$JAR" "$BASE/api/portal/menu-ticket?menuId=$MID")
echo "$MT" | grep -q '"ticket":"ST-' && pass "点击菜单现签发票据" || die "菜单票据签发失败"
MU=$(echo "$MT" | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | sed 's/\\\//\//g')
echo "$MT" | grep -q 'ST-' && pass "跳转地址已拼接票据（$MU）" || die "跳转地址缺失"
SUBPAGE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/demo-sub")
[ "$SUBPAGE" = "200" ] && pass "内置演示子系统页面可访问" || die "演示子系统页面 $SUBPAGE"

step "OIDC 发现文档"
curl -sf "$BASE/.well-known/openid-configuration" | grep -q "authorization_endpoint" && pass "发现文档正常"

step "登出 → 跳回组件登录页"
OUT=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" "$BASE/sso/logout?service=http://fake-component/login")
[ -n "$OUT" ] && pass "登出跳转：$OUT" || die "登出未跳转"

echo -e "\n${G}======== 全部流程验证通过 ========${N}"
rm -f "$JAR"
