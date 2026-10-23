#!/usr/bin/env bash
# 打 Android APK（单架构）。
#   用法：pnpm apk:x86 | pnpm apk:arm64
#         bash scripts/lan/apk.sh <x86_64|aarch64> [--debug] [--devtools]
#
#   --debug     调试构建（可调试，devtools socket 自动有）
#   --devtools  release + tauri/devtools 特性（要 CDP 连真机时用，见知识库）
#
# 产物同时拷到 ~/readest-lan/dist/readest-lan-v<版本>-<架构>.apk。
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"
ensure_env

ARCH="${1:-}"
case "$ARCH" in
  x86_64|aarch64) ;;
  *) echo "!! 架构只能是 x86_64 或 aarch64（给的是 '${ARCH:-空}'）"; exit 1 ;;
esac
shift || true

MODE="release"
FEATURES=()
for arg in "$@"; do
  case "$arg" in
    --debug) MODE="debug" ;;
    --devtools) FEATURES+=("--features" "tauri/devtools") ;;
    *) echo "!! 不认识的参数：$arg"; exit 1 ;;
  esac
done

# --- 工具链 ---
# 故意用自己的变量名：环境里可能有个 ANDROID_HOME 指向别的 SDK（没接受过 license），
# 继承它会让 gradle 报 "licences have not been accepted"。要换路径请设 READEST_ANDROID_SDK。
SDK="${READEST_ANDROID_SDK:-$HOME/android-sdk}"
NDK_DIR="${READEST_NDK_HOME:-$(ls -d "$SDK"/ndk/* 2>/dev/null | tail -1)}"
JDK="${READEST_JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
for p in "$SDK" "$NDK_DIR" "$JDK"; do
  [ -e "$p" ] || { echo "!! 找不到：$p（用 READEST_ANDROID_SDK / READEST_NDK_HOME / READEST_JAVA_HOME 覆盖）"; exit 1; }
done

# tauri.conf.json 的 version 是相对路径（"../package.json"），直接取 app 的 package.json
VERSION=$(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo "0.0.0")
DIST="$HOME/readest-lan/dist"
mkdir -p "$DIST"

echo "=== $ARCH / $MODE ==="
cd "$APP_DIR"
BUILD_ARGS=(android build -t "$ARCH")
[ "$MODE" = "debug" ] && BUILD_ARGS+=(--debug)
[ ${#FEATURES[@]} -gt 0 ] && BUILD_ARGS+=("${FEATURES[@]}")

MARKER=$(mktemp)
# CLI 偶尔在 APK/AAB 都产出之后仍返回非 0（没有任何错误信息）；所以不拿它的退出码当唯一判据，
# 而是看「产物是否比这次开始新」。真失败（cargo/gradle 报错）时产物不会更新，照旧报错退出。
set +e
env -u ANDROID_SDK_ROOT -u ANDROID_HOME -u NDK_HOME \
    JAVA_HOME="$JDK" \
    ANDROID_HOME="$SDK" \
    NDK_HOME="$NDK_DIR" \
  pnpm exec tauri "${BUILD_ARGS[@]}"
RC=$?
set -e

KIND="release"; [ "$MODE" = "debug" ] && KIND="debug"
APK="$APP_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/$KIND/app-universal-release.apk"
if [ ! -f "$APK" ] || [ "$APK" -ot "$MARKER" ]; then
  echo "!! 构建失败：没有产出新的 $APK（tauri 退出码 $RC）"
  rm -f "$MARKER"; exit 1
fi
[ "$RC" -ne 0 ] && echo "!! 注意：tauri 退出码是 $RC，但产物已生成，继续"
rm -f "$MARKER"

SUFFIX=""
[ "$MODE" = "debug" ] && SUFFIX="-debug"
OUT="$DIST/readest-lan-v${VERSION}-${ARCH}${SUFFIX}.apk"
cp "$APK" "$OUT"
echo
echo "产物：$OUT"
echo "大小：$(du -h "$OUT" | cut -f1)    sha256：$(sha256sum "$OUT" | cut -c1-16)…"
echo
echo "安装：adb install -r \"$OUT\"   # 同签名可覆盖，数据保留"
echo "提示：打完包要跑 PC 端时，先 pnpm build 再 pnpm start —— tauri 的构建会覆盖 .next/standalone。"
