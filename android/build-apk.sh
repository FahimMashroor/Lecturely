#!/usr/bin/env bash
# Builds Lecturely.apk. Run from the project folder:  bash android/build-apk.sh
#
# Needs (Ubuntu/Debian):  sudo apt install aapt apksigner zipalign dalvik-exchange default-jdk zip curl
# It also needs Android 14's list of building blocks (android.jar). Ubuntu only
# packages an old one, so the script downloads it once from Maven Central (the
# official public library store) and checks its fingerprint.
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
OUT=android/build
PLATFORM="${ANDROID_JAR:-$OUT/android-34.jar}"
if [ ! -f "$PLATFORM" ]; then
  V=14-robolectric-10818077
  echo "0/5  Downloading Android 14 building blocks (about 130 MB, only once)"
  mkdir -p "$(dirname "$PLATFORM")"
  curl -fsSL -o "$PLATFORM.part" "https://repo1.maven.org/maven2/org/robolectric/android-all/$V/android-all-$V.jar"
  echo "94b1490a891e9be559aa35c87cd8a0c163f32d83  $PLATFORM.part" | sha1sum -c - >/dev/null
  mv "$PLATFORM.part" "$PLATFORM"
fi
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
