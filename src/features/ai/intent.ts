/** Recognises the built-in editing requests (design doc section 24).
 *
 * Used by the local provider, and by the assistant to route a request to a
 * deterministic planner instead of a model where one exists - a built-in
 * planner is faster, free, and reproducible.
 */

export type Intent =
  | { kind: "silence" }
  | { kind: "filler" }
  | { kind: "condense"; targetSeconds: number }
  | { kind: "bestTake" }
  | { kind: "highlight"; targetSeconds: number }
  | { kind: "colorCorrect" }
  | { kind: "audioCorrect" }
  | { kind: "caption" }
  | { kind: "unknown" };

const SILENCE = /無音|silence|間を?(詰め|削除)|話していないところ/i;
const FILLER = /言い直し|言いなおし|フィラー|filler|えー|あのー|つっかえ|ノイズワード/i;

/** "5分", "5分以内", "90秒", "1分30秒", "3 minutes". */
const DURATION_PATTERNS: { pattern: RegExp; toSeconds: (match: RegExpMatchArray) => number }[] = [
  {
    pattern: /(\d+(?:\.\d+)?)\s*時間\s*(\d+(?:\.\d+)?)\s*分/,
    toSeconds: (m) => Number(m[1]) * 3600 + Number(m[2]) * 60,
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s*分\s*(\d+(?:\.\d+)?)\s*秒/,
    toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]),
  },
  { pattern: /(\d+(?:\.\d+)?)\s*時間/, toSeconds: (m) => Number(m[1]) * 3600 },
  { pattern: /(\d+(?:\.\d+)?)\s*分/, toSeconds: (m) => Number(m[1]) * 60 },
  { pattern: /(\d+(?:\.\d+)?)\s*秒/, toSeconds: (m) => Number(m[1]) },
  {
    pattern: /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i,
    toSeconds: (m) => Number(m[1]) * 60,
  },
  { pattern: /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/i, toSeconds: (m) => Number(m[1]) },
];

const CONDENSE = /まとめ|短く|縮め|凝縮|要約|以内に|カットして.*分|condense|shorten/i;
const BEST_TAKE = /ベストテイク|良いテイク|よいテイク|一番良い|best take|失敗して(いる|る)?部分/i;
const HIGHLIGHT = /ハイライト|見どころ|highlight|盛り上が/i;
const COLOR_CORRECT = /色.*(自動|補正|調整|直し)|自動.*色|カラcoレクション|color correct|明るさ.*自動/i;
const AUDIO_CORRECT = /音量.*(揃え|自動|補正|均一|ノーマライズ)|normalize|ラウドネス/i;
const CAPTION = /字幕|キャプション|テロップ|caption|subtitle/i;

/** Default highlight length when the request does not give one. */
export const DEFAULT_HIGHLIGHT_SECONDS = 60;

/** Extracts a target duration in seconds, or null when none is stated. */
export function parseTargetDuration(text: string): number | null {
  for (const { pattern, toSeconds } of DURATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const seconds = toSeconds(match);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
    }
  }
  return null;
}

export function matchIntent(prompt: string): Intent {
  const text = prompt.trim();

  const target = parseTargetDuration(text);

  // Most specific first: a highlight request with a length is a highlight, not
  // a generic condense.
  if (HIGHLIGHT.test(text)) {
    return { kind: "highlight", targetSeconds: target ?? DEFAULT_HIGHLIGHT_SECONDS };
  }
  if (CAPTION.test(text)) return { kind: "caption" };
  if (AUDIO_CORRECT.test(text)) return { kind: "audioCorrect" };
  if (COLOR_CORRECT.test(text)) return { kind: "colorCorrect" };
  if (BEST_TAKE.test(text)) return { kind: "bestTake" };

  // "無音を削除して3分にまとめて" is primarily a condense request, and the
  // condense planner removes silence on the way there.
  if (target !== null && CONDENSE.test(text)) {
    return { kind: "condense", targetSeconds: target };
  }
  if (FILLER.test(text)) return { kind: "filler" };
  if (SILENCE.test(text)) return { kind: "silence" };
  if (target !== null) return { kind: "condense", targetSeconds: target };

  return { kind: "unknown" };
}
