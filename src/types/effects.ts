/** Masks, keyframes, effects, transitions and text (design doc sections 17, 58). */

/* ------------------------------------------------------------------ */
/* Masks (section 17)                                                  */
/* ------------------------------------------------------------------ */

export interface Point {
  /** Normalised 0..1 frame coordinates, so a mask survives a resolution change. */
  x: number;
  y: number;
}

export interface RectangleMask {
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  cornerRadius: number;
}

export interface EllipseMask {
  kind: "ellipse";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
}

export interface PolygonMask {
  kind: "polygon";
  points: Point[];
}

export type MaskShape = RectangleMask | EllipseMask | PolygonMask;

/** A tracked position over time, produced by the tracker or set by hand. */
export interface TrackSample {
  /** Seconds from the start of the clip. */
  time: number;
  /** Offset from the mask's authored position, in normalised coordinates. */
  offsetX: number;
  offsetY: number;
  /** Relative scale, 1 = unchanged. */
  scale: number;
  /** Tracker confidence 0..1; low values are shown as unreliable. */
  confidence: number;
}

export interface Mask {
  id: string;
  name: string;
  shape: MaskShape;
  /** Edge softness, in normalised units. */
  feather: number;
  /** Grows (positive) or shrinks (negative) the shape. */
  expansion: number;
  opacity: number;
  /** Inverted masks protect the region instead of selecting it. */
  inverted: boolean;
  enabled: boolean;
  /** Motion tracking samples; empty means the mask is static. */
  track: TrackSample[];
}

export const DEFAULT_RECTANGLE: RectangleMask = {
  kind: "rectangle",
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  rotation: 0,
  cornerRadius: 0,
};

export const DEFAULT_ELLIPSE: EllipseMask = {
  kind: "ellipse",
  x: 0.5,
  y: 0.5,
  radiusX: 0.25,
  radiusY: 0.25,
  rotation: 0,
};

/* ------------------------------------------------------------------ */
/* Keyframes (section 58)                                              */
/* ------------------------------------------------------------------ */

export type Interpolation = "linear" | "hold" | "ease";

export interface Keyframe {
  /** Seconds from the start of the clip, so moving a clip keeps its animation. */
  time: number;
  value: number;
  interpolation: Interpolation;
}

/**
 * Which parameter a keyframe track animates. Dotted paths address nested
 * settings, e.g. "transform.scale" or "color.exposure".
 */
export type AnimatableProperty =
  | "transform.positionX"
  | "transform.positionY"
  | "transform.scale"
  | "transform.rotation"
  | "transform.opacity"
  | "color.exposure"
  | "color.contrast"
  | "color.saturation"
  | "color.temperature"
  | "audio.volume";

export const ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  "transform.positionX",
  "transform.positionY",
  "transform.scale",
  "transform.rotation",
  "transform.opacity",
  "color.exposure",
  "color.contrast",
  "color.saturation",
  "color.temperature",
  "audio.volume",
];

export interface KeyframeTrack {
  property: AnimatableProperty;
  keyframes: Keyframe[];
}

/* ------------------------------------------------------------------ */
/* Effects (section 58)                                                */
/* ------------------------------------------------------------------ */

export type EffectType =
  | "blur"
  | "sharpen"
  | "vignette"
  | "denoise"
  | "glow"
  | "chromaKey"
  | "lut"
  | "blackAndWhite"
  | "pixelate";

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  /** Numeric parameters, plus `path` for a LUT file and `color` for keying. */
  parameters: Record<string, number | string>;
}

export interface EffectDefinition {
  type: EffectType;
  label: string;
  parameters: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
  }[];
}

/** The built-in effects and their parameter ranges. */
export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    type: "blur",
    label: "ぼかし",
    parameters: [
      { key: "amount", label: "強さ", min: 0, max: 50, step: 0.5, defaultValue: 5 },
    ],
  },
  {
    type: "sharpen",
    label: "シャープ",
    parameters: [
      { key: "amount", label: "強さ", min: 0, max: 3, step: 0.05, defaultValue: 1 },
    ],
  },
  {
    type: "vignette",
    label: "ビネット",
    parameters: [
      { key: "amount", label: "強さ", min: 0, max: 100, step: 1, defaultValue: 40 },
    ],
  },
  {
    type: "denoise",
    label: "ノイズ除去",
    parameters: [
      { key: "amount", label: "強さ", min: 0, max: 20, step: 0.5, defaultValue: 4 },
    ],
  },
  {
    type: "glow",
    label: "グロー",
    parameters: [
      { key: "amount", label: "強さ", min: 0, max: 100, step: 1, defaultValue: 30 },
    ],
  },
  {
    type: "chromaKey",
    label: "クロマキー",
    parameters: [
      { key: "similarity", label: "許容範囲", min: 0, max: 100, step: 1, defaultValue: 25 },
      { key: "blend", label: "境界のなじみ", min: 0, max: 100, step: 1, defaultValue: 10 },
    ],
  },
  {
    type: "blackAndWhite",
    label: "白黒",
    parameters: [],
  },
  {
    type: "pixelate",
    label: "モザイク",
    parameters: [
      { key: "size", label: "サイズ", min: 2, max: 64, step: 1, defaultValue: 16 },
    ],
  },
  {
    type: "lut",
    label: "LUT",
    parameters: [],
  },
];

export function effectDefinition(type: EffectType): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS.find((definition) => definition.type === type);
}

/** Builds an effect with its documented defaults. */
export function defaultEffectParameters(type: EffectType): Record<string, number | string> {
  const definition = effectDefinition(type);
  if (!definition) return {};
  const parameters: Record<string, number | string> = Object.fromEntries(
    definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue]),
  );
  if (type === "chromaKey") parameters.color = "#00FF00";
  if (type === "lut") parameters.path = "";
  return parameters;
}

/* ------------------------------------------------------------------ */
/* Transitions (section 58)                                            */
/* ------------------------------------------------------------------ */

export type TransitionType =
  | "crossDissolve"
  | "fadeToBlack"
  | "fadeToWhite"
  | "wipeLeft"
  | "wipeRight"
  | "slideUp"
  | "slideDown"
  | "circleOpen";

export interface Transition {
  id: string;
  trackId: string;
  /** The outgoing and incoming clips. */
  fromClipId: string;
  toClipId: string;
  type: TransitionType;
  /** Seconds. Centred on the cut. */
  duration: number;
}

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  crossDissolve: "クロスディゾルブ",
  fadeToBlack: "黒フェード",
  fadeToWhite: "白フェード",
  wipeLeft: "ワイプ（左）",
  wipeRight: "ワイプ（右）",
  slideUp: "スライド（上）",
  slideDown: "スライド（下）",
  circleOpen: "サークル",
};

export const DEFAULT_TRANSITION_DURATION = 1;

/* ------------------------------------------------------------------ */
/* Text (section 58)                                                   */
/* ------------------------------------------------------------------ */

export interface TextSettings {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  outlineColor: string;
  outlineWidth: number;
  bold: boolean;
  /** Normalised 0..1 position of the text box. */
  x: number;
  y: number;
  alignment: "left" | "center" | "right";
}

export const DEFAULT_TEXT: TextSettings = {
  content: "テキスト",
  fontFamily: "Noto Sans JP",
  fontSize: 64,
  color: "#FFFFFF",
  backgroundColor: "",
  outlineColor: "#000000",
  outlineWidth: 2,
  bold: true,
  x: 0.5,
  y: 0.5,
  alignment: "center",
};

/* ------------------------------------------------------------------ */
/* Multicam (section 58)                                               */
/* ------------------------------------------------------------------ */

export interface MulticamAngle {
  mediaId: string;
  name: string;
  /** Seconds this angle is offset relative to the group's timeline. */
  offset: number;
}

export interface MulticamGroup {
  id: string;
  name: string;
  angles: MulticamAngle[];
  /** How the angles were aligned: by audio waveform, timecode, or by hand. */
  syncMethod: "audio" | "timecode" | "manual";
}

/** Which angle of a multicam group a clip is currently showing. */
export interface MulticamState {
  groupId: string;
  angleIndex: number;
}
