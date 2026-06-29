// Default voice input shortcut for new users
export const DEFAULT_VOICE_INPUT_SHORTCUT = "Shift+V";

// Modifier key names that users can combine with a letter/digit/F-key
export const VOICE_SHORTCUT_MODIFIERS = [
  "Ctrl",
  "Shift",
  "Alt",
  "Cmd",
] as const;

export type ShortcutModifier = (typeof VOICE_SHORTCUT_MODIFIERS)[number];

export interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parse a human-readable shortcut string like "Shift+V" into structured flags.
 * Keys are upper-cased so letters are case-insensitive.
 */
export function parseShortcutString(shortcut: string): ParsedShortcut {
  const parts = shortcut.split("+").map((p) => p.trim());

  const ctrl = parts.some(
    (p) =>
      p === "Ctrl" || p === "Control" || p === "LControl" || p === "RControl",
  );
  const shift = parts.some(
    (p) => p === "Shift" || p === "LShift" || p === "RShift",
  );
  const alt = parts.some((p) => p === "Alt" || p === "LAlt" || p === "RAlt");
  const meta = parts.some(
    (p) =>
      p === "Cmd" ||
      p === "Meta" ||
      p === "Command" ||
      p === "LMeta" ||
      p === "RMeta",
  );

  const key =
    parts
      .filter(
        (p) =>
          ![
            "Ctrl",
            "Control",
            "LControl",
            "RControl",
            "Shift",
            "LShift",
            "RShift",
            "Alt",
            "LAlt",
            "RAlt",
            "Cmd",
            "Meta",
            "Command",
            "LMeta",
            "RMeta",
          ].includes(p),
      )
      .pop() ?? "";

  return { ctrl, shift, alt, meta, key: key.toUpperCase() };
}

/**
 * Format a parsed shortcut back into a display string like "Shift+V".
 */
export function formatShortcutString(parsed: ParsedShortcut): string {
  const parts: string[] = [];
  if (parsed.meta) parts.push("Cmd");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("+");
}

/**
 * Check whether a browser KeyboardEvent matches the parsed shortcut.
 */
export function matchesKeyboardEvent(
  event: KeyboardEvent,
  parsed: ParsedShortcut,
): boolean {
  if (parsed.ctrl !== event.ctrlKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.meta !== event.metaKey) return false;

  const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return eventKey === parsed.key;
}

/**
 * Validate a raw shortcut string.
 * Must contain at least one modifier and one non-modifier key.
 */
export function isValidVoiceShortcut(shortcut: string): boolean {
  if (!shortcut || shortcut.length < 3) return false;
  const parsed = parseShortcutString(shortcut);
  const hasModifier = parsed.ctrl || parsed.shift || parsed.alt || parsed.meta;
  const hasKey = parsed.key.length > 0;
  return hasModifier && hasKey;
}

/**
 * Convert a browser KeyboardEvent into a shortcut string.
 * Used by the "press to record" UI.
 */
export function keyboardEventToShortcutString(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (
    !["CONTROL", "SHIFT", "ALT", "META", "COMMAND"].includes(key.toUpperCase())
  ) {
    parts.push(key);
  }

  return parts.join("+");
}
