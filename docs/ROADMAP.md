# ロードマップ

設計書のセクション54〜59に対応。Phase 1〜5はすべて実装済み。

## Phase 1 — 編集基盤（完了）

Project作成 / Media import / Media一覧 / Thumbnail / Preview /
Timeline / Clip追加・移動・Trim・Split・Delete・Ripple Delete /
コピー・ペースト・複製 / Undo・Redo / Save・Load・Autosave /
Export（MP4・H.264・H.265）/ Proxy生成

## Phase 2 — 色・音声（完了）

| 項目 | 実装 |
| --- | --- |
| Transform | Position / Scale / Rotation / Opacity |
| Volume / Pan / Fade | クリップ単位 |
| Basic Color | Exposure〜Saturationの9パラメータ |
| RGB Curve | RGB / R / G / B の4チャンネル。書き出しは`curves`、プレビューはSVG近似 |
| Adjustment Layer | 合成後に`enable`式で時間範囲を限定して適用 |
| Waveform | PCMピークをバケット化しキャッシュ、クリップ上に描画 |

## Phase 3 — AI基盤（完了）

| 項目 | 実装 |
| --- | --- |
| AI Assistant | Chat / 文字起こし / 字幕の3タブ |
| AI Edit Plan | Schema検証 → 業務ルール検証 → Command化 |
| Silence Detection | FFmpeg silencedetect |
| Speech To Text | whisper.cpp系ローカルエンジン、またはOpenAI互換API |
| Transcript | 時間付きで表示、クリックでシーク |
| 自然言語指示 | 組み込みプランナで対応できるものは決定論的に、それ以外はモデルへ |
| 言い直し・フィラー削除 | LCS類似度で言い直しを検出し、最後のテイクを残す |
| ○分にまとめる | 間を優先して削り、不足時のみ重要度の低い発言を落とす |

## Phase 4 — AI高度化（完了）

| 項目 | 実装 |
| --- | --- |
| Scene Detection | FFmpegのシーンスコア |
| Semantic Video Analysis | キーフレーム抽出＋Vision対応プロバイダ |
| Best Take Detection | 同内容のテイクをまとめ、よどみの少ないものを残す |
| Auto Highlight | 重要度上位を時系列順に残す |
| Automatic B-roll | 発話キーワードと解析済み素材のラベルを照合 |
| AI Color Correction | signalstatsの実測から補正パラメータを生成 |
| AI Audio Correction | EBU R128でターゲットLUFSへ。クリッピングを回避 |
| AI Caption | 文字起こしから字幕を生成、drawtextで焼き込み、SRT出力 |
| Object / Face Detection | 外部検出コマンド（正規化座標のJSON）を差し替え可能 |
| 素材検索 | 文字起こし・検出ラベル・映像説明を横断、各ヒットが理由を持つ |

## Phase 5 — 高度な編集（完了）

| 項目 | 実装 |
| --- | --- |
| Mask | 矩形 / 円 / ポリゴン、ぼかし・拡張・不透明度・反転 |
| Tracking | 正規化相互相関によるテンプレート追従。モデル不要 |
| Keyframes | Transform・Color・Audioをクリップ相対時間でアニメーション |
| Effects | ぼかし / シャープ / ビネット / ノイズ除去 / グロー / クロマキー / LUT / 白黒 / モザイク |
| Transition | クロスディゾルブ、黒・白フェード、ワイプ、スライド、サークル |
| Text | テキストクリップ。プレビューと書き出しで同じレイアウト |
| Caption Editor | 文言・タイミング・スタイルの編集、SRT出力 |
| Multicam | 音声相互相関でアングルを同期、再生ヘッド位置で切り替え |
| GPU Rendering | NVENC / QSV / AMF / VideoToolbox。未搭載時はソフトウェアへフォールバック |

## 既知の制限

- **ポリゴンマスクの書き出し**は外接矩形に近似される。`geq`で任意頂点数の
  内外判定を表現できないため。プレビューは正確な形状を表示する。
- **ワイプ・スライド系のトランジション**は、書き出し時は同じ長さの
  ディゾルブとして描画される。xfadeは2系統の独立したストリームを要求するが、
  現在のコンポジタはoverlayで1系統に畳んでいるため。
- **トラッキングの拡大縮小追従**は未対応（位置のみ）。多スケール探索が必要。
- **Vision解析・物体検出**はモデルを同梱しない。外部コマンドまたは
  Vision対応APIの設定が必要。
- **プレビューの色**はCSS/SVGによる近似。最終的な色は書き出し時にFFmpegが決める。
