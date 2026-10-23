#!/bin/bash
# Builds an arm64 FFmpeg executable (with x264) for Android and installs it as
# src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libffmpeg.so.
# Needs the Android NDK (NDK_HOME, default r27c under $ANDROID_HOME), git, curl, make, pkg-config.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$REPO/.android-ffmpeg}
mkdir -p "$WORK" && cd "$WORK"
NDK=${NDK_HOME:-${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/27.2.12479018}
TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
API=24
CC=$TC/bin/aarch64-linux-android$API-clang
PREFIX=$PWD/prefix
[ -d x264 ] || git clone --depth 1 https://code.videolan.org/videolan/x264.git
[ -d ffmpeg-7.1.2 ] || (curl -fsSL https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz | tar xJ)
cd x264
CC=$CC AR=$TC/bin/llvm-ar RANLIB=$TC/bin/llvm-ranlib STRINGS=$TC/bin/llvm-strings ./configure --host=aarch64-linux-android --sysroot=$TC/sysroot \
  --prefix=$PREFIX --enable-static --enable-pic --disable-cli --extra-cflags="-O3" \
  --disable-opencl --disable-asm-check 2>/dev/null || CC=$CC AR=$TC/bin/llvm-ar RANLIB=$TC/bin/llvm-ranlib STRINGS=$TC/bin/llvm-strings ./configure --host=aarch64-linux-android --sysroot=$TC/sysroot \
  --prefix=$PREFIX --enable-static --enable-pic --disable-cli --extra-cflags="-O3" --disable-opencl
make -j$(nproc) && make install
cd ../ffmpeg-7.1.2
PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig ./configure --prefix=$PREFIX --target-os=android --arch=aarch64 --cpu=armv8-a \
  --enable-cross-compile --cc=$CC --cxx=$TC/bin/aarch64-linux-android$API-clang++ --ar=$TC/bin/llvm-ar --nm=$TC/bin/llvm-nm \
  --ranlib=$TC/bin/llvm-ranlib --strip=$TC/bin/llvm-strip --sysroot=$TC/sysroot \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-gpl --enable-libx264 --enable-static --disable-shared --enable-pic \
  --disable-doc --disable-ffplay --disable-ffprobe --disable-debug --disable-network --disable-indevs --enable-indev=lavfi --disable-outdevs \
  --disable-vulkan --disable-mediacodec --disable-jni \
  --extra-cflags="-I$PREFIX/include -O3" --extra-ldflags="-L$PREFIX/lib -Wl,-z,max-page-size=16384" --extra-libs="-lm"
make -j$(nproc)
$TC/bin/llvm-strip -o ../libffmpeg.so ffmpeg
DEST=$REPO/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a
mkdir -p "$DEST" && cp ../libffmpeg.so "$DEST/"
ls -la "$DEST/libffmpeg.so"
