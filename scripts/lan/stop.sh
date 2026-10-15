#!/usr/bin/env bash
# 停 Readest LAN 档（按端口找 pid，不用 pkill -f）
# 用法：pnpm lan:stop
set -uo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

for port in "$APP_PORT" "$HUB_PORT"; do
  pids=$(pids_on_port "$port")
  if [ -z "$pids" ]; then echo ":$port 没人监听"; continue; fi
  for pid in $pids; do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-60 || echo '?')
    kill "$pid" 2>/dev/null && echo "killed :$port pid=$pid ($cmd)"
  done
done

sleep 1
if ss -ltn 2>/dev/null | grep -qE ":($APP_PORT|$HUB_PORT) "; then
  echo "--- 还在监听，强杀 ---"
  for port in "$APP_PORT" "$HUB_PORT"; do
    for pid in $(pids_on_port "$port"); do kill -9 "$pid" 2>/dev/null && echo "killed -9 :$port pid=$pid"; done
  done
  sleep 1
fi
ss -ltn 2>/dev/null | grep -E ":($APP_PORT|$HUB_PORT) " || echo "全部已停"
