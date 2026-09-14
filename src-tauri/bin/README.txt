このフォルダに ffmpeg と ffprobe の実行ファイルを置くと、
アプリに同梱されて配布されます。

  Windows: ffmpeg.exe / ffprobe.exe
  macOS / Linux: ffmpeg / ffprobe

取得するには、リポジトリのルートで次を実行してください。

  npm run fetch-ffmpeg

空のままでもビルドできます。その場合アプリは PATH 上の ffmpeg を探します。

注意: FFmpeg の一般的な配布ビルドは GPL です。同梱して再配布する場合は
ライセンス条件（ソースコードの入手方法の提示など）を満たしてください。
LGPL ビルドを使うか、同梱せず利用者に別途導入してもらう方法もあります。
