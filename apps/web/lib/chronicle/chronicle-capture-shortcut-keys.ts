import { z } from "zod";

/**
 * Key ids accepted by `device_query::Keycode::from_str` (device_query 2.1.x).
 * Keep in sync with `apps/web/src-tauri/src/system.rs` validation.
 */
export const CHRONICLE_CAPTURE_SHORTCUT_KEYS = [
  "Enter",
  "Space",
  "Escape",
  "Tab",
  "Backspace",
  "CapsLock",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Up",
  "Down",
  "Left",
  "Right",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "Key0",
  "Key1",
  "Key2",
  "Key3",
  "Key4",
  "Key5",
  "Key6",
  "Key7",
  "Key8",
  "Key9",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "LControl",
  "RControl",
  "LShift",
  "RShift",
  "LAlt",
  "RAlt",
  "Command",
  "LOption",
  "ROption",
  "LMeta",
  "RMeta",
  "Numpad0",
  "Numpad1",
  "Numpad2",
  "Numpad3",
  "Numpad4",
  "Numpad5",
  "Numpad6",
  "Numpad7",
  "Numpad8",
  "Numpad9",
  "NumpadSubtract",
  "NumpadAdd",
  "NumpadDivide",
  "NumpadMultiply",
  "NumpadEquals",
  "NumpadEnter",
  "NumpadDecimal",
  "Grave",
  "Minus",
  "Equal",
  "LeftBracket",
  "RightBracket",
  "BackSlash",
  "Semicolon",
  "Apostrophe",
  "Comma",
  "Dot",
  "Slash",
] as const;

export type ChronicleCaptureShortcutKey =
  (typeof CHRONICLE_CAPTURE_SHORTCUT_KEYS)[number];

/** O(1) lookup for `device_query::Keycode::from_str` ids (see Rust listener). */
export const CHRONICLE_CAPTURE_SHORTCUT_KEY_SET = new Set<string>(
  CHRONICLE_CAPTURE_SHORTCUT_KEYS as readonly string[],
);

export function isValidChronicleCaptureShortcutKey(
  raw: string,
): raw is ChronicleCaptureShortcutKey {
  const s = raw.trim();
  return CHRONICLE_CAPTURE_SHORTCUT_KEY_SET.has(s);
}

/** Accepts any trimmed user string; must match a known Keycode id to persist. */
export const chronicleCaptureShortcutKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine(isValidChronicleCaptureShortcutKey, {
    message: "invalid_chronicle_capture_shortcut",
  });

export const DEFAULT_CHRONICLE_CAPTURE_SHORTCUT: ChronicleCaptureShortcutKey =
  "Enter";
