import {
  CHRONICLE_CAPTURE_SHORTCUT_KEY_SET,
  type ChronicleCaptureShortcutKey,
} from "@/lib/chronicle/chronicle-capture-shortcut-keys";

/**
 * Map `KeyboardEvent.code` (UI Events / physical key) to a `device_query`
 * `Keycode::from_str` id. Unknown codes return null.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values
 */
const CODE_TO_CHRONICLE: Record<string, ChronicleCaptureShortcutKey> = (() => {
  const m: Record<string, ChronicleCaptureShortcutKey> = {
    Enter: "Enter",
    NumpadEnter: "NumpadEnter",
    Space: "Space",
    Tab: "Tab",
    Backspace: "Backspace",
    CapsLock: "CapsLock",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
    ShiftLeft: "LShift",
    ShiftRight: "RShift",
    ControlLeft: "LControl",
    ControlRight: "RControl",
    AltLeft: "LAlt",
    AltRight: "RAlt",
    MetaLeft: "Command",
    MetaRight: "Command",
    OSLeft: "LMeta",
    OSRight: "RMeta",
    Numpad0: "Numpad0",
    Numpad1: "Numpad1",
    Numpad2: "Numpad2",
    Numpad3: "Numpad3",
    Numpad4: "Numpad4",
    Numpad5: "Numpad5",
    Numpad6: "Numpad6",
    Numpad7: "Numpad7",
    Numpad8: "Numpad8",
    Numpad9: "Numpad9",
    NumpadAdd: "NumpadAdd",
    NumpadSubtract: "NumpadSubtract",
    NumpadMultiply: "NumpadMultiply",
    NumpadDivide: "NumpadDivide",
    NumpadDecimal: "NumpadDecimal",
    NumpadEqual: "NumpadEquals",
    Backquote: "Grave",
    Minus: "Minus",
    Equal: "Equal",
    BracketLeft: "LeftBracket",
    BracketRight: "RightBracket",
    Backslash: "BackSlash",
    IntlBackslash: "BackSlash",
    Semicolon: "Semicolon",
    Quote: "Apostrophe",
    Comma: "Comma",
    Period: "Dot",
    Slash: "Slash",
  };

  for (let i = 0; i <= 9; i++) {
    m[`Digit${i}`] = `Key${i}` as ChronicleCaptureShortcutKey;
  }
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    m[`Key${letter}`] = letter as ChronicleCaptureShortcutKey;
  }
  for (let f = 1; f <= 20; f++) {
    m[`F${f}`] = `F${f}` as ChronicleCaptureShortcutKey;
  }

  return m;
})();

export function keyboardCodeToChronicleShortcutId(
  code: string,
): ChronicleCaptureShortcutKey | null {
  const id = CODE_TO_CHRONICLE[code];
  if (!id) return null;
  return CHRONICLE_CAPTURE_SHORTCUT_KEY_SET.has(id) ? id : null;
}
