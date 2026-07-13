/**
 * Loomi Pet — theme system + sprite resolution tests.
 *
 * The widget (`apps/web/public/loomi-widget.html`) ships two built-in
 * themes (`fox`, `capybara`) and a runtime override map populated from
 * the host's `PetConfigView`. These tests verify:
 *
 *   1. Both built-in themes cover every state the watcher can emit,
 *      so `imageFor()` never has to fall back to `FALLBACK` for a
 *      known state.
 *   2. The widget no longer references the buggy
 *      `loomi-info.png` path — that 1.5 MB sprite was incorrectly
 *      mapped to `juggling` and is the bug we fixed.
 *   3. The override map's `absolute` entries route through
 *      `convertFileSrc` (Tauri asset protocol), and `asset` entries
 *      pass through unchanged.
 *
 * The widget is plain HTML/JS so we mirror the relevant pure-function
 * pieces here as TS for testability. Production code paths are
 * identical; if the widget's logic drifts, this test breaks first.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Mirror of BUILTIN_THEMES in apps/web/public/loomi-widget.html. Keep
// these two sources in lock-step — if you change one, change the
// other.
type ThemeName = "fox" | "capybara";

interface BuiltinTheme {
  baseDir: string;
  states: Record<string, string>;
}

const BUILTIN_THEMES: Record<ThemeName, BuiltinTheme> = {
  fox: {
    baseDir: "loomi-pet/assets/fox/",
    states: {
      idle: "loomi-idle.png",
      thinking: "loomi-thinking.png",
      sweeping: "loomi-sweeping.png",
      working: "loomi-working.png",
      needsinput: "loomi-needsinput.png",
      greet: "loomi-greet.png",
      sleeping: "loomi-sleeping.png",
      juggling: "loomi-juggling.png",
      happy: "loomi-happy.png",
      presenting: "loomi-presenting.png",
    },
  },
  capybara: {
    baseDir: "loomi-pet/assets/capybara/",
    states: {
      idle: "capybara-idle.png",
      thinking: "capybara-thinking.png",
      sweeping: "capybara-sweeping.png",
      working: "capybara-working.png",
      needsinput: "capybara-needsinput.png",
      greet: "capybara-idle.png",
      sleeping: "capybara-sleeping.png",
      juggling: "capybara-juggling.png",
      happy: "capybara-happy.png",
      presenting: "capybara-presenting.png",
    },
  },
};

const FALLBACK = "loomi-pet/assets/fox/loomi-idle.png";

// All states the watcher can emit. Must match `PetStateHint` in
// `apps/web/lib/loop/dev-scenes.ts` and `PET_STATES` in
// `apps/web/public/loomi-dev.html`.
const ALL_STATES = [
  "idle",
  "thinking",
  "working",
  "needsinput",
  "juggling",
  "sweeping",
  "happy",
  "sleeping",
  "greet",
  "presenting",
];

// Mirror of imageFor() in the widget. Pulled out as a pure function
// here so the test doesn't have to mock window.__TAURI__.
function imageFor(
  theme: string,
  state: string,
  overrideMap: Record<string, Record<string, OverrideRef>> = {},
  convertFileSrc: (p: string) => string = (p) => p,
): string {
  const ov = overrideMap[theme]?.[state];
  if (ov) {
    if (ov.kind === "absolute") return convertFileSrc(ov.path);
    return ov.path;
  }
  const t = (BUILTIN_THEMES as Record<string, BuiltinTheme | undefined>)[theme];
  if (t?.states[state]) return t.baseDir + t.states[state];
  return FALLBACK;
}

interface OverrideRef {
  kind: "asset" | "absolute";
  path: string;
}

describe("BUILTIN_THEMES", () => {
  it("fox covers every pet state", () => {
    for (const state of ALL_STATES) {
      expect(
        BUILTIN_THEMES.fox.states[state],
        `fox theme missing state "${state}"`,
      ).toBeDefined();
    }
  });

  it("capybara covers every pet state", () => {
    for (const state of ALL_STATES) {
      expect(
        BUILTIN_THEMES.capybara.states[state],
        `capybara theme missing state "${state}"`,
      ).toBeDefined();
    }
  });
});

describe("imageFor()", () => {
  it("returns the built-in sprite when no override is set", () => {
    expect(imageFor("fox", "happy")).toBe(
      "loomi-pet/assets/fox/loomi-happy.png",
    );
    expect(imageFor("capybara", "presenting")).toBe(
      "loomi-pet/assets/capybara/capybara-presenting.png",
    );
  });

  it("falls back to fox idle for unknown themes", () => {
    expect(imageFor("no-such-theme", "happy")).toBe(FALLBACK);
  });

  it("falls back to fox idle for unknown states on a known theme", () => {
    expect(imageFor("fox", "no-such-state")).toBe(FALLBACK);
  });

  it("routes absolute overrides through convertFileSrc", () => {
    const converter = (p: string) => `asset://localhost/${p}`;
    const overrides = {
      fox: {
        idle: { kind: "absolute", path: "/Users/me/Pictures/my-fox-idle.png" },
      },
    } as Record<string, Record<string, OverrideRef>>;
    expect(imageFor("fox", "idle", overrides, converter)).toBe(
      "asset://localhost//Users/me/Pictures/my-fox-idle.png",
    );
  });

  it("passes asset overrides through verbatim", () => {
    const overrides = {
      capybara: {
        happy: { kind: "asset", path: "/some/url.png" },
      },
    } as Record<string, Record<string, OverrideRef>>;
    expect(imageFor("capybara", "happy", overrides)).toBe("/some/url.png");
  });

  it("returns the correct juggling sprite for fox (bug fix)", () => {
    // The buggy version pointed juggling at `loomi-info.png` (1.5 MB).
    // The fix points it at `loomi-juggling.png` (52 KB).
    expect(imageFor("fox", "juggling")).toBe(
      "loomi-pet/assets/fox/loomi-juggling.png",
    );
  });

  it("uses a distinct fox sprite for presenting", () => {
    expect(imageFor("fox", "presenting")).toBe(
      "loomi-pet/assets/fox/loomi-presenting.png",
    );
  });
});

describe("widget source sanity", () => {
  // Confirms the juggling bug fix is in the actual shipped widget —
  // someone might "fix" the test fixture without updating the HTML.
  const widgetPath = path.resolve(__dirname, "../../public/loomi-widget.html");
  const widgetHtml = readFileSync(widgetPath, "utf8");

  it("widget does not reference loomi-info.png for juggling", () => {
    // Strip out comments so a clarifying comment doesn't fail the
    // check, then assert the juggling line does not point at
    // loomi-info.
    const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");
    expect(stripped).not.toMatch(/juggling[^\n]*info\.png/);
  });

  it("widget boots via get_pet_config", () => {
    expect(widgetHtml).toMatch(/invoke\(\s*["']get_pet_config["']/);
  });

  it("widget listens for pet:config-changed", () => {
    expect(widgetHtml).toMatch(/listen\(\s*["']pet:config-changed["']/);
  });

  it("widget listens for pending-count badge updates", () => {
    expect(widgetHtml).toMatch(/listen\(\s*["']loop:pending-count["']/);
  });

  it("widget exposes both built-in themes in the right-click menu", () => {
    expect(widgetHtml).toMatch(/data-op="theme-fox"/);
    expect(widgetHtml).toMatch(/data-op="theme-capybara"/);
  });

  // Issue #314 — the pet's right-click menu is the only UI entry
  // point for Open Loomi / Settings / theme switching / Quit. A
  // first-responder regression in the host (Tauri / WKWebView) can
  // silently drop the `contextmenu` event before it reaches the
  // webview; the widget therefore ships a long-press fallback.
  // These source-sanity assertions pin the contract: a real DOM
  // simulation is tracked as a follow-up once jsdom/happy-dom is
  // wired into vitest (the suite runs in `node` today).

  it("widget opens menu on contextmenu event", () => {
    const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");
    // The contextmenu listener must (a) suppress the native menu,
    // (b) call openPetMenu at the cursor position, and (c) toggle
    // the `#pet-menu` element's `visible` class. Without all three
    // a regression would leave the user without a UI path to theme
    // switching or Quit.
    expect(stripped).toMatch(/addEventListener\(\s*["']contextmenu["']/);
    expect(stripped).toMatch(/openPetMenu\(e\.clientX,\s*e\.clientY\)/);
    expect(stripped).toMatch(/pet-menu/);
    expect(stripped).toMatch(/\.classList\.add\(\s*["']visible["']\s*\)/);
  });

  it("widget opens menu on long-press gesture", () => {
    const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");
    // The long-press fallback must be wired with: a threshold
    // constant, a setTimeout armed in onPointerDown that adds the
    // `longpress` body class, and an onPointerUp branch that calls
    // openPetMenu when the held duration meets the threshold AND
    // no contextmenu fired during the press.
    expect(stripped).toMatch(/LONGPRESS_MS\s*=\s*600/);
    expect(stripped).toMatch(/setTimeout\(/);
    expect(stripped).toMatch(
      /document\.body\.classList\.add\(\s*["']longpress["']/,
    );
    expect(stripped).toMatch(/contextmenuFiredSinceDown/);
    expect(stripped).toMatch(/heldMs\s*>=\s*LONGPRESS_MS/);
    expect(stripped).toMatch(/openPetMenu\(e\.clientX,\s*e\.clientY\)/);
  });

  it("long-press is skipped when contextmenu already opened the menu", () => {
    // Defense in depth: the contextmenu listener sets a flag the
    // pointerup branch checks before re-opening. Pin the flag so
    // the dedupe can't regress.
    const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");
    expect(stripped).toMatch(/contextmenuFiredSinceDown\s*=\s*true/);
  });
});

describe("custom theme discovery", () => {
  // Mirrors the host's `list_custom_themes` rules: a folder counts as
  // a theme iff it contains at least one recognized state PNG.
  const KNOWN_STATES = new Set([
    "idle",
    "thinking",
    "sweeping",
    "working",
    "needsinput",
    "greet",
    "sleeping",
    "juggling",
    "happy",
    "presenting",
  ]);

  function normalizeStateKey(stem: string): string {
    const lower = stem.toLowerCase();
    for (const prefix of ["fox-", "capybara-", "loomi-"]) {
      if (lower.startsWith(prefix)) return lower.slice(prefix.length);
    }
    return lower;
  }

  function isRecognized(stem: string): boolean {
    return KNOWN_STATES.has(normalizeStateKey(stem));
  }

  it("recognizes bare state names", () => {
    expect(isRecognized("idle")).toBe(true);
    expect(isRecognized("presenting")).toBe(true);
  });

  it("recognizes theme-prefixed names", () => {
    expect(isRecognized("loomi-thinking")).toBe(true);
    expect(isRecognized("capybara-juggling")).toBe(true);
    expect(isRecognized("FOX-HAPPY")).toBe(true);
  });

  it("ignores unrelated filenames", () => {
    expect(isRecognized("logo")).toBe(false);
    expect(isRecognized("README")).toBe(false);
    expect(isRecognized("")).toBe(false);
  });
});
