# ロードマップ

設計書のセクション54〜59に対応。

## Phase 1 — 編集基盤

| 項目 | 状態 |
| --- | --- |
| Project作成 | 実装済み |
| Media import | 実装済み |
| Media一覧（Grid / List / 検索） | 実装済み |
| Thumbnail | 実装済み（FFmpeg） |
| Preview（再生 / シーク / フレーム送り / 速度 / In-Out） | 実装済み |
| Timeline（トラック / ルーラー / 再生ヘッド / ズーム / スナップ） | 実装済み |
| Clip追加（Media PanelからDrag & Drop） | 実装済み |
| Clip移動 / Trim / Split / Delete / Ripple Delete | 実装済み |
| コピー / ペースト / 複製 | 実装済み |
| Undo / Redo | 実装済み |
| Save / Load / Autosave | 実装済み |
| Export（MP4 / H.264 / H.265） | 実装済み |
| Proxy生成 | 実装済み |
| Waveform表示 | 未実装（キャッシュ経路のみ用意） |

## Phase 2 — 色・音声

| 項目 | 状態 |
| --- | --- |
| Transform（Position / Scale / Rotation / Opacity） | 実装済み |
| Volume / Pan / Fade | 実装済み |
| Basic Color（Exposure〜Saturation の9パラメータ） | 実装済み |
| Adjustment Layer | データモデルのみ（`Clip.kind = "adjustment"`）。合成は未実装 |
| RGB Curve | 未実装 |

## Phase 3 — AI基盤

| 項目 | 状態 |
| --- | --- |
| AI Assistantパネル | 実装済み |
| AI Edit Plan（Schema検証・ルール検証・Command化） | 実装済み |
| AI Silence Cut | 実装済み |
| AI履歴とUndo | 実装済み |
| Silence Detection（FFmpeg silencedetect） | 実装済み |
| Speech To Text / Transcript | 未実装。`AIProvider.transcribe` の口だけ用意 |
| 自然言語での編集指示 | 未実装。現状は「無音部分を削除」のみ受け付ける |
| 言い直し / フィラー削除 | フィラー判定のみ実装。Transcript待ち |

Speech To Textを入れる際の作業は、`AIProvider` の実装を1つ追加し、
`analyze_media` コマンドがTranscriptを返すようにするだけで済む。
UI・検証・Command化の経路はすでに通っている。

## Phase 4 — AI高度化（未着手）

Scene Detection / Semantic Video Analysis / Best Take Detection /
Auto Highlight / Automatic B-roll / AI Color Correction /
AI Audio Correction / AI Caption / Object Detection / Face Detection

## Phase 5 — 高度な編集（未着手）

Mask / Tracking / Keyframes / Effects / Transition / Text /
Caption Editor / Multicam / GPU Rendering

## 意図的に後回しにしているもの

After Effects級のアニメーション、3D、高度なVFX、プラグイン、
クラウド共同編集、マルチカム、高度なモーショントラッキング。
