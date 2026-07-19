/**
 * Loomi Pet — alpha-aware hit-test source assertions (issue #392).
 *
 * The 168×168 frameless NSPanel that hosts `loomi-widget.html`
 * used to swallow clicks over its transparent corners because
 * macOS hit-tests the entire NSWindow frame. The fix layers three
 * independent mechanisms:
 *
 *   1. WebView-level: `pointer-events: none` on `html, body` with
 *      explicit opt-back on `.fox`, `.idle-pill`, and `#pet-menu`
 *      (and its descendants).
 *   2. Pixel-level: a cached alpha mask + a JS hit-tester that
 *      decides "claim or pass through" on every `mousemove` and
 *      pushes the result to the Tauri window via
 *      `setIgnoreCursorEvents`.
 *   3. OS-level: a 4 Hz poll of `get_global_cursor_position` so
 *      the WebView can detect "cursor drifted onto an opaque
 *      pixel" even while the window is in click-through mode
 *      (macOS won't deliver `mousemove` in that state).
 *
 * The widget is plain HTML/JS so we mirror the assertions on the
 * shipped source directly — a real DOM simulation is tracked as a
 * follow-up once happy-dom is wired into vitest.
 *
 * A real DOM simulation is the right shape for this test in the
 * long run, but a DOM simulation would still have to mock
 * `__TAURI__`, `device_query`, the WebView window, the canvas
 * 2D context, and the OS-level click-through flag. Source
 * assertions catch the same regressions at a fraction of the
 * cost and survive any future Tauri or webview backend swap.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const widgetPath = path.resolve(__dirname, "../../public/loomi-widget.html");
const widgetHtml = readFileSync(widgetPath, "utf8");
// Strip HTML comments so a clarifying comment can't satisfy (or
// break) a source assertion — we only want to match real code.
const stripped = widgetHtml.replace(/<!--[\s\S]*?-->/g, "");

// `setState` was extended in #392 to call `adoptMaskFromLoadedImage`
// before flipping `fox.src` so the first `mousemove` after a
// cross-fade sees a valid mask. Slice the function body so the
// assertion can target the exact branch and can't be silently
// satisfied by a comment elsewhere in the file.
function setStateBody(): string {
  const start = stripped.indexOf("function setState(key)");
  expect(start, "setState() not found").toBeGreaterThan(-1);
  // `setState` is a long function; grab the next 2400 chars which
  // is comfortably larger than its current body. The mask-related
  // tokens all sit near the top so this is well-bounded.
  return stripped.slice(start, start + 2400);
}

describe("loomi-widget hit-test module (#392) — DOM-level scoping", () => {
  it("disables pointer events on html and body", () => {
    // The body + html rule must contain `pointer-events: none`.
    // We match the exact selector pair so a regression that
    // applies the rule only to `body` (missing `html`) still
    // fails this test.
    const bodyRule = stripped.match(/html,\s*body\s*{[^}]*}/);
    expect(bodyRule, "html, body rule not found").not.toBeNull();
    expect(bodyRule?.[0]).toMatch(/pointer-events:\s*none/);
  });

  it("opts the fox back in to pointer events", () => {
    // The .fox element must remain interactive so dragging and
    // click-to-dashboard still work. The opt-back selector list
    // includes `.fox` so a future refactor that drops it from the
    // group still keeps the explicit `.fox { pointer-events: auto }`
    // rule in the .fox block.
    expect(stripped).toMatch(/\.fox\s*{[^}]*pointer-events:\s*auto/);
  });

  it("opts the idle status pill back in to pointer events", () => {
    // The opt-back group must include `.idle-pill` so a user can
    // click the pill while the rest of the chrome (and the
    // transparent sprite corners) pass clicks through. A blank
    // `pointer-events: auto` on the rule is fine; the
    // presence-in-group check is what catches the regression.
    expect(stripped).toMatch(/\.idle-pill\s*,?\s*\n?\s*#pet-menu/);
  });

  it("opts the right-click menu back in to pointer events", () => {
    // The opt-back group must include `#pet-menu` so the menu
    // buttons keep receiving clicks. The descendant selector
    // `#pet-menu *` is what guarantees that clicks on the
    // nested `<button data-op="…">` elements still reach the
    // menu's `click` handler when the parent body is
    // `pointer-events: none`.
    expect(stripped).toMatch(/#pet-menu\s*,\s*#pet-menu\s*\*/);
  });

  it("does NOT opt the pending badge back in", () => {
    // The pending badge has no handler and is a 22×22 DOM rect
    // that the alpha hit-tester can't see. Opting it back in
    // would re-introduce a small click-eating rectangle every
    // time a queued decision lands. Pin the explicit
    // `pointer-events: none` on `.pending-badge` so this can't
    // regress.
    const badgeRule = stripped.match(/\.pending-badge\s*{[^}]*}/);
    expect(badgeRule, ".pending-badge rule not found").not.toBeNull();
    expect(badgeRule?.[0]).toMatch(/pointer-events:\s*none/);
  });
});

describe("loomi-widget hit-test module (#392) — alpha mask canvas", () => {
  it("declares a hidden 168x168 hit-mask canvas", () => {
    // The canvas is the source of alpha data for the JS
    // hit-tester. `width=168 height=168` mirrors the canonical
    // PET_W / PET_H from `pet::window::build_pet_window` so
    // screen-to-local CSS conversion doesn't need to scale.
    // `hidden` keeps the canvas out of the accessibility tree and
    // out of the visual layout; the JS reads its 2D context
    // directly.
    expect(stripped).toMatch(
      /<canvas[\s\S]*?id="hit-mask"[\s\S]*?width="168"[\s\S]*?height="168"[\s\S]*?hidden/,
    );
  });
});

describe("loomi-widget hit-test module (#392) — JS constants", () => {
  it("declares MASK_W = 168 matching the canonical pet width", () => {
    // Mirror the PET_W constant from `apps/web/src-tauri/src/pet/window.rs`
    // so a future refactor of the Rust side can update this in
    // lock-step. A mismatch would mean the alpha mask is sampled
    // at a different resolution than the window, and clicks
    // would be classified against the wrong pixel.
    expect(stripped).toMatch(/const\s+MASK_W\s*=\s*168\s*;/);
  });

  it("declares MASK_H = 168 matching the canonical pet height", () => {
    expect(stripped).toMatch(/const\s+MASK_H\s*=\s*168\s*;/);
  });

  it("declares ALPHA_THRESHOLD = 32 (per the design constants)", () => {
    // 16 flickers on antialiased limbs; 64 carves out real
    // pixels on thin parts of the sprite. 32 is the middle
    // ground documented in the implementation comment.
    expect(stripped).toMatch(/const\s+ALPHA_THRESHOLD\s*=\s*32\s*;/);
  });
});

describe("loomi-widget hit-test module (#392) — hit-tester state", () => {
  it("declares a maskCache Map keyed by sprite URL", () => {
    // The cache is the single source of truth for alpha data.
    // A `Map<url, Uint8ClampedArray>` lets the JS reuse a single
    // sample per sprite across all (theme, state) pairs and
    // across all cursor positions.
    expect(stripped).toMatch(
      /(?:const|let|var)\s+maskCache\s*=\s*new\s+Map\s*\(/,
    );
  });

  it("declares currentMask and currentMaskUrl slots", () => {
    // `currentMask` is the alpha buffer for the sprite currently
    // painted into the fox <img>; `currentMaskUrl` is its
    // source. Both are read by `isFoxPixelVisible` on every
    // cursor move.
    expect(stripped).toMatch(/(?:const|let|var)\s+currentMask\b/);
    expect(stripped).toMatch(/(?:const|let|var)\s+currentMaskUrl\b/);
  });

  it("declares evaluateHitTest(x, y)", () => {
    // The hit-tester is the single decision point: should the
    // window claim the next click, or should it pass through?
    // Returning `true` claims; `false` passes through.
    expect(stripped).toMatch(
      /function\s+evaluateHitTest\s*\(\s*x\s*,\s*y\s*\)/,
    );
  });

  it("evaluateHitTest prioritises the transient lock + body classes", () => {
    // The lock + body classes (`dragging`, `longpress`,
    // `petMenuOpen`) must short-circuit to `true` so a gesture
    // that started inside the pet can never silently escape
    // mid-gesture. Pin the order so a regression that puts the
    // alpha check first can't be silently tolerated.
    const fnStart = stripped.indexOf("function evaluateHitTest");
    const fnBody = stripped.slice(fnStart, fnStart + 1500);
    const lockIdx = fnBody.indexOf("transientLock");
    const bodyIdx = fnBody.indexOf('classList.contains("dragging")');
    const alphaIdx = fnBody.indexOf("isFoxPixelVisible");
    expect(lockIdx, "transientLock check missing").toBeGreaterThan(-1);
    expect(bodyIdx, "dragging class check missing").toBeGreaterThan(-1);
    expect(alphaIdx, "isFoxPixelVisible missing").toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(alphaIdx);
  });
});

describe("loomi-widget hit-test module (#392) — setIgnoreCursorEvents wiring", () => {
  function countOccurrences(needle: string): number {
    return (stripped.match(new RegExp(needle, "g")) || []).length;
  }

  it("calls setIgnoreCursorEvents from transientLockActive", () => {
    // (d) per the design — the lock acquires the OS-level claim
    // immediately so a moment between `pointerdown` and the
    // body class being committed can't slip into click-through.
    // The call sits inside an `if (transientLock === 1)` block
    // after a 5-line comment, so the slice is larger than the
    // function's line count suggests.
    const fnStart = stripped.indexOf("function transientLockActive");
    const fnBody = stripped.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/setIgnoreCursorEvents\s*\(\s*false\s*\)/);
  });

  it("transientLockActive is invoked from onPointerDown (drag start)", () => {
    // (a) per the design — the drag must receive move/up even
    // if the cursor is mid-cross-fade or over a transparent
    // pixel. The call sits at the end of a comment block; we
    // only need to verify the call is present in the function
    // body, not the exact line order vs. the long-press timer.
    const fnStart = stripped.indexOf("function onPointerDown");
    // 6000 chars comfortably covers the full function (it's
    // ~89 source lines including the alpha-aware comment block).
    const fnBody = stripped.slice(fnStart, fnStart + 6000);
    expect(fnBody).toMatch(/transientLockActive\s*\(\s*\)\s*;/);
  });

  it("transientLockActive is invoked from openPetMenu (menu open)", () => {
    // (b) per the design — the in-widget menu is a DOM overlay
    // that extends beyond the 168×168 frame; without the lock
    // the alpha hit-tester could flip to click-through while
    // the menu is open. The call sits at the very end of the
    // function after a long comment block, so the slice is
    // larger than the function's apparent line count suggests.
    const fnStart = stripped.indexOf("function openPetMenu");
    const fnBody = stripped.slice(fnStart, fnStart + 3000);
    expect(fnBody).toMatch(/transientLockActive\s*\(\s*\)\s*;/);
  });

  it("setIgnoreCursorEvents is invoked from the evaluate path", () => {
    // (c) per the design — `evaluateAndApply` is the bridge
    // between the JS hit-tester and the OS-level click-through
    // flag. Without this call the alpha mask's verdict is
    // computed but never reaches the windowing system.
    const fnStart = stripped.indexOf("function evaluateAndApply");
    const fnBody = stripped.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/setIgnoreCursorEvents\s*\(/);
  });

  it("setIgnoreCursorEvents is defined as an async function with a state-mirror guard", () => {
    // The implementation caches `lastIgnoreState` so redundant
    // calls don't issue an IPC round-trip on every mousemove.
    // The mirror + the early return is what keeps the
    // mousemove path cheap.
    const fnStart = stripped.indexOf("async function setIgnoreCursorEvents");
    expect(fnStart, "setIgnoreCursorEvents not defined").toBeGreaterThan(-1);
    const fnBody = stripped.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/lastIgnoreState/);
    expect(fnBody).toMatch(/return/);
  });
});

describe("loomi-widget hit-test module (#392) — 4 Hz cursor polling", () => {
  it("polls get_global_cursor_position on a 250 ms setInterval", () => {
    // The poll is the only signal that the cursor has drifted
    // onto an opaque pixel while the window is in click-through
    // mode (macOS won't deliver `mousemove` in that state). The
    // 250 ms interval is the design constant — fast enough to
    // feel instantaneous, slow enough to be invisible on the
    // IPC log.
    expect(stripped).toMatch(
      /setInterval\s*\(\s*pollCursorOnce\s*,\s*250\s*\)/,
    );
  });

  it("invokes the new Tauri command via t.core.invoke", () => {
    // The polled command name must match the Rust command
    // registered in `pet::get_global_cursor_position` (see
    // `apps/web/src-tauri/src/pet/mod.rs`). A typo would cause
    // `invoke` to throw on every poll and the click-through
    // mode would never recover.
    expect(stripped).toMatch(
      /t\.core\.invoke\(\s*["']get_global_cursor_position["']\s*\)/,
    );
  });

  it("attaches a visibilitychange listener that pauses the poller", () => {
    // The poller is only useful while the document is visible.
    // Skipping hidden-tab polls cuts the IPC cost from 4 Hz to
    // zero when the user minimises or switches workspaces, and
    // prevents stale `lastCursorX/Y` from triggering spurious
    // mode flips on the next visible tick.
    expect(stripped).toMatch(
      /addEventListener\(\s*["']visibilitychange["']\s*,\s*syncPollState\s*\)/,
    );
  });
});

describe("loomi-widget hit-test module (#392) — setState mask adoption", () => {
  it("calls adoptMaskFromLoadedImage inside img.onload BEFORE fox.src = src", () => {
    // The mask must be adopted in the same microtask the new
    // sprite finishes loading so the first `mousemove` after
    // the fade-in sees a valid mask. A regression that adopts
    // the mask AFTER `fox.src = src` would still satisfy the
    // "is the call present" test, but the very first cursor
    // move would route against the old sprite's mask.
    const body = setStateBody();
    const adoptIdx = body.indexOf("adoptMaskFromLoadedImage");
    const foxSrcIdx = body.indexOf("fox.src = src");
    expect(
      adoptIdx,
      "adoptMaskFromLoadedImage not in setState",
    ).toBeGreaterThan(-1);
    expect(foxSrcIdx, "fox.src = src not in setState").toBeGreaterThan(-1);
    expect(adoptIdx).toBeLessThan(foxSrcIdx);
  });

  it("holds the transient lock around the cross-fade", () => {
    // While `fox.style.opacity` is mid-fade, the visual fox is
    // invisible but the alpha mask still classifies the
    // underlying pixel as opaque. Without the lock, a click on
    // a pixel that the new sprite is about to cover would
    // silently pass through to the underlying app. The lock
    // keeps the window claiming events until the fade-in
    // completes.
    const body = setStateBody();
    const lockActiveIdx = body.indexOf("transientLockActive()");
    const releaseIdx = body.indexOf("releaseTransientLock()");
    expect(
      lockActiveIdx,
      "transientLockActive() not in setState",
    ).toBeGreaterThan(-1);
    expect(
      releaseIdx,
      "releaseTransientLock() not in setState",
    ).toBeGreaterThan(-1);
    expect(lockActiveIdx).toBeLessThan(releaseIdx);
  });
});

describe("loomi-widget hit-test module (#392) — screen-to-local CSS conversion", () => {
  it("screenToLocalCSS divides by petScale to convert physical → CSS px", () => {
    // device_query returns physical pixels; the WebView's
    // `e.clientX/Y` (and the alpha mask's index space) are in
    // CSS px. On a retina display the conversion factor is the
    // window's `scale_factor()`. Pin the division so a future
    // refactor that forgets the scale factor can't silently
    // route clicks against the wrong pixel on retina.
    const fnStart = stripped.indexOf("function screenToLocalCSS");
    const fnBody = stripped.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/\)\s*\/\s*petScale\b/);
  });

  it("returns null when the cursor is outside the 168×168 frame", () => {
    // The poller fires every 250 ms even when the user is
    // moving the cursor across the rest of the desktop. Without
    // a bounds check, the JS would index the alpha mask with
    // out-of-range CSS px and read the wrong pixel (the canvas
    // backing store is 168×168 = 28224 cells; a negative index
    // would read from offset (n * 4 + 3) which can wrap to
    // garbage memory).
    const fnStart = stripped.indexOf("function screenToLocalCSS");
    const fnBody = stripped.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/return\s+null/);
  });
});

describe("loomi-widget hit-test module (#392) — handler integration", () => {
  it("mousemove listener updates lastCursorX/Y and re-evaluates", () => {
    // The hit-tester needs a fresh cursor position on every
    // move so the OS-level flag matches the JS state within a
    // frame. Without this listener the alpha mask would only be
    // consulted on `pointerdown`, and the user would experience
    // a one-click "stuck" state whenever they drifted between
    // opaque and transparent areas.
    expect(stripped).toMatch(
      /addEventListener\(\s*["']mousemove["']\s*,\s*onDocMouseMove\s*\)/,
    );
    const fnStart = stripped.indexOf("function onDocMouseMove");
    const fnBody = stripped.slice(fnStart, fnStart + 400);
    expect(fnBody).toMatch(/lastCursorX\s*=\s*e\.clientX/);
    expect(fnBody).toMatch(/lastCursorY\s*=\s*e\.clientY/);
    expect(fnBody).toMatch(/evaluateAndApply\s*\(\s*\)\s*;/);
  });

  it("pointerdown capture listener seeds lastCursorX/Y", () => {
    // The first press of a session has no preceding `mousemove`
    // to seed the cached cursor position. Without the
    // capture-phase seed, `evaluateHitTest` would see `(0, 0)`
    // for the first click and route it against the top-left
    // corner of the sprite.
    expect(stripped).toMatch(
      /addEventListener\(\s*["']pointerdown["']\s*,\s*onDocPointerDownCapture\s*,\s*true\s*\)/,
    );
    const fnStart = stripped.indexOf("function onDocPointerDownCapture");
    const fnBody = stripped.slice(fnStart, fnStart + 400);
    expect(fnBody).toMatch(/lastCursorX\s*=\s*e\.clientX/);
    expect(fnBody).toMatch(/lastCursorY\s*=\s*e\.clientY/);
  });

  it("onPointerDown skips startDragging on a transparent pixel", () => {
    // The plan: `accept_first_mouse(true)` on the NSPanel
    // still routes the very first click to the webview even
    // in click-through mode. The alpha-aware `pointerdown`
    // handler absorbs that click without dragging when the
    // cursor is on a transparent pixel. The user has to click
    // twice on a transparent corner (first to disarm
    // `accept_first_mouse`, second to pass through) — that's
    // the standard tradeoff documented in the implementation
    // comment.
    const fnStart = stripped.indexOf("function onPointerDown");
    const fnBody = stripped.slice(fnStart, fnStart + 2400);
    // The early-return branch checks both `isCursorOverInteractive`
    // and `isFoxPixelVisible` for the alpha-aware filter.
    expect(fnBody).toMatch(/isCursorOverInteractive\s*\(/);
    expect(fnBody).toMatch(/isFoxPixelVisible\s*\(/);
    expect(fnBody).toMatch(/return\s*;\s*\}/);
  });
});
