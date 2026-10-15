#!/usr/bin/env bash
# 共享：定位仓库、载入 env、按端口查 pid
# 被 start.sh / stop.sh / status.sh / build.sh source

set -uo pipefail

LAN_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LAN_SCRIPT_DIR/../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/readest-app"
STANDALONE="$APP_DIR/.next/standalone"
LAN_ENV="${LAN_ENV:-$HOME/readest-lan/webdav.env}"
LOGS="$HOME/readest-lan/logs"

# env 文件不存在就从仓库里的模板生成一份（含随机密码），并提示去改
ensure_env() {
  if [ ! -f "$LAN_ENV" ]; then
    mkdir -p "$(dirname "$LAN_ENV")"
    local pass="lan-$(head -c 9 /dev/urandom | base64 | tr -d '/+=' | head -c 12)"
    sed -e "s|^WEBDAV_PASS=.*|WEBDAV_PASS=$pass|" \
        -e "s|^SYNC_ROOT=.*|SYNC_ROOT=$HOME/readest-sync|" \
        "$LAN_SCRIPT_DIR/lan.env.example" > "$LAN_ENV"
    chmod 600 "$LAN_ENV"
    echo "!! 已生成 $LAN_ENV（WebDAV 密码是随机的）—— 记得看一眼，Readest 设置里要用"
  fi
  # shellcheck disable=SC1090
  set -a; . "$LAN_ENV"; set +a
  : "${WEBDAV_USER:=readest}"
  : "${SYNC_ROOT:=$HOME/readest-sync}"
  : "${HUB_PORT:=17322}"
  : "${APP_PORT:=17321}"
}

# 按端口找 pid（绝不用 pkill -f：bash -c 的 argv 含整段脚本，会自杀）
pids_on_port() {
  ss -ltnp 2>/dev/null | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | sort -u || true
}

port_listening() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
