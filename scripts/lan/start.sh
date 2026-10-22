#!/usr/bin/env bash
# 起 Readest LAN 档：Next standalone (:APP_PORT) + WebDAV hub (:HUB_PORT)
# 用法：pnpm lan:start
set -uo pipefail
# shellcheck source=./lan-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env
mkdir -p "$LOGS" "$SYNC_ROOT"

if [ ! -f "$STANDALONE/apps/readest-app/server.js" ]; then
  echo "!! 没找到 standalone 构建：$STANDALONE"
  echo "   先跑：pnpm lan:build"
  exit 1
fi

for p in "$APP_PORT" "$HUB_PORT"; do
  if port_listening "$p"; then echo "!! :$p 已被占用（先 pnpm lan:stop，或用 pnpm lan:status 看看是谁）"; exit 1; fi
done

# --- WebDAV hub（我们自己的小服务，见 scripts/lan/dav-server.mjs）---
# 换掉 rclone 的理由：只需要 OPTIONS/HEAD/GET/PUT/MKCOL/DELETE/PROPFIND 七个动词，
# 而 rclone 是 60 MB 的外部二进制，配置语法还要单独学。自己这份 ~250 行、跟着仓库走，
# 出错时日志和代码都在手边。Next 的 route handler 顶不上：App Router 只派发它认识的
# 方法，PROPFIND/MKCOL 根本进不来。
SYNC_ROOT="$SYNC_ROOT" HUB_PORT="$HUB_PORT" WEBDAV_USER="$WEBDAV_USER" WEBDAV_PASS="$WEBDAV_PASS" \
  nohup setsid node "$LAN_SCRIPT_DIR/dav-server.mjs" >> "$LOGS/webdav.log" 2>&1 &
echo "webdav hub   pid=$!   http://0.0.0.0:$HUB_PORT   root=$SYNC_ROOT"

# --- Next standalone（LAN 档 env，理由见 plan §0.1）---
#   SELF_HOSTED      → 解锁 premium（否则 WebDAV 行被 paywall 挡）
#   API_BASE_URL     → 否则生产构建会打 https://web.readest.com/api
# 不再需要 SUPABASE_* 假值：账号/云存储那套已经删了，.env 里的 base64 公有
# 密钥也一并移除，没有任何代码路径会去读它们。
cd "$STANDALONE"
SELF_HOSTED=true \
API_BASE_URL="http://localhost:$APP_PORT" \
PORT="$APP_PORT" HOSTNAME=0.0.0.0 \
nohup setsid node apps/readest-app/server.js \
  > "$LOGS/app.log" 2>&1 &
echo "readest app  pid=$!   http://localhost:$APP_PORT  (LAN: http://<本机IP>:$APP_PORT)"

sleep 3
echo "--- 探活 ---"
curl -s -o /dev/null -w "app  /              -> %{http_code}\n" "http://127.0.0.1:$APP_PORT/"
curl -s -o /dev/null -u "$WEBDAV_USER:$WEBDAV_PASS" -X PROPFIND -H 'Depth: 1' \
  -w "dav  PROPFIND       -> %{http_code}\n" "http://127.0.0.1:$HUB_PORT/"
echo "日志：pnpm lan:logs    状态：pnpm lan:status"
