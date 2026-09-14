# アーキテクチャ

設計書のセクション6・25・32・44・45・51に対応する実装のレイヤ構成。

## 全体

```
┌─────────────────────────────────────────────┐
│                  React UI                    │
│  Media / Preview / Inspector / Timeline / AI │
└───────────────────┬─────────────────────────┘
                    │  src/services/  ← 唯一の境界
                    │  （Tauri IPC / ブラウザ用モック）
┌───────────────────▼─────────────────────────┐
│              ave-core (Rust)                 │
│  ffmpeg / render / project / media / cache   │
│  jobs / ai(analysis) / timeline(読み取り)     │
└──────────┬──────────────────┬───────────────┘
           │                  │
        FFmpeg            AI Provider
```

`src-tauri` はウィンドウとIPCだけを持つ薄いシェルで、編集ロジックは
`crates/core` にある。コアはGUIツールキットに依存しないため、
Windows以外でもビルド・テストできる。

## Timeline Engine

`src/features/timeline/engine.ts`

編集の中心。すべて純関数で、`Sequence` を受け取り新しい `Sequence` を返す。
React・Zustand・Tauri・FFmpegのいずれにも依存しない。手動編集もAI編集も
レンダラのクリップ配置も、同じこの1本を通る。

主な操作:

| 関数 | 役割 |
| --- | --- |
| `insertClip` | 上書き（overwrite）配置。下の素材はトリムまたは削除される |
| `moveClip` | 移動。フレームグリッドに量子化、ロック中トラックは拒否 |
| `trimClip` | 端のトリム。反対側の端と素材長を超えない |
| `splitClip` / `splitAt` | 分割。速度を考慮してソース位置を算出 |
| `deleteClips` / `rippleDeleteClips` | 削除 / 隙間を詰める削除 |
| `removeRange` | 時間範囲の除去。AIの `delete` アクションの実体 |
| `snapCandidates` / `snapTime` | スナップ |

クリップのタイムライン長は `(sourceOut - sourceIn) / speed`。
`speed` が0以下の場合は等速として扱い、ゼロ除算を起こさない。

## Undo / Redo

`src/features/history/`

すべての編集は `EditorCommand`（`execute` / `undo`）。ストアは
`dispatch(command)` するだけで、編集ロジックを持たない。

- `mergeKey` が同じ連続コマンドは1つのUndoステップに合成される
  （スライダーのドラッグが1操作になる）。
- `batchCommand` は複数の編集を1つのUndoステップにまとめる。
  AI編集はこれを使うため、`Ctrl+Z` 一回でAI編集全体が元に戻る。

## AI パイプライン

```
ユーザーの指示
      ↓
AI Provider（差し替え可能）
      ↓
Edit Plan（JSON）
      ↓  ① Schema Validation      features/ai/schema.ts
      ↓     zodで型・範囲・件数を検証
      ↓  ② Business Rule Validation features/ai/validation.ts
      ↓     存在しないClip ID、範囲外の時間、
      ↓     ロック中トラックを除外
      ↓  ③ Command生成             features/ai/planToCommands.ts
      ↓     時間を動かすアクションは後ろから適用し、
      ↓     先の編集が後の座標を壊さないようにする
      ↓
Timeline Engine
```

原則:

- AIの出力は検証を通るまで `unknown` として扱う。
- AIはFFmpegコマンドを生成しない。生成するのは編集パラメータのみ。
- 検証に落ちたアクションは黙って捨てず、理由付きでEdit Planカードに表示する。
- 適用後もInspectorから通常どおり編集できる（Human Editable）。

## レンダリング

`crates/core/src/render/graph.rs`

シーケンスをFFmpegの `filter_complex` に変換する。

- 入力0に黒画（シーケンス長）、入力1に無音を置き、隙間と空トラックを定義する。
- クリップごとに `trim → setpts → 速度 → 色補正 → スケール → tpad` を組む。
- 映像は下から順に `overlay`、音声は `amix` で合成する。
- プレビューはプロキシ、書き出しは常にオリジナルを読む。

プレビューの色（`src/features/color/preview.ts`）はCSSフィルタによる近似で、
最終的な色は書き出し時にFFmpegの `eq` / `curves` / `colorbalance` で適用される。
この差はUI上にも明記している。

## キーフレーム

`src/features/timeline/keyframes.ts`

キーフレームの時間はクリップ相対。クリップを移動・トリムしても
アニメーションがずれない。`resolveClipAt` がアニメーション済みの
通常の `Clip` を返すため、プレビューもレンダラもアニメーションの存在を
意識せずに扱える。

## マスクとトラッキング

マスクは正規化座標（0..1）で保持するため、解像度やプロキシの縮尺が変わっても
位置がずれない。書き出しでは `geq` のアルファ式に変換し、エフェクトを
かけた分岐とオリジナルを合成することで、適用範囲を限定する。

トラッキング（`crates/core/src/ai/tracking.rs`）は正規化相互相関による
テンプレートマッチング。明るさの変化に強く、対象を見失った場合は
直前の位置を保持したうえで信頼度を低く報告する。モデルを必要としない。

## エラー処理

`crates/core/src/error.rs` と `src/types/errors.ts`

FFmpegのstderrを分類し（ファイル無し / 容量不足 / コーデック非対応 / 破損）、
ユーザー向けメッセージと技術的詳細を分離する。詳細は既定で折りたたまれ、
ログにのみ残る。

## バックグラウンドジョブ

プロキシ生成・解析・書き出しはUIスレッドの外で実行し、
`job://update` イベントで進捗を返す。キャンセルは `AtomicBool` フラグで
ワーカーに伝える。
