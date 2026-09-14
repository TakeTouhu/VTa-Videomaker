#!/usr/bin/env bash
# Starts the web version. Run from anywhere: it moves to its own directory.
set -euo pipefail

cd "$(dirname "$0")"

echo
echo "  AI Video Editor"
echo "  ---------------"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [エラー] Node.js が見つかりません。"
  echo "  https://nodejs.org/ から LTS版 をインストールしてください。"
  exit 1
fi

if [ ! -f package.json ]; then
  echo "  [エラー] このファイルがプロジェクトフォルダの外にあります。"
  echo "  展開したフォルダの中に同名のフォルダがないか確認してください。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  初回セットアップを行います。数分かかります..."
  echo
  npm install
  echo
fi

echo "  起動しています。準備ができるとブラウザが自動で開きます。"
echo "  終了するには Ctrl+C を押してください。"
echo

npm run dev -- --open
