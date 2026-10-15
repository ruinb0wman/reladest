#!/usr/bin/env bash
# 看 Readest LAN 档状态：端口 / 探活 / runtime-config / 外联自检 / 日志尾巴
# 用法：pnpm lan:status   （加 -v 同时 tail 日志）
set -uo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

echo "=== 进程 ==="
for port in "$APP_PORT" "$HUB_PORT"; do
  pids=$(pids_on_port "$port")
  if [ -z "$pids" ]; then echo ":$port 未监听"; else
    for pid in $pids; do echo ":$port pid=$pid $(tr '\0' ' ' < /proc/$pid/cmdline | cut -c1-70)"; done
  fi
done

echo
echo "=== 探活 ==="
curl -s -o /dev/null -w "app  /                -> %{http_code}\n" "http://127.0.0.1:$APP_PORT/" || echo "app 不通"
curl -s -o /dev/null -w "app  /runtime-config  -> %{http_code}\n" "http://127.0.0.1:$APP_PORT/runtime-config.js" || true
curl -s -o /dev/null -u "$WEBDAV_USER:$WEBDAV_PASS" -X PROPFIND -H 'Depth: 1' \
  -w "dav  PROPFIND         -> %{http_code}\n" "http://127.0.0.1:$HUB_PORT/" || echo "dav 不通"

echo
echo "=== runtime-config（红线 2/3 的自检）==="
curl -s "http://127.0.0.1:$APP_PORT/runtime-config.js" || echo "(取不到)"
echo
echo "  应当出现：selfHosted:true / apiBaseUrl:http://localhost:$APP_PORT / supabaseUrl:http://127.0.0.1:9/"

echo
echo "=== 同步根 ==="
ls -la "$SYNC_ROOT" 2>/dev/null | head -10 || echo "(还没有 $SYNC_ROOT)"

if [ "${1:-}" = "-v" ]; then
  echo
  echo "=== app.log（尾 15）==="; tail -15 "$LOGS/app.log" 2>/dev/null
  echo
  echo "=== webdav.log（尾 15）==="; tail -15 "$LOGS/webdav.log" 2>/dev/null
fi
