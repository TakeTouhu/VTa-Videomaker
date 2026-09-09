# AI Video Editor

タイムライン型の動画編集UIをベースに、AIが素材解析・カット・構成を自動化するデスクトップ動画編集ソフト。

「素材を取り込む → AIに指示する → AIが編集案を作る → ユーザーが必要な箇所だけ修正する」
というワークフローを中心に据える。AIによる変更は必ず通常のタイムライン編集結果として反映され、
適用後も手動で編集できる。

## 現在の状態

設計書のPhase 1（編集基盤）を実装中。実装済みと未実装は
[docs/ROADMAP.md](docs/ROADMAP.md) を参照。

| 領域 | 状態 |
| --- | --- |
| アーキテクチャ / 型定義 | 完了 |
| Timeline Engine（Move / Trim / Split / Ripple Delete / Snap） | 完了 |
| Undo / Redo（Command Pattern） | 完了 |
| UIワークスペース（Media / Preview / Inspector / Timeline / AI） | 完了 |
| Media Import・Preview・Timeline配置 | 完了 |
| Project Save / Load / Autosave | 完了 |
| Export（FFmpegフィルタグラフ生成） | 完了 |
| AI Edit Plan（Schema検証 → ルール検証 → Command化） | 完了 |
| AI Silence Cut | 完了（無音検出はFFmpeg silencedetect） |
| Speech To Text / 自然言語指示 | 未実装（Phase 3） |
| マスク / トラッキング / キーフレーム | 未実装（Phase 5） |

## 技術構成

| レイヤ | 技術 |
| --- | --- |
| UI | React 18 + TypeScript + Vite + Tailwind CSS + Zustand |
| デスクトップシェル | Tauri 2 |
| 編集コア | Rust（`crates/core`） |
| メディア処理 | FFmpeg / ffprobe（外部プロセス） |
| AI | Provider抽象（OpenAI / ローカル / モックを差し替え可能） |

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

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
