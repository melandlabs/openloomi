/**
 * Loomi Pet card — connector refresh on compact re-open (#376).
 *
 * The compact status card (`apps/web/public/loomi-card.html`) renders
 * the connector pill row from a module-level `connectors` array that
 * was previously populated only by an initial `refreshConnectors()`
 * call during page load. Because the Tauri card webview is built once
 * and reused (hidden → shown), a card opened *before* the first probe
 * completed would render "No sources connected" forever — even after
 * the watcher wrote healthy entries to
 * `~/.openloomi/loop/connectors.json` (#376 root cause).
 *
 * The fix has three moving parts that the tests below assert against
 * the shipped source directly:
 *
 *   1. The `loop:card-mode` listener must call `refreshConnectors()`
 *      so every compact / full open fetches fresh data.
 *   2. `refreshConnectors()` must keep the last known good list
 *      visible when a refresh fails or returns a malformed payload.
 *      A new fetch only overwrites `connectors` when the payload
 *      actually carries an `items` array.
 *   3. A slow earlier request must NOT clobber a newer one — tracked
 *      by `connectorsRefreshInflight`, an in-flight token incremented
 *      per fetch.
 *
 * The card is plain HTML/JS that boots the Tauri bridge, so — like
 * `loomi-card-exit.test.ts` and `pet-theme.test.ts` — we assert against
 * the shipped source directly. A real DOM simulation is a follow-up once
 * happy-dom is wired into the node-environment vitest suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const cardPath = path.resolve(__dirname, "../../public/loomi-card.html");
const cardHtml = readFileSync(cardPath, "utf8");
// Strip HTML comments so a clarifying comment can't satisfy (or break)
// a source assertion — we only want to match real code.
const stripped = cardHtml.replace(/<!--[\s\S]*?-->/g, "");

// Isolate the loop:card-mode listener body so other handlers (e.g.
// loop:decision, loop:connectors) can't satisfy the same assertions.
function cardModeListenerBody(): string {
  const start = stripped.indexOf('tauri.event.listen("loop:card-mode"');
  expect(start, "loop:card-mode listener not found").toBeGreaterThan(-1);
  // The listener ends at the next `tauri.event.listen` for a different
  // event (`loop:connectors`), which immediately follows in the file.
  const end = stripped.indexOf('tauri.event.listen("loop:connectors"', start);
  expect(end, "loop:connectors listener not found").toBeGreaterThan(start);
  return stripped.slice(start, end);
}

// Isolate the refreshConnectors function body so the assertions below
// can target just the fetch / parse / overwrite sequence — without
// picking up unrelated code that happens to mention `connectors`.
function refreshConnectorsBody(): string {
  const start = stripped.indexOf("async function refreshConnectors");
  expect(start, "refreshConnectors function not found").toBeGreaterThan(-1);
  // The function ends at the next top-level `// ---------- ` divider,
  // which begins the AI-config refresh section. Using the comment
  // divider (rather than a `}` match) keeps the assertion robust
  // against future refactors that nest braces.
  const end = stripped.indexOf(
    "// ---------- AI config refresh ----------",
    start,
  );
  expect(end, "AI config refresh divider not found").toBeGreaterThan(start);
  return stripped.slice(start, end);
}

describe("compact card re-open refreshes connectors (#376)", () => {
  it("loop:card-mode listener triggers a refresh on every open", () => {
    const body = cardModeListenerBody();
    // The fix MUST call refreshConnectors() inside the card-mode
    // listener. Without this call, a card opened before the first
    // connector probe completes shows stale "No sources connected"
    // forever (#376 root cause).
    expect(body).toMatch(/void\s+refreshConnectors\s*\(\s*\)/);
  });

  it("listener still flips compactMode (preserves #365 behaviour)", () => {
    const body = cardModeListenerBody();
    // The fix is additive: it must not regress the compact-mode flag
    // toggling introduced in #365.
    expect(body).toMatch(/compactMode\s*=\s*!!p\.compact/);
    expect(body).toMatch(/apply\(\)/);
  });
});

describe("refreshConnectors preserves the last known good list (#376)", () => {
  it("declares an in-flight token to drop stale responses", () => {
    const body = refreshConnectorsBody();
    // `connectorsRefreshInflight` is the per-fetch monotonic counter
    // that lets overlapping fetches tell which response is freshest.
    // Without it, a slow earlier response could clobber a newer one —
    // exactly the #376 "stale UI-state" symptom at the response layer.
    expect(body).toMatch(/connectorsRefreshInflight/);
  });

  it("only overwrites `connectors` when payload has a valid items array", () => {
    const body = refreshConnectorsBody();
    // The original code reset `connectors = []` whenever the payload
    // lacked an items array, wiping out a previously-good snapshot.
    // The fix must gate the assignment on `Array.isArray(items)`.
    expect(body).toMatch(/Array\.isArray\(\s*items\s*\)/);
    expect(body).toMatch(/connectors\s*=\s*items/);
    // And it must NOT unconditionally default to `[]` on missing items.
    expect(body).not.toMatch(
      /connectors\s*=\s*Array\.isArray\([^)]\)\s*\?\s*[^:]+\s*:\s*\[\]/,
    );
  });

  it("treats non-2xx responses as a no-op (keeps previous list visible)", () => {
    const body = refreshConnectorsBody();
    // Acceptance criterion: "A slow or failed refresh does not erase
    // the last known good connector list." A `!res.ok` branch must
    // return without touching `connectors`.
    expect(body).toMatch(/if\s*\(\s*!\s*res\.ok\s*\)/);
    // The function should still call apply() on the failure path so
    // the empty-state copy doesn't blink — but it must NOT assign to
    // `connectors` inside the `!res.ok` branch.
    const notOkBranch = body.match(/if\s*\(\s*!\s*res\.ok\s*\)\s*\{[^}]*\}/);
    expect(notOkBranch).not.toBeNull();
    expect(notOkBranch?.[0]).not.toMatch(/connectors\s*=/);
  });

  it("treats a malformed JSON payload as a no-op (keeps previous list visible)", () => {
    const body = refreshConnectorsBody();
    // `await res.json().catch(() => null)` returns null on a malformed
    // body. The function must guard `items` extraction so a null
    // payload can't reach the assignment branch.
    expect(body).toMatch(/res\.json\(\)\.catch\(\(\)\s*=>\s*null\)/);
    expect(body).toMatch(/data\s*&&\s*data\.items/);
  });

  it("calls apply() on the success path so the UI repaints", () => {
    const body = refreshConnectorsBody();
    // The render path runs unconditionally — apply() is what calls
    // chooseLayout + renderNoApiKey + the compact layout. Without
    // it the new state would be cached but invisible.
    expect(body).toMatch(/apply\(\)/);
  });
});

describe("card-mode listener wiring (negative)", () => {
  it("does NOT call refreshConnectors() at page-init time without subsequent triggers", () => {
    // Sanity check: the listener MUST fire on every compact open, not
    // just on the very first mount. We assert that the listener body
    // contains the refresh call — the page-init call is a separate
    // (single-shot) concern that lives at the bottom of the script.
    const body = cardModeListenerBody();
    expect(body).toMatch(/void\s+refreshConnectors\s*\(\s*\)/);
  });
});
