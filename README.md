# AI Video Editor

タイムライン型の動画編集UIをベースに、AIが素材解析・カット・構成を自動化するデスクトップ動画編集ソフト。

「素材を取り込む → AIに指示する → AIが編集案を作る → ユーザーが必要な箇所だけ修正する」
というワークフローを中心に据える。AIによる変更は必ず通常のタイムライン編集結果として反映され、
適用後も手動で編集できる。

## 現在の状態

設計書のPhase 1〜5をすべて実装済み。各Phaseの内訳と既知の制限は
[docs/ROADMAP.md](docs/ROADMAP.md) を参照。

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 1 | 編集基盤（Import / Timeline / Trim / Split / Undo / Save / Export） | 完了 |
| 2 | 色・音声（Transform / Color / Curve / Adjustment Layer / Waveform） | 完了 |
| 3 | AI基盤（Speech To Text / Edit Plan / 自然言語指示） | 完了 |
| 4 | AI高度化（Scene / Best Take / Highlight / B-roll / 自動補正 / 字幕） | 完了 |
| 5 | 高度な編集（Mask / Tracking / Keyframes / Effects / Transition / Text / Multicam / GPU） | 完了 |

実機（Windows + FFmpeg + 実素材）での通し確認は未実施。
ロジックはテストで、UIはヘッドレスブラウザで検証している。

## 技術構成

| レイヤ | 技術 |
| --- | --- |
| UI | React 18 + TypeScript + Vite + Tailwind CSS + Zustand |
| デスクトップシェル | Tauri 2 |
| 編集コア | Rust（`crates/core`） |
| メディア処理 | FFmpeg / ffprobe（外部プロセス） |
| AI | Provider抽象（OpenAI互換API / ローカル / モックを差し替え可能） |
| 音声認識 | whisper.cpp系ローカルエンジン、またはOpenAI互換API |

対応プラットフォームはWindows 11を主対象とし、macOSへ拡張できる構成にしている。

## 構成

```
src/                 React UI・編集ロジック（Timeline Engine、Command、AI検証）
crates/core/         Rust編集コア（FFmpeg制御、レンダリング、プロジェクトI/O）— GUI非依存
src-tauri/           Tauriシェル（ウィンドウとIPCのみ）
docs/                アーキテクチャ・ロードマップ・UIガイドライン
```

Rustコアを独立クレートに分離しているため、GUIツールキットを入れずに
`cargo test -p ave-core` が任意のプラットフォームで通る。

## 開発

前提: Node.js 18+, Rust 1.77+, FFmpeg（`ffmpeg` / `ffprobe` がPATH上、
または実行ファイルの隣の `bin/` に配置）。

```bash
npm install

npm run dev          # ブラウザでUIのみ起動（FFmpeg不要、モックバックエンド）
npm run tauri dev    # デスクトップアプリとして起動（FFmpeg必要）

npm test             # フロントエンドのテスト
npm run typecheck    # tsc --noEmit
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

`npm run dev` はTauriなしで動くモックバックエンドを使う。サムネイル・プロキシ・
書き出しなどFFmpegが必要な処理は、偽装せずエラーを返す。

## 設計上の約束

1. 元動画は変更しない（Non-destructive Editing）。編集内容はプロジェクトデータのみ。
2. すべての編集操作はUndo可能。AI編集も1つのCommandとして扱う。
3. AIはタイムラインを直接書き換えない。Edit Planを生成し、Schema検証と
   業務ルール検証を通ってから、通常の編集Commandに変換される。
4. AIはFFmpegコマンドを生成しない。編集パラメータのみを生成する。
5. UIコンポーネントからFFmpegやAI APIを直接呼ばない。`src/services/` を経由する。
6. Timeline Engineは独立モジュール。React・Zustand・Tauriに依存しない。
7. 実装していない機能は、それらしく振る舞わせない。できないことは明示する。
8. モデルは同梱しない。音声認識・物体検出は差し替え可能な外部実装に委ねる。
9. APIキーはプロジェクトファイルに保存しない。端末の設定ファイルにのみ保存する。

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
