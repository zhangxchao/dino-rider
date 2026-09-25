#!/bin/bash
# macOS 双击启动：安装依赖（首次）并打开游戏
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖…"
  npm install || exit 1
fi
npm run dev
