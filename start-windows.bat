@echo off
chcp 65001 >nul
setlocal

rem Runs from wherever this file sits, so the folder the user opened the
rem terminal in - or whether they opened one at all - stops mattering.
cd /d "%~dp0"

echo.
echo   AI Video Editor
echo   ---------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [エラー] Node.js が見つかりません。
  echo.
  echo   https://nodejs.org/ から LTS版 をインストールし、
  echo   PCを再起動してから、もう一度このファイルを実行してください。
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo   [エラー] このファイルがプロジェクトフォルダの外にあります。
  echo.
  echo   ZIPを展開したフォルダの中に、同じ名前のフォルダが
  echo   もう一つないか確認してください。その中にある
  echo   start-windows.bat を実行してください。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   初回セットアップを行います。数分かかります...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [エラー] セットアップに失敗しました。
    echo   上に表示されている内容を確認してください。
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo   起動しています。準備ができるとブラウザが自動で開きます。
echo   終了するには、この画面で Ctrl+C を押してください。
echo.

rem Vite opens the browser itself once the server is actually listening,
rem which avoids the "can't reach this page" a fixed delay would cause.
call npm run dev -- --open

pause
