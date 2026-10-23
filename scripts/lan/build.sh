#!/usr/bin/env bash
# 重建 standalone 产物（= plan 的 [P0-1] + [P0-2]）
# 会先停服务，避免「跑着旧 server + 换了新 chunk」的混合态
# 用法：pnpm lan:build
set -euo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

echo "=== 先停服务 ==="
"$LAN_SCRIPT_DIR/stop.sh" || true

cd "$APP_DIR"
echo "=== 构建（BUILD_STANDALONE=true, web 平台）==="
BUILD_STANDALONE=true pnpm build

echo "=== 把 .next/static 与 public 拷进 standalone（不拷会白屏）==="
DEST="$STANDALONE/apps/readest-app"
[ -d "$STANDALONE" ] || { echo "!! 没有生成 $STANDALONE；构建是不是失败了？"; exit 1; }
rm -rf "$DEST/.next/static" "$DEST/public"
cp -r .next/static "$DEST/.next/static"
cp -r public "$DEST/public"
du -sh "$STANDALONE"

echo
echo "构建完成。启动：pnpm start（或一条命令：pnpm rebuild）"
echo "提示：如果同时要打 APK，先关掉模拟器——cargo/gradle 的并行编译会把它挤死。"
