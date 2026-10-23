#!/usr/bin/env bash
# 盯 hub 日志（Next dev 的输出在 pnpm dev 那个终端里，不在这）。
#   用法：pnpm dev:logs
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env
mkdir -p "$LOGS"
touch "$LOGS/webdav.log"
echo "== $LOGS/webdav.log（Ctrl-C 退出）=="
exec tail -n 40 -f "$LOGS/webdav.log"
