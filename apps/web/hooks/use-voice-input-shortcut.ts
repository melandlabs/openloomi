"use client";

import { useEffect, useRef, useCallback } from "react";
import { useBasicPreferences } from "@/components/personalization/personalization-basic-settings";
import {
  parseShortcutString,
  matchesKeyboardEvent,
  DEFAULT_VOICE_INPUT_SHORTCUT,
  type ParsedShortcut,
} from "@/lib/shortcuts/voice-input-shortcut";
import { isTauri } from "@/lib/tauri";

// Serialize native shortcut register/unregister IPC to avoid race conditions.
let __shortcutOpChain: Promise<unknown> = Promise.resolve();

function enqueueShortcutOp<T>(op: () => Promise<T>): Promise<T> {
  const next = __shortcutOpChain.then(op, op);
  __shortcutOpChain = next.catch(() => undefined);
  return next as Promise<T>;
}

interface VoiceInputShortcutEvent {
  shortcut: string;
  state: string;
}

function isComboReleaseKey(
  event: KeyboardEvent,
  parsed: ParsedShortcut,
): boolean {
  const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (eventKey === parsed.key) return true;

  const normalized = eventKey.toUpperCase();
  if (parsed.shift && normalized === "SHIFT") return true;
  if (parsed.ctrl && (normalized === "CONTROL" || normalized === "CTRL")) {
    return true;
  }
  if (parsed.alt && normalized === "ALT") return true;
  if (parsed.meta && (normalized === "META" || normalized === "COMMAND")) {
    return true;
  }
  return false;
}

/**
 * Hook that listens to the user's configured voice-input shortcut.
 * Press starts voice input; release stops and submits.
 *
 * Supports browser (page-level keydown/keyup) and Tauri desktop (global shortcut).
 */
export function useVoiceInputShortcut({
  onPress,
  onRelease,
  canPress,
  canRelease,
}: {
  onPress: () => void;
  onRelease: () => void;
  canPress: boolean;
  canRelease: boolean;
}) {
  const { data: prefs } = useBasicPreferences();
  const shortcut = prefs?.voiceInputShortcut ?? DEFAULT_VOICE_INPUT_SHORTCUT;
  const parsedRef = useRef(parseShortcutString(shortcut));
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  const canPressRef = useRef(canPress);
  const canReleaseRef = useRef(canRelease);
  const shortcutHeldRef = useRef(false);

  useEffect(() => {
    parsedRef.current = parseShortcutString(shortcut);
  }, [shortcut]);

  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  useEffect(() => {
    onReleaseRef.current = onRelease;
  }, [onRelease]);

  useEffect(() => {
    canPressRef.current = canPress;
  }, [canPress]);

  useEffect(() => {
    canReleaseRef.current = canRelease;
  }, [canRelease]);

  // --- Browser keydown/keyup listeners ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canPressRef.current) return;
      if (!matchesKeyboardEvent(event, parsedRef.current)) return;
      if (event.repeat) return;
      if (shortcutHeldRef.current) return;

      event.preventDefault();
      shortcutHeldRef.current = true;
      onPressRef.current();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!shortcutHeldRef.current) return;
      if (!isComboReleaseKey(event, parsedRef.current)) return;
      if (!canReleaseRef.current) {
        shortcutHeldRef.current = false;
        return;
      }

      event.preventDefault();
      shortcutHeldRef.current = false;
      onReleaseRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // --- Tauri global shortcut lifecycle ---
  const syncGlobalShortcut = useCallback(async () => {
    if (!isTauri()) return;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unregister_voice_input_shortcut").catch((err) => {
      console.error("[VoiceInputShortcut] unregister failed:", err);
    });

    if (!canPressRef.current && !canReleaseRef.current) return;

    await invoke("register_voice_input_shortcut", {
      shortcut,
    }).catch((err) => {
      console.error("[VoiceInputShortcut] register failed:", err);
    });
  }, [shortcut]);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlistenEvent: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;

        const off = await listen<VoiceInputShortcutEvent>(
          "voice-input-shortcut",
          (event) => {
            const state = event.payload?.state;
            if (state === "Pressed") {
              if (!canPressRef.current || shortcutHeldRef.current) return;
              shortcutHeldRef.current = true;
              onPressRef.current();
              return;
            }
            if (state === "Released") {
              if (!shortcutHeldRef.current) return;
              shortcutHeldRef.current = false;
              if (!canReleaseRef.current) return;
              onReleaseRef.current();
            }
          },
        );

        if (cancelled) {
          off();
          return;
        }
        unlistenEvent = off;
      } catch (err) {
        console.error("[VoiceInputShortcut] listen() failed:", err);
      }
    })();

    void enqueueShortcutOp(async () => {
      if (cancelled) return;
      await syncGlobalShortcut();
    });

    return () => {
      cancelled = true;
      shortcutHeldRef.current = false;
      if (unlistenEvent) {
        unlistenEvent();
        unlistenEvent = null;
      }
      void enqueueShortcutOp(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("unregister_voice_input_shortcut").catch((err) => {
          console.error("[VoiceInputShortcut] cleanup unregister failed:", err);
        });
      });
    };
  }, [syncGlobalShortcut]);
}
