/**
 * Agent Avatar constant definitions
 * Contains all available facial features and color presets
 */

import type { AvatarConfiguration, ColorPreset, SvgPath } from "./types";
import { AvatarState } from "./types";
import { AVATAR_SHAPE_PRESETS } from "./shape-presets";

/**
 * Eye styles collection
 */
export const EYES: SvgPath[] = [
  {
    id: "dot",
    label: "Simple Dots",
    path: "M35 50a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M71 50a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    viewBox: "0 0 100 100",
  },
  {
    id: "happy",
    label: "Happy Arcs",
    path: "M30 48 Q35 45 40 48 M60 48 Q65 45 70 48",
    viewBox: "0 0 100 100",
  },
  {
    id: "wink",
    label: "Wink",
    path: "M35 50a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M60 50 L70 50",
    viewBox: "0 0 100 100",
  },
  {
    id: "chill",
    label: "Chill Lines",
    path: "M30 50 L40 50 M60 50 L70 50",
    viewBox: "0 0 100 100",
  },
  {
    id: "wide",
    label: "Wide Open",
    path: "M35 50a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M73 50a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
    viewBox: "0 0 100 100",
  },
];

/**
 * Eyebrow styles collection
 */
export const EYEBROWS: SvgPath[] = [
  {
    id: "high-curve",
    label: "High Curve",
    path: "M28 35 Q35 25 42 35 M58 35 Q65 25 72 35",
    viewBox: "0 0 100 100",
  },
  {
    id: "flat",
    label: "Neutral Flat",
    path: "M28 32 L42 32 M58 32 L72 32",
    viewBox: "0 0 100 100",
  },
  {
    id: "worried",
    label: "Worried",
    path: "M28 30 Q35 35 42 30 M58 30 Q65 35 72 30",
    viewBox: "0 0 100 100",
  },
  {
    id: "determined",
    label: "Determined",
    path: "M28 35 L42 40 M58 40 L72 35",
    viewBox: "0 0 100 100",
  },
  {
    id: "short",
    label: "Short",
    path: "M32 35 L38 35 M62 35 L68 35",
    viewBox: "0 0 100 100",
  },
];

/**
 * Nose styles collection
 */
export const NOSES: SvgPath[] = [
  {
    id: "L-shape",
    label: "L Shape",
    path: "M50 50 V60 H55",
    viewBox: "0 0 100 100",
  },
  {
    id: "dot",
    label: "Dot",
    path: "M50 58 a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    viewBox: "0 0 100 100",
  },
  {
    id: "curve",
    label: "Soft Curve",
    path: "M48 55 Q50 60 52 55",
    viewBox: "0 0 100 100",
  },
  {
    id: "line",
    label: "Minimal Line",
    path: "M50 52 V60",
    viewBox: "0 0 100 100",
  },
  {
    id: "triangle",
    label: "Tiny Triangle",
    path: "M48 58 L52 58 L50 55 Z",
    viewBox: "0 0 100 100",
  },
];

/**
 * Mouth styles collection
 */
export const MOUTHS: SvgPath[] = [
  {
    id: "neutral",
    label: "Neutral",
    path: "M45 75 L55 75",
    viewBox: "0 0 100 100",
  },
  {
    id: "smile",
    label: "Smile",
    path: "M40 70 Q50 80 60 70",
    viewBox: "0 0 100 100",
  },
  {
    id: "frown",
    label: "Frown",
    path: "M42 78 Q50 72 58 78",
    viewBox: "0 0 100 100",
  },
  {
    id: "circle",
    label: "Oh",
    path: "M50 75 a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    viewBox: "0 0 100 100",
  },
  {
    id: "smirk",
    label: "Smirk",
    path: "M42 75 Q50 75 58 72",
    viewBox: "0 0 100 100",
  },
];

/**
 * Color presets collection
 */
export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "openloomi-primary",
    labelKey: "agentAvatar.colorPresetLabels.openloomi-primary",
    label: "Primary",
    mainColor: "bg-primary",
    editorFlatFill: true,
    gradientClasses: ["bg-primary", "bg-primary", "bg-primary"],
  },
  {
    id: "sunset-dream",
    labelKey: "agentAvatar.colorPresetLabels.sunset-dream",
    label: "Sunset Dream",
    mainColor: "bg-orange-100",
    gradientClasses: [
      "bg-orange-400 top-0 left-0",
      "bg-rose-400 bottom-0 right-4",
      "bg-amber-300 inset-0 m-auto",
    ],
  },
  {
    id: "sakura-breeze",
    labelKey: "agentAvatar.colorPresetLabels.sakura-breeze",
    label: "Sakura Breeze",
    mainColor: "bg-pink-100",
    gradientClasses: [
      "bg-pink-400 top-0 left-0",
      "bg-rose-300 bottom-0 right-0",
      "bg-red-200 inset-0 m-auto",
    ],
  },
  {
    id: "forest-whisper",
    labelKey: "agentAvatar.colorPresetLabels.forest-whisper",
    label: "Forest Whisper",
    mainColor: "bg-emerald-100",
    gradientClasses: [
      "bg-emerald-400 bottom-0 left-0",
      "bg-teal-400 top-0 right-0",
      "bg-lime-300 top-1/2 left-1/2",
    ],
  },
  {
    id: "mint-fresh",
    labelKey: "agentAvatar.colorPresetLabels.mint-fresh",
    label: "Mint Fresh",
    mainColor: "bg-teal-100",
    gradientClasses: [
      "bg-teal-300 top-10 right-10",
      "bg-cyan-200 bottom-10 left-10",
      "bg-slate-100 inset-0 m-auto",
    ],
  },
  {
    id: "deep-space",
    labelKey: "agentAvatar.colorPresetLabels.deep-space",
    label: "Deep Space",
    mainColor: "bg-indigo-100",
    gradientClasses: [
      "bg-indigo-500 top-0 left-10",
      "bg-purple-500 bottom-0 right-10",
      "bg-fuchsia-400 top-1/2 left-0",
    ],
  },
  {
    id: "golden-hour",
    labelKey: "agentAvatar.colorPresetLabels.golden-hour",
    label: "Golden Hour",
    mainColor: "bg-yellow-100",
    gradientClasses: [
      "bg-yellow-400 top-0 left-0",
      "bg-orange-400 bottom-0 right-0",
      "bg-amber-200 inset-0 m-auto",
    ],
  },
  {
    id: "cloud-nine",
    labelKey: "agentAvatar.colorPresetLabels.cloud-nine",
    label: "Cloud Nine",
    mainColor: "bg-slate-100",
    gradientClasses: [
      "bg-slate-400 top-10 left-10",
      "bg-gray-300 bottom-10 right-10",
      "bg-slate-200 inset-0",
    ],
  },
];

/**
 * Generate random avatar configuration
 * @returns Random avatar configuration object
 */
export function generateRandomAvatarConfig(): AvatarConfiguration {
  return {
    eyesId: EYES[Math.floor(Math.random() * EYES.length)].id,
    eyebrowsId: EYEBROWS[Math.floor(Math.random() * EYEBROWS.length)].id,
    noseId: NOSES[Math.floor(Math.random() * NOSES.length)].id,
    mouthId: MOUTHS[Math.floor(Math.random() * MOUTHS.length)].id,
    colorPresetId:
      COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].id,
    shapeId:
      AVATAR_SHAPE_PRESETS[
        Math.floor(Math.random() * AVATAR_SHAPE_PRESETS.length)
      ].id,
    showBorder: false,
    customTextureUrl: null,
  };
}

/**
 * Default state configuration
 * Solid brand primary, eyes wide open, eyebrows High Curve, nose Dot, mouth smile
 */
const DEFAULT_STATE_CONFIG: AvatarConfiguration = {
  colorPresetId: "openloomi-primary",
  shapeId: "four-lobe",
  eyesId: "wide",
  eyebrowsId: "high-curve",
  noseId: "dot",
  mouthId: "smile",
  showBorder: false,
  customTextureUrl: null,
};

/**
 * Refreshing/Thinking state configuration
 * Maintains unified expression and color with default state
 */
const REFRESHING_STATE_CONFIG: AvatarConfiguration = {
  colorPresetId: "openloomi-primary",
  shapeId: "four-lobe",
  eyesId: "wide",
  eyebrowsId: "high-curve",
  noseId: "dot",
  mouthId: "smile",
  showBorder: false,
  customTextureUrl: null,
};

/**
 * Conversation state configuration (wise conversation partner)
 * Maintains unified expression and color with default state
 */
const CONVERSATION_STATE_CONFIG: AvatarConfiguration = {
  colorPresetId: "openloomi-primary",
  shapeId: "four-lobe",
  eyesId: "wide",
  eyebrowsId: "high-curve",
  noseId: "dot",
  mouthId: "smile",
  showBorder: false,
  customTextureUrl: null,
};

/**
 * Get Avatar configuration based on state
 * @param state Avatar state
 * @returns Corresponding avatar configuration
 */
export function getAvatarConfigByState(
  state: AvatarState = AvatarState.DEFAULT,
): AvatarConfiguration {
  switch (state) {
    case AvatarState.DEFAULT:
      return { ...DEFAULT_STATE_CONFIG };
    case AvatarState.REFRESHING:
      return { ...REFRESHING_STATE_CONFIG };
    case AvatarState.CONVERSATION:
      return { ...CONVERSATION_STATE_CONFIG };
    default:
      return { ...DEFAULT_STATE_CONFIG };
  }
}
