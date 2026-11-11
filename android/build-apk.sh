#!/usr/bin/env bash
# Builds Lecturely.apk. Run from the project folder:  bash android/build-apk.sh
#
# Needs (Ubuntu/Debian):  sudo apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 default-jdk
# Needs a signing key (made once, then kept safe - see android/README.md):
#   LECTURELY_KEYSTORE=/path/to/lecturely.keystore  LECTURELY_KEYSTORE_PASSWORD=...
# Optional:  LECTURELY_SERVER=https://your-server.example   (leave out for "this phone only")
#            VERSION_CODE=2 VERSION_NAME=1.1                (raise for every new release)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${LECTURELY_KEYSTORE:?Set LECTURELY_KEYSTORE to your signing key file}"
: "${LECTURELY_KEYSTORE_PASSWORD:?Set LECTURELY_KEYSTORE_PASSWORD}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
PLATFORM="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT=android/build
WORK=$OUT/work

echo "1/5  Building the screens"
npx vite build -c vite.app.config.ts >/dev/null
rm -rf "$WORK"; mkdir -p "$WORK/assets" "$WORK/classes" "$WORK/gen"
cp -r "$OUT/www" "$WORK/assets/www"
rm -f "$WORK/assets/www/manifest.webmanifest" "$WORK/assets/www/robots.txt"
# The speech engine's program files travel inside the app.
mkdir -p "$WORK/assets/www/ort"
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm "$WORK/assets/www/ort/"

echo "2/5  Packing icons and settings"
aapt2 compile --dir android/app/res -o "$WORK/res.zip"
aapt2 link -o "$WORK/base.apk" -I "$PLATFORM" --manifest android/app/AndroidManifest.xml \
  -A "$WORK/assets" --java "$WORK/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$WORK/res.zip"

echo "3/5  Compiling the app code"
javac -nowarn -Xlint:-options --release 8 -cp "$PLATFORM" -d "$WORK/classes" $(find android/app/src "$WORK/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$WORK/classes.dex" "$WORK/classes"
(cd "$WORK" && zip -q -j base.apk classes.dex)

echo "4/5  Aligning"
zipalign -f -p 4 "$WORK/base.apk" "$WORK/aligned.apk"

echo "5/5  Signing"
apksigner sign --ks "$LECTURELY_KEYSTORE" --ks-pass "pass:$LECTURELY_KEYSTORE_PASSWORD" \
  --out "$OUT/Lecturely.apk" "$WORK/aligned.apk"
apksigner verify "$OUT/Lecturely.apk"
rm -f "$OUT/Lecturely.apk.idsig"
echo "Done: $OUT/Lecturely.apk"
