#!/usr/bin/env bash
# 一条命令做完「停 → 构建 standalone → 起」。
# 用法：pnpm lan:rebuild
#
# 存在的理由：lan:build 只构建不启动（构建要能单独跑，比如 APK 打包期间），
# 但日常改完代码想立刻看效果时，分开敲两条命令总会漏掉第二条。
set -euo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

"$LAN_SCRIPT_DIR/build.sh"
"$LAN_SCRIPT_DIR/start.sh"
"$LAN_SCRIPT_DIR/status.sh" || true
