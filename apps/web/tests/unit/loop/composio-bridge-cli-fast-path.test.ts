/**
 * Pins the CLI-first wiring in `composio-bridge.ts::probeConnectorState`.
 *
 * Before this fast-path: `probeConnectorState` always dispatched a
 * 100+ line prompt to `/api/native/agent` and waited 60–120s for the
 * LLM to enumerate the user's Composio connections.
 *
 * After: the bridge tries `probeViaCli` first (~200ms when the local
 * `composio` CLI is installed) and only falls back to the agent when
 * the CLI can't answer. This file pins three contracts:
 *
 *   1. `kind: "ok"` from CLI → return immediately, agent NEVER called.
 *   2. CLI failure (`cli_not_found`, `cli_no_dev_project`,
 *      `cli_malformed`) → fall through to the agentic path. Agent
 *      success wins (so a CLI hiccup doesn't poison the snapshot).
 *   3. CLI failure + agent failure → the agent's own failure kind is
 *      what surfaces (`malformed_response` etc.), not the CLI kind —
 *      because the agentic path persists its own `lastProbeError` and
 *      the CLI diagnostic was never persisted by design.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectorEntry } from "@/lib/loop/types";

// Mock the CLI module BEFORE the bridge imports it — vitest hoists
// `vi.mock` calls so the SUT gets the stubbed version.
const probeViaCli = vi.fn();
vi.mock("@/lib/loop/composio-cli", () => ({
  probeViaCli: (...args: unknown[]) => probeViaCli(...args),
}));

const invokeAgentPrompt = vi.fn();
vi.mock("@/lib/loop/runner", () => ({
  invokeAgentPrompt: (...args: unknown[]) => invokeAgentPrompt(...args),
}));

const writeConnectorSnapshot = vi.fn();
const writeProbeError = vi.fn();
vi.mock("@/lib/loop/connectors", () => ({
  writeConnectorSnapshot: (...args: unknown[]) =>
    writeConnectorSnapshot(...args),
  writeProbeError: (...args: unknown[]) => writeProbeError(...args),
}));
vi.mock("@/lib/loop/store", () => ({ log: () => {} }));

const { probeConnectorState } = await import("@/lib/loop/composio-bridge");

function cliOk(entries: ConnectorEntry[]) {
  return { kind: "ok" as const, entries, surfaces: ["cli"] };
}

function agentOk(entries: ConnectorEntry[]) {
  return {
    ok: true,
    result: { connectors: entries },
  };
}

const TOOLKITS = [
  { id: "gmail", label: "Gmail" },
  { id: "google_calendar", label: "Google Calendar" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
  { id: "linear", label: "Linear" },
];

const GMAIL_ENTRY: ConnectorEntry = {
  id: "gmail",
  label: "Gmail",
  connected: true,
  accountCount: 1,
  accounts: [{ id: "ca_gmail", label: "timi@gmail.com", healthy: true }],
  probed: true,
  fetchedAt: new Date().toISOString(),
};

beforeEach(() => {
  probeViaCli.mockReset();
  invokeAgentPrompt.mockReset();
  writeConnectorSnapshot.mockReset();
  writeProbeError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (1) CLI success short-circuits the agentic path
// ---------------------------------------------------------------------------
describe("probeConnectorState CLI fast-path", () => {
  it("returns the CLI outcome and skips invokeAgentPrompt when CLI succeeds", async () => {
    probeViaCli.mockResolvedValueOnce(cliOk([GMAIL_ENTRY]));

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.surfaces).toEqual(["cli"]);
    expect(outcome.entries).toEqual([GMAIL_ENTRY]);
    expect(probeViaCli).toHaveBeenCalledTimes(1);
    expect(invokeAgentPrompt).not.toHaveBeenCalled();
  });

  it("threads the exact entries the CLI returned without re-parsing", async () => {
    const entries: ConnectorEntry[] = [
      {
        ...GMAIL_ENTRY,
        accounts: [{ id: "ca_g1", label: "a@x", healthy: true }],
      },
    ];
    probeViaCli.mockResolvedValueOnce(cliOk(entries));

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.entries[0].accounts?.[0].id).toBe("ca_g1");
  });
});

// ---------------------------------------------------------------------------
// (2) CLI failure falls through to the agentic path; agent success wins
// ---------------------------------------------------------------------------
describe("probeConnectorState fallback to agent", () => {
  it("falls through to invokeAgentPrompt when CLI returns cli_not_found", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_not_found",
      error: "composio CLI not on $PATH",
    });
    invokeAgentPrompt.mockResolvedValueOnce({
      ok: true,
      result: "success",
      text: JSON.stringify({
        surfaces_used: ["skill"],
        connectors: [GMAIL_ENTRY],
      }),
      reasoning: "",
      events: [
        { type: "session", content: "started" },
        {
          type: "text",
          content: JSON.stringify({ connectors: [GMAIL_ENTRY] }),
        },
        { type: "done", content: "success" },
      ],
    });

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("ok");
    expect(invokeAgentPrompt).toHaveBeenCalledTimes(1);
    const prompt = invokeAgentPrompt.mock.calls[0][0] as string;
    expect(prompt).toContain(
      "structured JSON object as your final assistant response",
    );
    expect(prompt).toContain("runtime owns SSE framing");
    expect(prompt).not.toContain("Emit exactly one SSE");
  });

  it("falls through when CLI returns cli_no_dev_project (most common prod failure)", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_no_dev_project",
      error: "composio dev project not initialized",
    });
    invokeAgentPrompt.mockResolvedValueOnce(agentOk([GMAIL_ENTRY]));

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("ok");
    expect(invokeAgentPrompt).toHaveBeenCalledTimes(1);
  });

  it("falls through when CLI returns cli_malformed (e.g. unexpected JSON)", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_malformed",
      diagnostic: "list output not JSON",
    });
    invokeAgentPrompt.mockResolvedValueOnce(agentOk([GMAIL_ENTRY]));

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("ok");
    expect(invokeAgentPrompt).toHaveBeenCalledTimes(1);
  });

  it("a successful agentic fallback overwrites any CLI diagnostic via writeConnectorSnapshot", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_malformed",
      diagnostic: "list output not JSON",
    });
    invokeAgentPrompt.mockResolvedValueOnce(agentOk([GMAIL_ENTRY]));

    await probeConnectorState({ toolkits: TOOLKITS });

    // The CLI diagnostic was NEVER persisted by design — see
    // `composio-cli.ts` (the comment explains why). The agentic path
    // persists its own snapshot via writeConnectorSnapshot, which is
    // what shows up on disk.
    expect(writeProbeError).not.toHaveBeenCalled();
    expect(writeConnectorSnapshot).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (3) Both fail → the agent's failure kind surfaces (not the CLI's)
// ---------------------------------------------------------------------------
describe("probeConnectorState when both surfaces fail", () => {
  it("surfaces the agent's failure kind when CLI fails AND agent fails", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_no_dev_project",
      error: "composio dev project not initialized",
    });
    invokeAgentPrompt.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "agent runtime down",
    });

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("agent_http_error");
    if (outcome.kind !== "agent_http_error") return;
    expect(outcome.error).toBe("agent runtime down");
    // The bridge persisted an `agent_http_error` diagnostic, NOT a
    // CLI one — the agent's failure is what the user should see.
    expect(writeProbeError).toHaveBeenCalledWith(
      "agent_http_error",
      expect.stringContaining("HTTP 500"),
    );
  });

  it("surfaces the agent's empty_response when CLI fails AND agent returns no connectors block", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_malformed",
      diagnostic: "list output not JSON",
    });
    // Truly empty response — `result: null` is the discriminator
    // `probeConnectorState` uses to distinguish "agent returned
    // something unparseable" from "agent returned literally nothing".
    invokeAgentPrompt.mockResolvedValueOnce({
      ok: true,
      result: null,
      text: "",
      reasoning: "",
      events: [],
    });

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });
    expect(outcome.kind).toBe("empty_response");
  });

  it("reports the hollow three-event Codex response as malformed without replacing the snapshot", async () => {
    probeViaCli.mockResolvedValueOnce({
      kind: "cli_not_found",
      error: "composio CLI not on $PATH",
    });
    invokeAgentPrompt.mockResolvedValueOnce({
      ok: true,
      result: "success",
      text: "",
      reasoning: "",
      events: [
        { type: "session", content: "started" },
        { type: "result", content: "success" },
        { type: "done", content: "success" },
      ],
    });

    const outcome = await probeConnectorState({ toolkits: TOOLKITS });

    expect(outcome.kind).toBe("malformed_response");
    if (outcome.kind !== "malformed_response") return;
    expect(outcome.diagnostic).toContain('events=3 text-head=""');
    expect(writeProbeError).toHaveBeenCalledWith(
      "malformed_response",
      expect.stringContaining('events=3 text-head=""'),
    );
    expect(writeConnectorSnapshot).not.toHaveBeenCalled();
  });
});
