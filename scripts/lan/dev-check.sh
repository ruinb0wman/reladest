#!/usr/bin/env bash
# 手机连不上时先跑这个：两个端口、hub 认证探活、镜像内容、手机该填的地址。
#   用法：pnpm dev:check
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

rc=0
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')

echo "=== 端口 ==="
for port in "$APP_PORT" "$HUB_PORT"; do
  printf ' :%s  %s\n' "$port" "$(port_listening "$port" && echo '在听' || { rc=1; echo '没在听（pnpm dev 起了吗？）'; })"
done

echo "=== hub 认证探活 ==="
code=$(curl -s -o /dev/null -m 5 -u "$WEBDAV_USER:$WEBDAV_PASS" -X PROPFIND -H 'Depth: 0' \
  -w '%{http_code}' "http://127.0.0.1:$HUB_PORT/Readest")
if [ "$code" = "207" ]; then
  echo " 207 ✓ 认证通、/Readest 存在"
else
  rc=1
  case "$code" in
    401) echo " 401 ✗ 认证失败：webdav.env 里的密码和 App 里填的不一致？" ;;
    404) echo " 404 ✗ /Readest 还不存在：PC 端还没同步过（浏览器里点一次同步）" ;;
    000) echo " ✗ 连不上：hub 没起" ;;
    *)   echo " $code ✗ 非预期响应" ;;
  esac
fi

echo "=== 镜像 $SYNC_ROOT/Readest ==="
ROOT="$SYNC_ROOT/Readest"
if [ -d "$ROOT" ]; then
  books=$(ls -1 "$ROOT/books" 2>/dev/null | wc -l)
  printf ' 书 %s 本   library.json %s   settings.json %s\n' \
    "$books" \
    "$([ -f "$ROOT/library.json" ] && echo ✓ || echo '✗ 缺')" \
    "$([ -f "$ROOT/settings.json" ] && echo ✓ || echo '✗ 缺')"
else
  rc=1; echo " 目录不存在"
fi

echo "=== 手机该填 ==="
echo " http://${LAN_IP:-<本机IP>}:$HUB_PORT   用户 $WEBDAV_USER   密码见 $LAN_ENV"
echo " 手机连不上但 hub 正常？先查 Windows 防火墙（必须 -Profile Any）："
echo "   New-NetFirewallRule -DisplayName ReadestLAN -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HUB_PORT -Profile Any"
exit $rc
