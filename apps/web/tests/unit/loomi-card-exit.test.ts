/**
 * Loomi Pet card — exit-button symmetry (#319 / #317).
 *
 * The popup card (`apps/web/public/loomi-card.html`) has two ways out:
 *   - the ✕ button
 *   - the "View details" (open) action
 *
 * Both must do the SAME two things: handle the decision AND hide the
 * card window. Before #319 the open branch navigated but never hid the
 * window, so the card kept floating until the user clicked ✕ (the
 * mirror-image half of #317).
 *
 * The card is plain HTML/JS that boots the Tauri bridge, so — like
 * `pet-theme.test.ts` — we assert against the shipped source directly.
 * A real DOM simulation is a follow-up once happy-dom is wired into the
 * node-environment vitest suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const cardPath = path.resolve(__dirname, "../../public/loomi-card.html");
const cardHtml = readFileSync(cardPath, "utf8");
// Strip HTML comments so a clarifying comment can't satisfy (or break)
// a source assertion — we only want to match real code.
const stripped = cardHtml.replace(/<!--[\s\S]*?-->/g, "");

// Isolate the postAction() open branch so "hides the window" assertions
// can't be satisfied by the ✕ handler elsewhere in the file.
function openBranch(): string {
  const start = stripped.indexOf('if (action === "open")');
  expect(start, "postAction open branch not found").toBeGreaterThan(-1);
  // The open branch ends at the next top-level `if (action === "edit")`.
  const end = stripped.indexOf('if (action === "edit")', start);
  expect(end, "edit branch (open-branch terminator) not found").toBeGreaterThan(
    start,
  );
  return stripped.slice(start, end);
}

describe("loomi-card shared window-hide helper", () => {
  it("defines a single reusable hideCardWindow() function", () => {
    const defs = stripped.match(/function hideCardWindow\s*\(/g) || [];
    expect(defs.length).toBe(1);
  });

  it("hideCardWindow() performs the full retirement sequence", () => {
    const start = stripped.indexOf("function hideCardWindow");
    const body = stripped.slice(start, start + 2400);
    // OS-level hide.
    expect(body).toMatch(/win\.hide\(\)/);
    // Stop intercepting the cursor while hidden.
    expect(body).toMatch(/setIgnoreCursorEvents\(true\)/);
    // Tell the Rust host.
    expect(body).toMatch(/emit\(\s*["']pet:close-card["']\s*\)/);
    // Fade the local DOM (standalone-browser fallback).
    expect(body).toMatch(/card\.style\.display\s*=\s*["']none["']/);
  });
});

describe("View details (open) fully retires the card (#319)", () => {
  it("open branch calls the shared hideCardWindow()", () => {
    expect(openBranch()).toMatch(/hideCardWindow\(\)/);
  });

  it("open branch clears the decision so an in-flight event can't re-pop it", () => {
    const branch = openBranch();
    expect(branch).toMatch(/decision\s*=\s*null/);
    expect(branch).toMatch(/emit\(\s*["']loop:decision-cleared["']/);
  });

  it("open branch still emits the navigation events", () => {
    const branch = openBranch();
    expect(branch).toMatch(/emit\(\s*["']pet:open-dashboard["']/);
    expect(branch).toMatch(/emit\(\s*["']pet:open-brief["']/);
    expect(branch).toMatch(/emit\(\s*["']pet:open-wrap["']/);
    expect(branch).toMatch(/emit\(\s*["']pet:open-decision["']/);
  });
});

describe("✕ close reuses the same hide sequence", () => {
  it("close handler calls hideCardWindow() instead of an inline hide", () => {
    const start = stripped.indexOf('if (action === "close")');
    expect(start).toBeGreaterThan(-1);
    const end = stripped.indexOf('action === "guide-connect-more"', start);
    const branch = stripped.slice(start, end > start ? end : start + 2000);
    expect(branch).toMatch(/hideCardWindow\(\)/);
    // The inline duplicate should be gone from the close handler.
    expect(branch).not.toMatch(/getCurrentWebviewWindow/);
  });
});
