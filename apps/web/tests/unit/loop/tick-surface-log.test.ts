/**
 * #391 — the agentic tick's "done" log line printed a literal `?` for
 * `surfaces=` whenever the agent's `result` payload carried no
 * `surfaces_used`. This pins the fallback: when `surfaces_used` is empty
 * but the agent DID report a connector snapshot, the log line derives
 * the surfaces from the connected toolkit IDs in that snapshot
 * (`surfaces=gmail,github,slack`) instead of the opaque `?`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logLines: string[] = [];
const invokeAgentPrompt = vi.fn();
const writeConnectorSnapshot = vi.fn();

vi.mock("@/lib/loop/paths", () => ({
  LOOP_PATHS: { home: "/tmp/loop-test" },
  ensureDirs: () => {},
  migrate: () => null,
}));
vi.mock("@/lib/loop/store", () => ({
  log: (m: string) => logLines.push(m),
  writeStatus: () => {},
  decisions: {
    list: () => [],
    add: () => null,
    update: () => {},
    moveTo: () => {},
  },
  signals: { list: () => [] },
}));
vi.mock("@/lib/loop/tick-prompt", () => ({
  buildTickPrompt: () => "prompt",
}));
vi.mock("@/lib/loop/classifier-rules", () => ({
  classifierRules: { list: () => [] },
  findMatchingRule: () => null,
}));
vi.mock("@/lib/loop/activation", () => ({
  recordEvent: () => {},
}));
vi.mock("@/lib/loop/runner", () => ({
  invokeAgentPrompt: (...args: unknown[]) => invokeAgentPrompt(...args),
}));
vi.mock("@/lib/loop/connectors", () => ({
  writeConnectorSnapshot: (...args: unknown[]) =>
    writeConnectorSnapshot(...args),
}));
vi.mock("@/lib/loop/github-notifications", () => ({
  aggregateGithubNotifications: () => ({ kind: "none", newKeys: [] }),
}));

const { run } = await import("@/lib/loop/tick");

beforeEach(() => {
  logLines.length = 0;
  invokeAgentPrompt.mockReset();
  writeConnectorSnapshot.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("tick surface-log derivation (#391)", () => {
  it("derives surfaces= from the connected snapshot when surfaces_used is empty", async () => {
    invokeAgentPrompt.mockResolvedValue({
      ok: true,
      result: {
        scanned: 3,
        surfaced: 0,
        muted: 0,
        errors: 0,
        // The failure mode: agent omitted surfaces_used entirely.
        surfaces_used: [],
        connectors: [
          { id: "gmail", label: "Gmail", connected: true, accountCount: 1 },
          { id: "github", label: "GitHub", connected: true, accountCount: 1 },
          { id: "slack", label: "Slack", connected: true, accountCount: 1 },
          // A disconnected toolkit must NOT appear in the derived list.
          { id: "linear", label: "Linear", connected: false, accountCount: 0 },
        ],
      },
    });

    await run();

    const doneLine = logLines.find((l) => l.includes("tick (agentic) done:"));
    expect(doneLine).toBeDefined();
    expect(doneLine).toContain("surfaces=gmail,github,slack");
    expect(doneLine).not.toContain("surfaces=?");
  });

  it("prefers surfaces_used when the agent reports it", async () => {
    invokeAgentPrompt.mockResolvedValue({
      ok: true,
      result: {
        scanned: 0,
        surfaced: 0,
        muted: 0,
        errors: 0,
        surfaces_used: ["cli", "insights"],
        connectors: [
          { id: "gmail", label: "Gmail", connected: true, accountCount: 1 },
        ],
      },
    });

    await run();

    const doneLine = logLines.find((l) => l.includes("tick (agentic) done:"));
    expect(doneLine).toContain("surfaces=cli,insights");
  });
});
