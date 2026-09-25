#!/bin/bash
# 打包成 macOS 应用：release/恐龙骑士.app
# 应用内置单文件版游戏，双击后用 Chrome 的"应用模式"打开（独立窗口，无地址栏/标签页）。
# 没有安装 Chrome 时退回到系统默认浏览器。
set -e
cd "$(dirname "$0")/.."

echo "▶ 构建单文件版…"
npm run build >/dev/null

APP="release/恐龙骑士.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/game"
cp dist/index.html "$APP/Contents/Resources/game/index.html"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>恐龙骑士</string>
  <key>CFBundleDisplayName</key><string>恐龙骑士</string>
  <key>CFBundleIdentifier</key><string>local.dinoriders.game</string>
  <key>CFBundleVersion</key><string>2.0</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleExecutable</key><string>DinoRiders</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/DinoRiders" <<'LAUNCHER'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
GAME="$RES/game/index.html"
URL="file://$(printf '%s' "$GAME" | sed 's/ /%20/g')"
# 独立的浏览器配置目录：启动参数（GPU 加速、自动播放声音）可以生效，存档也单独保存
PROFILE="$HOME/Library/Application Support/DinoRiders/browser"
FLAGS=(--app="$URL" --window-size=1440,900 --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check
       --autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-gpu-rasterization)
for B in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$B.app" ] || [ -d "$HOME/Applications/$B.app" ]; then
    exec open -na "$B" --args "${FLAGS[@]}"
  fi
done
open "$GAME"
LAUNCHER
chmod +x "$APP/Contents/MacOS/DinoRiders"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
touch "$APP"
echo "✅ 已生成：$(pwd)/$APP"
echo "   双击即可游玩；也可以把它拖进「应用程序」文件夹或程序坞。"
