#!/bin/bash
# Build a minimal, ad-hoc-signed app bundle that exists solely to hold a TCC grant for one
# of the always-on voice services under launchd (a bare CLI can't hold Microphone or
# Accessibility). Reproducible: re-run any time (e.g. after editing launcher.c).
#
#   build.sh                                  -> TarsEars.app  (mic, tars-ears.mjs)
#   build.sh TarsHands  tars-inject.mjs  accessibility  -> TarsHands.app (send keystrokes)
#
# Install path is outside the repo (repo path has a space; TCC keys on a stable, space-free
# bundle path). Re-signing changes the cdhash, which can reset the grant — rebuild only when
# needed and re-approve if the permission reappears in System Settings.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Derive the repo's voice/ dir from this script's location (ops/launchd/tars-ears-app);
# override with TARS_VOICE_DIR. Node from PATH (or TARS_NODE).
VOICE="${TARS_VOICE_DIR:-$(cd "$HERE/../../../voice" && pwd)}"
NODE="${TARS_NODE:-$(command -v node)}"

APP_NAME="${1:-TarsEars}"
SCRIPT="${2:-tars-ears.mjs}"
PERM="${3:-microphone}"        # microphone | accessibility
APP="$HOME/Applications/${APP_NAME}.app"
MACOS="$APP/Contents/MacOS"
SCRIPT_PATH="$VOICE/$SCRIPT"

echo "==> building $APP  (script: $SCRIPT, perm: $PERM)"
rm -rf "$APP"; mkdir -p "$MACOS"

echo "==> compiling launcher"
cc -O2 -DTARS_NODE="\"$NODE\"" -DTARS_SCRIPT="\"$SCRIPT_PATH\"" -o "$MACOS/$APP_NAME" "$HERE/launcher.c"

# Permission-specific Info.plist usage strings. Microphone auto-prompts; Accessibility must
# be toggled by hand in System Settings, but the app still needs a bundle identity to appear
# there, and NSAppleEventsUsageDescription covers controlling Terminal/Claude/System Events.
if [ "$PERM" = "accessibility" ]; then
  USAGE='    <key>NSAppleEventsUsageDescription</key>
    <string>TARS types your spoken commands into Claude and Terminal.</string>'
else
  USAGE='    <key>NSMicrophoneUsageDescription</key>
    <string>TARS listens for your voice commands.</string>'
fi

echo "==> writing Info.plist"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.tars.$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]')</string>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
${USAGE}
</dict>
</plist>
PLIST

echo "==> ad-hoc code-signing"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP" 2>&1 | sed 's/^/    /'
echo "==> done: $MACOS/$APP_NAME"
