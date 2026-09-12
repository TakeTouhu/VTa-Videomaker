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

  // Order matters: "無音を削除して3分にまとめて" is primarily a condense
  // request, and the condense planner removes silence on the way there.
  const target = parseTargetDuration(text);
  if (target !== null && CONDENSE.test(text)) {
    return { kind: "condense", targetSeconds: target };
  }
  if (FILLER.test(text)) return { kind: "filler" };
  if (SILENCE.test(text)) return { kind: "silence" };
  if (target !== null) return { kind: "condense", targetSeconds: target };

  return { kind: "unknown" };
}
