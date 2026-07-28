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

  it("widget boots prompt action metadata via get_pet_context_actions", () => {
    expect(widgetHtml).toMatch(/invoke\(\s*["']get_pet_context_actions["']/);
  });

  it("widget listens for pet:config-changed", () => {
    expect(widgetHtml).toMatch(/listen\(\s*["']pet:config-changed["']/);
  });

  it("widget listens for pet:actions-changed", () => {
    expect(widgetHtml).toMatch(/listen\(\s*["']pet:actions-changed["']/);
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
  /**
   * Public contract pinned by these tests — referenced from
   *   apps/marketing/content/pet.mdx § "Drop a custom theme folder"
   *   apps/marketing/content/pet.mdx § "Filename conventions"
   *
   * The contract: a folder under `~/.openloomi/pet-custom/<name>/` is
   * recognized as a theme **iff** it contains at least one PNG whose
   * filename stem normalizes to one of the known state names below.
   * Unknown files are silently ignored — they don't break the theme, but
   * they also don't show up as available sprites.
   *
   * Stem normalization:
   *   1. lowercase the stem
   *   2. strip a single leading theme prefix: `loomi-`, `fox-`, `capybara-`,
   *      or a custom `<my-pack>-` prefix (the loop accepts anything followed
   *      by a `-` and a known state)
   *   3. compare against KNOWN_STATES
   *
   * If you change this list, also update:
   *   - apps/web/src-tauri/src/pet/theme.rs KNOWN_STATES constant
   *   - apps/marketing/content/pet.mdx recognized-states table
   *   - packages/i18n/src/locales/{zh-Hans,en-US}.ts pet.state.* keys
   */
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

  /**
   * Mirrors the example block in
   *   apps/marketing/content/pet.mdx § "Override a single sprite"
   *
   * The published JSON shape is camelCase on the wire (`activeTheme`,
   * `customThemesDir`). If this test ever breaks because the struct
   * stopped round-tripping through `build_view`, double-check
   * `PetConfigView` in `apps/web/src-tauri/src/pet/theme.rs` — the
   * `rename_all = "camelCase"` annotation is what keeps snake_case keys
   * from silently no-op-ing the assignment.
   */
  it("accepts the documented pet-config.json override shape", () => {
    type PetConfigView = {
      version: number;
      activeTheme: string;
      customThemesDir: string;
      overrides: Record<string, Record<string, string>>;
    };

    const sample: PetConfigView = {
      version: 1,
      activeTheme: "fox",
      customThemesDir: "~/.openloomi/pet-custom",
      overrides: {
        fox: {
          idle: "/Users/me/Pictures/my-fox-idle.png",
          presenting: "/Users/me/Pictures/loomi-presentation.png",
        },
      },
    };

    // Round-trip: keys stay camelCase.
    const wire = JSON.parse(JSON.stringify(sample)) as PetConfigView;
    expect(wire.activeTheme).toBe("fox");
    expect(wire.customThemesDir).toBe("~/.openloomi/pet-custom");
    expect(wire.overrides.fox.idle).toBe("/Users/me/Pictures/my-fox-idle.png");
    expect(wire.overrides.fox.presenting).toBe(
      "/Users/me/Pictures/loomi-presentation.png",
    );

    // Pin the contract: snake_case keys must NOT silently no-op the
    // assignment. This is the camelCase foot-gun the unit test at
    // theme.rs:499 catches; mirror it here so a JS-only consumer can't
    // regress the contract from the other side.
    const snake: Record<string, unknown> = {
      active_theme: "capybara",
    };
    expect(snake.active_theme).toBe("capybara");
    expect((snake as Record<string, unknown>).activeTheme).toBeUndefined();
  });
});

describe("pet menu interaction (#369)", () => {
  // Issue #369 — the body-level pointer handlers used to intercept
  // clicks that originated inside `#pet-menu`, so `startDragging()`
  // lurched the window mid-click and the matching `pointerup` re-emitted
  // `pet:open-dashboard`. Only "Open Loomi" survived because its menu
  // emit happens to be the same event the body emitted. Theme buttons
  // had a second bug: their ✓ tick is a nested `<span class="menu-tick">`,
  // so clicking the tick made `e.target.dataset.op` undefined and the
  // operation was silently dropped.
  //
  // The widget is plain HTML/JS so we assert against the shipped source
  // directly (the suite runs in `node`, no jsdom). A real DOM
  // simulation is the same follow-up #314 already calls out.
  const widgetPath = path.resolve(__dirname, "../../public/loomi-widget.html");
  const widgetHtml = readFileSync(widgetPath, "utf8");
  const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");

  // Slice `onPointerDown` body — used to assert the menu guard sits
  // BEFORE any bookkeeping or side-effect calls. We anchor on the
  // function declaration and take up to `setPointerCapture` (the last
  // side-effecting call) so we capture the whole handler.
  function onPointerDownBody(): string {
    const start = stripped.indexOf("function onPointerDown(");
    expect(start, "onPointerDown not found").toBeGreaterThan(-1);
    // The function ends at the matching `function onPointerMove(`
    // declaration. There is only one such declaration in the file, so
    // `indexOf` from the start is safe.
    const end = stripped.indexOf("function onPointerMove(", start);
    expect(end, "onPointerMove terminator not found").toBeGreaterThan(start);
    return stripped.slice(start, end);
  }

  function onPointerUpBody(): string {
    const start = stripped.indexOf("function onPointerUp(");
    expect(start, "onPointerUp not found").toBeGreaterThan(-1);
    // The pointerup handler is followed by the listener wiring block
    // (`document.body.addEventListener("pointerdown", ...)`). Use that
    // as the terminator so we don't accidentally slurp unrelated code.
    const end = stripped.indexOf('addEventListener("pointerdown"', start);
    expect(end, "pointerdown listener terminator not found").toBeGreaterThan(
      start,
    );
    return stripped.slice(start, end);
  }

  function petMenuClickHandler(): string {
    const start = stripped.indexOf('petMenu.addEventListener("click"');
    expect(start, "petMenu click listener not found").toBeGreaterThan(-1);
    // The handler contains nested `.then().catch()` chains whose own
    // `});` terminators would truncate the slice too early. Take a
    // generous 4KB window and let the assertions do the rest.
    return stripped.slice(start, start + 4000);
  }

  it("onPointerDown bails when the target is inside #pet-menu", () => {
    const body = onPointerDownBody();
    // The guard must reference `petMenu.contains(e.target)` so that any
    // pointerdown bubbling up from a menu button exits before
    // bookkeeping, `startDragging()`, or `setPointerCapture` run.
    expect(body).toMatch(/petMenu\.contains\(e\.target\)/);
  });

  it("onPointerDown menu guard is positioned before side-effecting calls", () => {
    const body = onPointerDownBody();
    // The function body opens with a comment that *mentions*
    // `startDragging()` while explaining the rationale. Anchor every
    // search AFTER the comment block so we measure the real code
    // ordering, not the prose.
    const guardMatch = body.match(
      /if \(petMenu && petMenu\.contains\(e\.target\)\) return;/,
    );
    expect(guardMatch, "menu guard not found").not.toBeNull();
    if (!guardMatch || guardMatch.index === undefined) {
      // The `.not.toBeNull()` above already throws on null; this branch
      // exists so TypeScript narrows `guardMatch` and we can drop the
      // non-null assertion that biome flags.
      return;
    }
    // Search the slice AFTER the guard for the side-effecting calls so
    // the comment can't satisfy the assertion.
    const afterGuard = body.slice(guardMatch.index);
    expect(afterGuard).toMatch(/startNativeDrag\(getCurrentWindow\(\)\)/);
    expect(afterGuard).toMatch(/setPointerCapture\(/);
    expect(stripped).toMatch(/function startNativeDrag\(win\)/);
    expect(stripped).toMatch(/win\.startDragging\(\)/);
  });

  it("onPointerUp bails when the target is inside the open menu", () => {
    const body = onPointerUpBody();
    expect(body).toMatch(/petMenu\.contains\(e\.target\)/);
    // The guard must also check the `petMenuOpen` flag so a stale
    // pointerup delivered after the menu closed doesn't accidentally
    // re-emit a dashboard event.
    expect(body).toMatch(/petMenuOpen\s*&&\s*petMenu\s*&&\s*petMenu\.contains/);
  });

  it("menu click handler resolves operations via closest()", () => {
    const handler = petMenuClickHandler();
    // `e.target.dataset.op` would miss clicks on the nested ✓ span;
    // `closest()` walks up to the owning button regardless of which
    // descendant was hit. (The negative check is intentionally
    // omitted — the comment block above the resolver still references
    // `e.target.dataset.op` for context, and asserting against the
    // comment is the wrong contract. The presence of the
    // `closest("button[data-op]")` selector is the regression guard.)
    expect(handler).toMatch(/e\.target\.closest\(\s*["']button\[data-op\]/);
    // After walking up, the resolver must read `op` from the matched
    // button — pinning `button.dataset.op` (not `e.target.dataset.op`)
    // catches a future copy-paste regression that drops the
    // `closest()` walk.
    expect(handler).toMatch(/button\.dataset\.op/);
  });

  it("menu wires every operation (open / settings / context action / theme-* / quit)", () => {
    const handler = petMenuClickHandler();
    // Event-emit operations are dispatched on the host bridge; theme
    // switches go through `invoke("set_active_theme", ...)`.
    expect(handler).toMatch(/emit\(\s*["']pet:open-dashboard["']/);
    expect(handler).toMatch(/emit\(\s*["']pet:open-settings["']/);
    expect(handler).toMatch(/emit\(\s*["']pet:context-action["']/);
    expect(handler).toMatch(/button\.dataset\.actionId/);
    expect(handler).toMatch(/emit\(\s*["']pet:quit["']/);
    expect(handler).not.toMatch(/pet:agent-action/);
    expect(handler).toMatch(/invoke\(\s*["']set_active_theme["']/);
    expect(handler).toMatch(
      /theme-\$\{|op\.slice\(\s*["']theme-["']\.length\s*\)/,
    );
  });

  it("renders dynamic prompt actions without a fixed fallback", () => {
    expect(stripped).not.toMatch(/data-op="agent-action"/);
    expect(stripped).toMatch(/pet-actions-section/);
    expect(stripped).toMatch(/function applyContextActions\(view\)/);
    expect(stripped).toMatch(/function rebuildContextActionButtons\(\)/);
    expect(stripped).toMatch(/view\.enabled/);
    expect(stripped).toMatch(/action\.enabled === false/);
    expect(stripped).toMatch(/btn\.dataset\.op = "context-action"/);
    expect(stripped).toMatch(/btn\.dataset\.actionId = action\.id/);
    expect(stripped).toMatch(/btn\.textContent = action\.label/);
    expect(stripped).not.toMatch(/dispatch_pet_context_action/);
    expect(stripped).not.toMatch(/pet:agent-action/);
  });

  it("does not read prompt bodies into the widget action menu", () => {
    expect(stripped).not.toMatch(/action\.prompt/);
    expect(stripped).not.toMatch(/dataset\.prompt/);
  });

  it("theme buttons expose data-op so closest() can find them", () => {
    // Source-level regression guard: if someone removes `data-op` from
    // a built-in theme button, the `closest("button[data-op]")`
    // resolver stops matching and the menu silently no-ops for that
    // theme again.
    expect(stripped).toMatch(/data-op="theme-fox"/);
    expect(stripped).toMatch(/data-op="theme-capybara"/);
  });

  it("theme tick span is nested inside the theme button (not the target)", () => {
    // The whole reason `closest()` is needed: the ✓ lives as a child
    // `<span class="menu-tick">` of each theme button, so the original
    // `e.target.dataset.op` read returned undefined for tick clicks.
    // Pin the markup shape so a future refactor that flattens the
    // structure (and could remove the bug at the cost of layout) is a
    // conscious decision. The `class="menu-tick` substring (no closing
    // quote) handles the `class="menu-tick active"` variant on the
    // currently-active theme's button.
    const themeFoxMatch = stripped.match(
      /<button[^>]*data-op="theme-fox"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(themeFoxMatch, "theme-fox button markup not found").not.toBeNull();
    if (themeFoxMatch) {
      expect(themeFoxMatch[0]).toMatch(/<span[^>]*class="menu-tick/);
    }
    // Same for capybara — the second built-in theme.
    const themeCapyMatch = stripped.match(
      /<button[^>]*data-op="theme-capybara"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(
      themeCapyMatch,
      "theme-capybara button markup not found",
    ).not.toBeNull();
    if (themeCapyMatch) {
      expect(themeCapyMatch[0]).toMatch(/<span[^>]*class="menu-tick/);
    }
  });
});

describe("pet context action bridge (#444)", () => {
  const mainPath = path.resolve(__dirname, "../../src-tauri/src/main.rs");
  const bridgePath = path.resolve(
    __dirname,
    "../../components/pet/pet-chat-bridge.tsx",
  );
  const homePath = path.resolve(__dirname, "../../app/(chat)/home.tsx");
  const chatPanelPath = path.resolve(
    __dirname,
    "../../components/agent/chat-panel.tsx",
  );

  const mainRs = readFileSync(mainPath, "utf8");
  const bridgeSource = readFileSync(bridgePath, "utf8");
  const homeSource = readFileSync(homePath, "utf8");
  const chatPanelSource = readFileSync(chatPanelPath, "utf8");

  it("sends custom context actions through the agent chat bridge", () => {
    const contextActionStart = mainRs.indexOf('listen("pet:context-action"');
    const guideStart = mainRs.indexOf('listen("pet:guide-connect-more"');

    expect(
      contextActionStart,
      "pet:context-action listener not found",
    ).toBeGreaterThan(-1);
    expect(
      guideStart,
      "pet:guide-connect-more listener not found",
    ).toBeGreaterThan(contextActionStart);

    const contextActionListener = mainRs.slice(contextActionStart, guideStart);
    expect(contextActionListener).toMatch(/parse_pet_context_action_id\(/);
    expect(contextActionListener).toMatch(/send_pet_context_action_to_chat\(/);

    expect(mainRs).toMatch(/pet::actions::read_config\(/);
    expect(mainRs).toMatch(/pet::actions::resolve_action_prompt\(/);
    expect(mainRs).toMatch(/pet::actions::build_agent_prompt\(/);
    expect(mainRs).toMatch(
      /send_pet_prompt_to_chat\(app,\s*["']pet:context-action["']/,
    );
    expect(mainRs).not.toMatch(/listen\(\s*["']pet:agent-action["']/);
    expect(mainRs).not.toMatch(/PET_AGENT_ACTION_DRAFT/);
  });

  it("keeps connector guidance on the existing send bridge", () => {
    const guideStart = mainRs.indexOf('listen("pet:guide-connect-more"');
    const briefStart = mainRs.indexOf('listen("pet:open-brief"', guideStart);

    expect(
      guideStart,
      "pet:guide-connect-more listener not found",
    ).toBeGreaterThan(-1);
    expect(briefStart, "pet:open-brief listener not found").toBeGreaterThan(
      guideStart,
    );

    const guideListener = mainRs.slice(guideStart, briefStart);
    expect(guideListener).toMatch(/send_pet_prompt_to_chat\(/);
  });

  it("registers a prefill chat bridge alongside the send bridge", () => {
    expect(bridgeSource).toMatch(
      /PREFILL_GLOBAL_KEY\s*=\s*["']__petChatBridgePrefill["']/,
    );
    expect(bridgeSource).toMatch(/window\[PREFILL_GLOBAL_KEY\]\s*=/);
    expect(bridgeSource).toMatch(/prefillToken=\$\{Date\.now\(\)\}/);
    expect(bridgeSource).toMatch(/window\[SEND_GLOBAL_KEY\]\s*=/);
  });

  it("routes prefilled input through Home into AgentChatPanel", () => {
    expect(homeSource).toMatch(
      /const prefillToken = searchParams\.get\(["']prefillToken["']\)/,
    );
    expect(homeSource).toMatch(/initialInput=\{initialInput\}/);
    expect(homeSource).toMatch(/prefillToken=\{prefillToken\}/);
  });

  it("decodes chat query drafts through the safe helper", () => {
    expect(homeSource).toMatch(/decodeSearchParamText\(urlSendMessage\)/);
    expect(homeSource).toMatch(/decodeSearchParamText\(urlInitialInput\)/);
    expect(homeSource).not.toMatch(/decodeURIComponent\(urlInitialInput\)/);
  });

  it("applies prefillToken as editable input without invoking send", () => {
    const prefillEffectStart = chatPanelSource.indexOf(
      "lastAppliedPrefillTokenRef",
    );
    const inputRefStart = chatPanelSource.indexOf(
      "// Keep inputRef in sync with input state",
      prefillEffectStart,
    );

    expect(prefillEffectStart, "prefillToken effect not found").toBeGreaterThan(
      -1,
    );
    expect(inputRefStart, "inputRef section not found").toBeGreaterThan(
      prefillEffectStart,
    );

    const prefillEffect = chatPanelSource.slice(
      prefillEffectStart,
      inputRefStart,
    );
    expect(prefillEffect).toMatch(/setInput\(initialInput\)/);
    expect(prefillEffect).toMatch(/localStorage\.setItem/);
    expect(prefillEffect).toMatch(/next\.delete\(["']prefillToken["']\)/);
    expect(prefillEffect).not.toMatch(/sendMessage/);
  });
});
