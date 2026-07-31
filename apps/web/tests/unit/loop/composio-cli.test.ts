/**
 * Tests for the CLI-direct connector probe fast-path
 * (`apps/web/lib/loop/composio-cli.ts`).
 *
 * Goal: pin the contract that backs `/api/loop/connectors?refresh=1`.
 * Before this fast-path, every refresh went through the agent runtime
 * (`/api/native/agent`) and waited 60–120s for the LLM to enumerate
 * the user's Composio connections. Now the bridge tries the local
 * `composio` CLI first (~200ms) and only falls back to the agent when
 * the CLI can't answer. These tests pin:
 *
 *   1. `kind: "ok"` is returned when both `whoami` and
 *      `connections list` succeed; entries are persisted to the on-disk
 *      cache.
 *   2. `kind: "cli_not_found"` is returned when the spawn-level call
 *      fails with ENOENT (binary not on `$PATH`).
 *   3. `kind: "cli_unauthorized"` is returned when `whoami` exits with
 *      a "not logged in" stderr (or its stdout is non-JSON).
 *   4. `kind: "cli_malformed"` is returned when the list call's stdout
 *      isn't parseable JSON, or when it returns an array instead of the
 *      per-toolkit object the parser expects.
 *   5. The slug normalization (`googlecalendar` → `google_calendar`)
 *      produces the canonical `ConnectorEntry.id` the Loop expects.
 *   6. The probe never persists `lastProbeError` on its own — the
 *      caller (`probeConnectorState`) is responsible for diagnostic
 *      writes, because a successful agentic fallback would overwrite
 *      the CLI diagnostic via `writeConnectorSnapshot` anyway.
 *
 * Note: the previous CLI invocation was `dev connected-accounts list
 * --status ACTIVE`, which required `composio dev init` to have been run
 * in the cwd. Switching to `connections list` (top-level command, no dev
 * project required) eliminates the `cli_no_dev_project` failure mode
 * entirely — the CLI is reachable from any cwd — so that test was
 * removed. CLI shape changed from a flat array of accounts to an object
 * keyed by toolkit slug, with `word_id` replacing `id` as the per-account
 * identifier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `composio-cli.ts` imports `./connectors` (for `writeConnectorSnapshot`)
// and `./store` (for `log`). Both need mocks so the on-disk cache is
// isolated to a per-test tmp dir and `log` stays quiet.
let LOOP_HOME = "";
let CONNECTORS_PATH = "";

vi.mock("@/lib/loop/paths", () => ({
  LOOP_PATHS: new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "home") return LOOP_HOME;
        if (prop === "connectors") return CONNECTORS_PATH;
        return join(LOOP_HOME, `${prop}.json`);
      },
    },
  ),
  ensureDirs: () => {},
  migrate: () => null,
}));

const writeConnectorSnapshot = vi.fn();
const writeProbeError = vi.fn();
vi.mock("@/lib/loop/connectors", () => ({
  writeConnectorSnapshot: (...args: unknown[]) =>
    writeConnectorSnapshot(...args),
  writeProbeError: (...args: unknown[]) => writeProbeError(...args),
}));
vi.mock("@/lib/loop/store", () => ({ log: () => {} }));

// Import after mocks so the SUT picks them up.
const { probeViaCli } = await import("@/lib/loop/composio-cli");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loop-cli-"));
  LOOP_HOME = tmp;
  CONNECTORS_PATH = join(tmp, "connectors.json");
  writeConnectorSnapshot.mockReset();
  writeProbeError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  if (tmp) {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    tmp = "";
    LOOP_HOME = "";
    CONNECTORS_PATH = "";
  }
});

// ---------------------------------------------------------------------------
// execImpl stub — matches the shape `promisify(execFile)` resolves with so
// the SUT's `runCli` wrapper doesn't have to special-case tests.
// ---------------------------------------------------------------------------
interface ExecCall {
  cmd: string;
  args: string[];
}

interface ExecScript {
  // args prefix match → either a successful {stdout, stderr} or a thrown error
  match: (call: ExecCall) => boolean;
  resolve?: { stdout: string; stderr: string };
  reject?: {
    code?: string;
    stderr?: string;
    stdout?: string;
    message?: string;
    killed?: boolean;
    signal?: string;
  };
}

function makeExec(script: ExecScript[]) {
  return async (cmd: string, args: string[], _opts: unknown) => {
    const call = { cmd, args };
    for (const step of script) {
      if (!step.match(call)) continue;
      if (step.resolve) return step.resolve;
      throw step.reject ?? new Error("unhandled");
    }
    throw new Error(`unhandled call: ${cmd} ${args.join(" ")}`);
  };
}

const whoamiSuccess = {
  match: (c: ExecCall) => c.args[0] === "whoami",
  resolve: {
    stdout: JSON.stringify({
      account_type: "human",
      email: "timi@example.com",
      current_org_name: "timi_workspace",
    }),
    stderr: "",
  },
};

const listSuccess = (stdoutJson: unknown) => ({
  match: (c: ExecCall) => c.args[0] === "connections" && c.args[1] === "list",
  resolve: { stdout: JSON.stringify(stdoutJson), stderr: "" },
});

const listMalformed = {
  match: (c: ExecCall) => c.args[0] === "connections" && c.args[1] === "list",
  resolve: { stdout: "<html>nope</html>", stderr: "" },
};

const enoentError = (args: string[]) => ({
  match: (c: ExecCall) => c.args[0] === args[0],
  reject: {
    code: "ENOENT",
    message: "spawn composio ENOENT",
    stderr: "",
    stdout: "",
  },
});

// ---------------------------------------------------------------------------
// Happy path — both calls succeed; entries are persisted
// ---------------------------------------------------------------------------
describe("probeViaCli happy path", () => {
  it("discovers the default ~/.composio/composio install with a Finder-like PATH", async () => {
    const composioDir = join(tmp, ".composio");
    const composioBinary = join(composioDir, "composio");
    mkdirSync(composioDir, { recursive: true });
    writeFileSync(composioBinary, "");
    chmodSync(composioBinary, 0o755);

    const calls: Array<ExecCall & { opts: unknown }> = [];
    const exec = async (cmd: string, args: string[], opts: unknown) => {
      calls.push({ cmd, args, opts });
      if (args[0] === "whoami") {
        return whoamiSuccess.resolve;
      }
      if (args[0] === "connections" && args[1] === "list") {
        return {
          stdout: JSON.stringify({
            github: [
              {
                status: "ACTIVE",
                alias: "semiok",
                word_id: "github_active",
              },
            ],
            linear: [
              {
                status: "ACTIVE",
                alias: "semiok@example.com",
                word_id: "linear_active",
              },
            ],
          }),
          stderr: "",
        };
      }
      throw new Error(`unhandled call: ${cmd} ${args.join(" ")}`);
    };

    const outcome = await probeViaCli({
      execImpl: exec,
      env: {
        ...process.env,
        HOME: tmp,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(calls.map((call) => call.cmd)).toEqual([
      composioBinary,
      composioBinary,
    ]);
    expect(
      calls.map((call) => (call.opts as { env?: NodeJS.ProcessEnv }).env?.PATH),
    ).toEqual([
      "/usr/bin:/bin:/usr/sbin:/sbin",
      "/usr/bin:/bin:/usr/sbin:/sbin",
    ]);
    expect(outcome.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github",
          connected: true,
          accountCount: 1,
        }),
        expect.objectContaining({
          id: "linear",
          connected: true,
          accountCount: 1,
        }),
      ]),
    );
  });

  it("returns ok with parsed entries and persists the snapshot", async () => {
    const exec = makeExec([
      whoamiSuccess,
      listSuccess({
        gmail: [
          {
            status: "ACTIVE",
            alias: "timi@gmail.com",
            word_id: "gmail_aaa",
            permission_group: null,
          },
        ],
        googlecalendar: [
          {
            status: "ACTIVE",
            alias: null,
            word_id: "googlecalendar_walrus-situla",
            permission_group: null,
          },
        ],
      }),
    ]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;

    expect(outcome.surfaces).toEqual(["cli"]);
    const byId = new Map(outcome.entries.map((e) => [e.id, e]));

    // gmail: alias used as label, one account, healthy.
    expect(byId.get("gmail")?.connected).toBe(true);
    expect(byId.get("gmail")?.accountCount).toBe(1);
    expect(byId.get("gmail")?.accounts?.[0].id).toBe("gmail_aaa");
    expect(byId.get("gmail")?.accounts?.[0].label).toBe("timi@gmail.com");
    expect(byId.get("gmail")?.accounts?.[0].healthy).toBe(true);

    // googlecalendar slug must be normalized to google_calendar.
    expect(byId.get("google_calendar")?.connected).toBe(true);
    expect(byId.get("google_calendar")?.accountCount).toBe(1);
    // Falls back to word_id when alias is null.
    expect(byId.get("google_calendar")?.accounts?.[0].label).toBe(
      "googlecalendar_walrus-situla",
    );

    // obsidian is local-only — must always come back offline.
    expect(byId.get("obsidian")?.connected).toBe(false);
    expect(byId.get("obsidian")?.lastError).toBe("local-only");

    // The catalog length is preserved (6 entries).
    expect(outcome.entries).toHaveLength(6);

    // Snapshot was persisted.
    expect(writeConnectorSnapshot).toHaveBeenCalledTimes(1);
    // Probe error was NOT persisted — happy path leaves the cache clean.
    expect(writeProbeError).not.toHaveBeenCalled();
  });

  it("filters non-ACTIVE accounts (EXPIRED/FAILED) out of the snapshot", async () => {
    // `connections list` returns EVERY account the user has ever linked,
    // including EXPIRED / FAILED — the Loop only cares about ACTIVE.
    // A toolkit with 2 EXPIRED + 1 ACTIVE should report as "1 connected"
    // (not "3 accounts, of which 2 are dead").
    const exec = makeExec([
      whoamiSuccess,
      listSuccess({
        gmail: [
          {
            status: "EXPIRED",
            alias: null,
            word_id: "gmail_dead-1",
            permission_group: null,
          },
          {
            status: "EXPIRED",
            alias: null,
            word_id: "gmail_dead-2",
            permission_group: null,
          },
          {
            status: "ACTIVE",
            alias: "alive@gmail.com",
            word_id: "gmail_alive",
            permission_group: null,
          },
        ],
      }),
    ]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;

    const gmail = outcome.entries.find((e) => e.id === "gmail");
    expect(gmail?.connected).toBe(true);
    expect(gmail?.accountCount).toBe(1);
    expect(gmail?.accounts?.[0].id).toBe("gmail_alive");
  });
});

// ---------------------------------------------------------------------------
// CLI missing — binary not on $PATH
// ---------------------------------------------------------------------------
describe("probeViaCli when CLI is missing", () => {
  it("returns cli_not_found and does not persist anything", async () => {
    const exec = makeExec([enoentError(["whoami"])]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("cli_not_found");
    if (outcome.kind !== "cli_not_found") return;
    expect(outcome.error).toMatch(/PATH/);

    // List call should NOT have been issued — once whoami fails the
    // list is guaranteed to fail too.
    expect(writeConnectorSnapshot).not.toHaveBeenCalled();
    expect(writeProbeError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CLI present but not logged in
// ---------------------------------------------------------------------------
describe("probeViaCli when CLI is unauthorized", () => {
  it("returns cli_unauthorized when whoami stdout is empty + stderr says 'not logged in'", async () => {
    const exec = makeExec([
      {
        match: (c) => c.args[0] === "whoami",
        resolve: { stdout: "", stderr: "Not logged in. Run `composio login`." },
      },
    ]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("cli_unauthorized");
    if (outcome.kind !== "cli_unauthorized") return;
    expect(outcome.error).toMatch(/Not logged in/);
  });

  it("returns cli_unauthorized when whoami reports a non-human account type", async () => {
    const exec = makeExec([
      {
        match: (c) => c.args[0] === "whoami",
        resolve: {
          stdout: JSON.stringify({ account_type: "agent" }),
          stderr: "",
        },
      },
    ]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("cli_unauthorized");
  });
});

// ---------------------------------------------------------------------------
// CLI present + authed but list output is malformed
// ---------------------------------------------------------------------------
describe("probeViaCli on malformed list output", () => {
  it("returns cli_malformed when the list stdout isn't JSON", async () => {
    const exec = makeExec([whoamiSuccess, listMalformed]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("cli_malformed");
  });

  it("returns cli_malformed when the list stdout is JSON but not an object", async () => {
    // The new `connections list` shape is a per-toolkit object keyed by
    // slug, NOT a flat array. An array response (or any non-object) is
    // a `cli_malformed` outcome.
    const exec = makeExec([whoamiSuccess, listSuccess([{ not: "an object" }])]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("cli_malformed");
  });

  it("silently drops toolkits whose value is not an array (tolerant parse)", async () => {
    // The parser is tolerant — a malformed value for one toolkit
    // (e.g. the CLI shipped a string instead of an account array) does
    // NOT poison the whole snapshot. The toolkit just renders as
    // disconnected (no accounts) and the rest of the catalog parses
    // normally. This is by design: a single broken row shouldn't drop
    // every other connector the user has authorized.
    const exec = makeExec([
      whoamiSuccess,
      listSuccess({
        gmail: "not an array",
        slack: [
          {
            status: "ACTIVE",
            alias: null,
            word_id: "slack_alive",
            permission_group: null,
          },
        ],
      }),
    ]);

    const outcome = await probeViaCli({ execImpl: exec });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;

    const gmail = outcome.entries.find((e) => e.id === "gmail");
    expect(gmail?.connected).toBe(false);
    expect(gmail?.accountCount).toBe(0);

    const slack = outcome.entries.find((e) => e.id === "slack");
    expect(slack?.connected).toBe(true);
    expect(slack?.accountCount).toBe(1);
    expect(slack?.accounts?.[0].id).toBe("slack_alive");
  });
});

// ---------------------------------------------------------------------------
// probeViaCli MUST NOT call writeProbeError — that's the caller's job
// (a successful agentic fallback overwrites the cache anyway).
// ---------------------------------------------------------------------------
describe("probeViaCli diagnostic-write contract", () => {
  it("never writes lastProbeError — only the caller (probeConnectorState) decides", async () => {
    // Force a `cli_malformed` outcome (CLI + auth works, list returns
    // something the parser can't read). This pins that the CLI probe
    // never persists a diagnostic of its own — the caller's
    // `probeConnectorState` decides what to write.
    const exec = makeExec([whoamiSuccess, listMalformed]);
    await probeViaCli({ execImpl: exec });
    expect(writeProbeError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The probe must NOT touch the on-disk cache file directly — only via
// writeConnectorSnapshot. This pins the seam so `connectors.ts`'s
// ensureDirs / capability-stamping logic stays the single source of
// truth for cache shape.
// ---------------------------------------------------------------------------
describe("probeViaCli file-write seam", () => {
  it("only writes via writeConnectorSnapshot — never directly to disk", async () => {
    const exec = makeExec([
      whoamiSuccess,
      listSuccess({
        gmail: [
          {
            status: "ACTIVE",
            alias: null,
            word_id: "gmail_a",
            permission_group: null,
          },
        ],
      }),
    ]);
    await probeViaCli({ execImpl: exec });

    // The real on-disk path shouldn't exist — writeConnectorSnapshot
    // was mocked, so nothing actually landed at CONNECTORS_PATH.
    expect(existsSync(CONNECTORS_PATH)).toBe(false);
    // And the mock was hit exactly once.
    expect(writeConnectorSnapshot).toHaveBeenCalledTimes(1);

    // Reading the real (nonexistent) file would error — guard against
    // regressions that bypass the mock.
    expect(() => readFileSync(CONNECTORS_PATH, "utf8")).toThrow();
  });
});
