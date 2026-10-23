#!/usr/bin/env bash
# Rust 门。这个分支只有安卓，所以按 aarch64-android 目标检查，而不是宿主 linux：
# 移动端插件的方法都在 #[cfg(mobile)] 下，宿主目标编译不过。
#   用法：bash scripts/lan/rust-check.sh check|clippy
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lan-common.sh"

WHAT="${1:-check}"
SDK="${READEST_ANDROID_SDK:-$HOME/android-sdk}"
NDK_DIR="${READEST_NDK_HOME:-$(ls -d "$SDK"/ndk/* 2>/dev/null | tail -1)}"
TC="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin"
[ -x "$TC/aarch64-linux-android26-clang" ] || { echo "!! 找不到 NDK 工具链：$TC"; exit 1; }

cd "$APP_DIR"
case "$WHAT" in
  check)
    env -u ANDROID_SDK_ROOT -u ANDROID_HOME ANDROID_HOME="$SDK" NDK_HOME="$NDK_DIR" PATH="$TC:$PATH" \
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TC/aarch64-linux-android26-clang" \
      CC_aarch64_linux_android="$TC/aarch64-linux-android26-clang" \
      AR_aarch64_linux_android="$TC/llvm-ar" \
      cargo check -p Readest --lib --release --target aarch64-linux-android \
        --features "tauri/custom-protocol tauri/custom-protocol"
    ;;
  clippy)
    env -u ANDROID_SDK_ROOT -u ANDROID_HOME ANDROID_HOME="$SDK" NDK_HOME="$NDK_DIR" PATH="$TC:$PATH" \
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TC/aarch64-linux-android26-clang" \
      CC_aarch64_linux_android="$TC/aarch64-linux-android26-clang" \
      AR_aarch64_linux_android="$TC/llvm-ar" \
      cargo clippy -p Readest --lib --release --target aarch64-linux-android \
        --features "tauri/custom-protocol tauri/custom-protocol" -- -D warnings
    ;;
  *) echo "用法：rust-check.sh check|clippy"; exit 1 ;;
esac
