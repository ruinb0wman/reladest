#!/usr/bin/env bash
# PC 端开发入口：一条命令起「WebDAV hub + Next dev」。
#   用法：pnpm dev
#
# 为什么 hub 也在这里起：手机同步只连 :HUB_PORT，跟 PC 的 Next 服务无关。
# 如果 hub 只在别的命令里起，那开发时手机就同步不了。
# 两个进程都在前台进程树里：Ctrl-C 一起收，不残留孤儿。
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

# 上一次被强杀留下的残留，先清掉（端口是我们自己的）
for port in "$APP_PORT" "$HUB_PORT"; do
  pids=$(pids_on_port "$port")
  if [ -n "$pids" ]; then
    echo "清理 :$port 上的残留进程：$pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
done

LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
echo
echo "──────────────────────────────────────────────────────────"
echo " PC     http://localhost:$APP_PORT"
echo " 手机   http://${LAN_IP:-<本机IP>}:$HUB_PORT   (用户 $WEBDAV_USER，密码见 $LAN_ENV)"
echo " 排查   pnpm dev:check   /   pnpm dev:logs"
echo "──────────────────────────────────────────────────────────"
echo

mkdir -p "$LOGS"
DAV_VERBOSE="${DAV_VERBOSE:-1}" SYNC_ROOT="$SYNC_ROOT" HUB_PORT="$HUB_PORT" WEBDAV_USER="$WEBDAV_USER" WEBDAV_PASS="$WEBDAV_PASS" \
  node "$LAN_SCRIPT_DIR/dav-server.mjs" >> "$LOGS/webdav.log" 2>&1 &
HUB_PID=$!

cleanup() {
  kill "$HUB_PID" 2>/dev/null || true
  wait "$HUB_PID" 2>/dev/null || true
  echo; echo "hub 已停（:${HUB_PORT}）"
}
trap cleanup EXIT INT TERM

cd "$APP_DIR"
# 前台跑 Next dev；它退出（Ctrl-C / 报错）时 trap 收掉 hub
pnpm dev
