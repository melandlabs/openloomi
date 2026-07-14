/**
 * Verifies that the tick prompt includes the "User-defined types" /
 * "User-defined channels" sections when the user has registered custom
 * entries via `customTypes` / `customChannels`. This is the contract
 * that lets the agent at `/api/native/agent` see the user's extensions
 * without a code change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let LOOP_HOME = "";

vi.mock("@/lib/loop/paths", async () => {
  const { join } = await import("node:path");
  const buildPaths = () => ({
    home: LOOP_HOME,
    signals: join(LOOP_HOME, "signals.jsonl"),
    decisions: join(LOOP_HOME, "decisions.json"),
    status: join(LOOP_HOME, "status.json"),
    brief: join(LOOP_HOME, "brief.json"),
    wrap: join(LOOP_HOME, "wrap.json"),
    connectors: join(LOOP_HOME, "connectors.json"),
    config: join(LOOP_HOME, "config.json"),
    mutes: join(LOOP_HOME, "mutes.json"),
    migrated: join(LOOP_HOME, "migrated.json"),
    log: join(LOOP_HOME, "loop.log"),
    inbox: join(LOOP_HOME, "inbox"),
    syncState: join(LOOP_HOME, "sync-state.json"),
    customTypes: join(LOOP_HOME, "custom-types.json"),
    customChannels: join(LOOP_HOME, "custom-channels.json"),
  });
  const pathsProxy = new Proxy(
    {},
    {
      get: (_t, prop: string) => (buildPaths() as Record<string, string>)[prop],
    },
  );
  return {
    get LOOP_HOME() {
      return LOOP_HOME;
    },
    LOOP_PATHS: pathsProxy,
    ensureDirs: () => {
      mkdirSync(LOOP_HOME, { recursive: true });
    },
  };
});

const { buildTickPrompt } = await import("@/lib/loop/tick-prompt");
const { customTypes } = await import("@/lib/loop/custom-types");
const { customChannels } = await import("@/lib/loop/custom-channels");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-prompt-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  mkdirSync(LOOP_HOME, { recursive: true });
  customTypes.invalidate();
  customChannels.invalidate();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildTickPrompt with custom extensions", () => {
  it("omits user-defined sections when nothing is registered", () => {
    const prompt = buildTickPrompt();
    expect(prompt).not.toContain("User-defined types (per-user extension");
    expect(prompt).not.toContain(
      "User-defined channels (custom signal sources)",
    );
  });

  it("includes a custom type in the classifier list", () => {
    customTypes.upsert({
      id: "pr_followup",
      label: "PR follow-up",
      icon: "ri-git-commit-line",
      actionKind: "slack_reply",
      description: "Send Slack reminder to PR reviewer",
      createdAt: new Date().toISOString(),
    });
    const prompt = buildTickPrompt();
    expect(prompt).toContain("User-defined types (per-user extension");
    expect(prompt).toContain("`pr_followup`");
    expect(prompt).toContain("PR follow-up");
    expect(prompt).toContain("`slack_reply`");
  });

  it("includes a custom channel in the signal sources block", () => {
    customChannels.upsert({
      id: "stripe_charges",
      label: "Stripe charges",
      toolkit: "stripe",
      toolSlug: "STRIPE_LIST_CHARGES",
      pollIntervalSec: 900,
      signalType: "stripe_charge",
      payloadShape: "{id, amount, status, customer}",
      createdAt: new Date().toISOString(),
    });
    const prompt = buildTickPrompt();
    expect(prompt).toContain("User-defined channels (custom signal sources)");
    expect(prompt).toContain("stripe_charges");
    expect(prompt).toContain("STRIPE_LIST_CHARGES");
    expect(prompt).toContain("`stripe_charge`");
  });

  it("includes both extensions together", () => {
    customTypes.upsert({
      id: "pr_followup",
      label: "PR follow-up",
      icon: "ri-git-commit-line",
      actionKind: "slack_reply",
      createdAt: new Date().toISOString(),
    });
    customChannels.upsert({
      id: "stripe_charges",
      label: "Stripe charges",
      toolkit: "stripe",
      toolSlug: "STRIPE_LIST_CHARGES",
      pollIntervalSec: 900,
      signalType: "stripe_charge",
      createdAt: new Date().toISOString(),
    });
    const prompt = buildTickPrompt();
    expect(prompt).toContain("User-defined types (per-user extension");
    expect(prompt).toContain("User-defined channels (custom signal sources)");
    // The expected toolkits line should mention stripe when a custom channel
    // for that toolkit is registered.
    expect(prompt).toMatch(/expected toolkits[\s\S]*?stripe/);
    // The connectors block in the result should include the custom channel.
    expect(prompt).toContain('"id": "stripe_charges"');
  });
});
