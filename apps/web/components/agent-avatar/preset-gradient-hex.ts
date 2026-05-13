/**
 * Hex color stops for SVG/canvas gradients per color preset id.
 * Tuned to approximate Tailwind classes used in COLOR_PRESETS.
 */

const DEFAULT_STOPS: readonly [string, string, string] = [
  "#e2e8f0",
  "#f8fafc",
  "#cbd5e1",
];

const PRESET_GRADIENT_HEX: Record<string, readonly [string, string, string]> = {
  /** Solid brand primary (~ --primary-700) */
  "openloomi-primary": ["#13408f", "#13408f", "#13408f"],
  /** Legacy ids: removed from COLOR_PRESETS but kept for old saved avatarConfig */
  "openloomi-original": ["#22d3ee", "#a78bfa", "#93c5fd"],
  "sunset-dream": ["#fb923c", "#fb7185", "#fcd34d"],
  "sakura-breeze": ["#f472b6", "#fda4af", "#fecaca"],
  "forest-whisper": ["#34d399", "#2dd4bf", "#bef264"],
  "mint-fresh": ["#5eead4", "#67e8f9", "#f1f5f9"],
  "deep-space": ["#6366f1", "#a855f7", "#e879f9"],
  "midnight-neon": ["#4f46e5", "#06b6d4", "#2563eb"],
  "golden-hour": ["#facc15", "#fb923c", "#fde68a"],
  "royal-velvet": ["#d946ef", "#8b5cf6", "#c084fc"],
  "cloud-nine": ["#94a3b8", "#cbd5e1", "#e2e8f0"],
};

/**
 * Return three hex stops for radial/linear avatar fills for a preset id.
 */
export function getPresetGradientHex(
  presetId: string,
): readonly [string, string, string] {
  return PRESET_GRADIENT_HEX[presetId] ?? DEFAULT_STOPS;
}
