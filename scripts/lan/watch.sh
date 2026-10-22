#!/usr/bin/env bash
# 看门狗：两个服务哪个掉了就把它拉起来（曾经有一次 Next 静默退出）。
# 用法：pnpm lan:watch     （前台常驻，Ctrl-C 退出）
#
# 只监听端口，不猜进程名：谁在听就用谁，掉了就按 start.sh 的规则重起对应服务。
set -uo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

INTERVAL="${WATCH_INTERVAL:-30}"
echo "看门狗启动：每 ${INTERVAL}s 检查 :$APP_PORT 与 :$HUB_PORT（Ctrl-C 退出）"
while true; do
  if ! port_listening "$HUB_PORT"; then
    echo "$(date '+%F %T') :$HUB_PORT 掉了 → 重启 webdav hub"
    SYNC_ROOT="$SYNC_ROOT" HUB_PORT="$HUB_PORT" WEBDAV_USER="$WEBDAV_USER" WEBDAV_PASS="$WEBDAV_PASS" \
      nohup setsid node "$LAN_SCRIPT_DIR/dav-server.mjs" >> "$LOGS/webdav.log" 2>&1 &
  fi
  if ! port_listening "$APP_PORT"; then
    echo "$(date '+%F %T') :$APP_PORT 掉了 → 重启 app"
    "$LAN_SCRIPT_DIR/start.sh" >> "$LOGS/watchdog.log" 2>&1 || true
  fi
  sleep "$INTERVAL"
done
