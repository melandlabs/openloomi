/**
 * #391 — `refreshConnectors({ silent: true })` wraps the agent probe in a
 * 10-minute `PROBE_TIMEOUT_MS` race. When the probe hangs, the timeout
 * wins and the path must:
 *
 *   1. Persist `lastProbeError.kind === "timeout"` to the cache file.
 *   2. Persist a `probeCooldownUntil` marker so a rapid re-open within
 *      `PROBE_COOLDOWN_MS` (30s) short-circuits to cache / FALLBACK.
 *
 * This lives in its own file (not the existing `connector-accounts.test.ts`)
 * because that test mocks `@/lib/loop/connectors` entirely — which would
 * swallow the very `writeProbeError` / `writeProbeCooldownMarker` writes
 * we want to assert against the real filesystem. Here we let the real
 * `connectors.ts` run, redirect `LOOP_PATHS.connectors` to a temp
 * directory, and replace only the agent-bridge with a hanging promise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The mock factory needs access to per-test filesystem paths, but
// `vi.mock` factories are hoisted above module-level `const`/`let`
// bindings. The pattern used elsewhere in this codebase (see
// `tests/api/loop-activation.route.test.ts`) is to declare mutable
// `let` bindings at module scope and let the mock factory read them
// through a Proxy — the proxy dereferences lazily, so the values
// populated in `beforeEach` are visible by the time the SUT actually
// touches the paths.
let LOOP_HOME = "";
let CONNECTORS_PATH = "";

vi.mock("@/lib/loop/paths", () => ({
  LOOP_PATHS: new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "home") return LOOP_HOME;
        if (prop === "connectors") return CONNECTORS_PATH;
        // Other paths are never touched by `connectors.ts` — return a
        // placeholder under the home so anything that incidentally
        // imports this module doesn't blow up.
        return join(LOOP_HOME, `${prop}.json`);
      },
    },
  ),
  ensureDirs: () => {},
  migrate: () => null,
}));

// `connectors.ts` imports `custom-channels` which reads from the user's
// real `custom-channels.json`. Empty list keeps the cache shape
// predictable — no per-test teardown for custom channels needed.
vi.mock("@/lib/loop/custom-channels", () => ({
  customChannels: { list: () => [] },
}));

// Hang the probe so the silent-mode `PROBE_TIMEOUT_MS` race is the only
// thing that can resolve the `Promise.race`.
vi.mock("@/lib/loop/composio-bridge", () => ({
  probeConnectorState: () => new Promise(() => {}),
}));

const { refreshConnectors, getLastProbeError, clearProbeCooldown } =
  await import("@/lib/loop/connectors");

// Mirror the internal constants from `connectors.ts`. The test doesn't
// import them directly (they aren't exported) so we re-state the
// expected values here as part of pinning the contract: if a future
// refactor changes these, the test surfaces it instead of silently
// passing.
const EXPECTED_PROBE_TIMEOUT_MS = 10 * 60 * 1000; // 600_000
const EXPECTED_PROBE_COOLDOWN_MS = 30 * 1000; // 30_000

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loop-timeout-"));
  LOOP_HOME = tmp;
  CONNECTORS_PATH = join(tmp, "connectors.json");
});

afterEach(() => {
  vi.useRealTimers();
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

describe("refreshConnectors timeout (#391)", () => {
  it("persists lastProbeError=timeout and a probeCooldownUntil marker when the probe hangs", async () => {
    // Only fake `setTimeout` so `Date.now()` keeps returning real wall-
    // clock time. The cooldown assertion compares
    // `probeCooldownUntil` against `Date.now()` and faking Date would
    // freeze the comparison at a value that drifts from the cooldown
    // timestamp set inside `writeProbeCooldownMarker`.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const before = Date.now();
    const promise = refreshConnectors({ silent: true });

    // Advance just past PROBE_TIMEOUT_MS so the timer in
    // `refreshConnectors`'s race resolves with the `TIMED_OUT` sentinel.
    // The probe (a never-resolving promise) never wins, so the race
    // resolves solely because of this advance.
    await vi.advanceTimersByTimeAsync(EXPECTED_PROBE_TIMEOUT_MS + 100);

    // Wait for the rest of `refreshConnectors` to drain — the timer
    // resolution should have already kicked off
    // `writeProbeError("timeout", ...)` and
    // `writeProbeCooldownMarker()`, both of which are synchronous
    // filesystem writes. Awaiting the original promise guarantees those
    // writes landed before we assert against the file.
    const result = await promise;

    // ----- on-disk cache assertions ----------------------------------
    expect(existsSync(CONNECTORS_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(CONNECTORS_PATH, "utf8"));

    // (1) `lastProbeError` diagnostic.
    expect(raw.lastProbeError).toBeDefined();
    expect(raw.lastProbeError.kind).toBe("timeout");
    // The diagnostic message names the timeout budget so on-call
    // engineers can correlate it with `PROBE_TIMEOUT_MS`.
    expect(raw.lastProbeError.message).toMatch(
      new RegExp(String(EXPECTED_PROBE_TIMEOUT_MS)),
    );
    expect(typeof raw.lastProbeError.at).toBe("string");
    // `at` is a valid ISO string parseable by `new Date()`.
    expect(() => new Date(raw.lastProbeError.at).toISOString()).not.toThrow();

    // (2) `probeCooldownUntil` marker — must be a future timestamp
    // ~30 s ahead of `before`, matching `PROBE_COOLDOWN_MS`.
    expect(typeof raw.probeCooldownUntil).toBe("string");
    const cooldownMs = new Date(raw.probeCooldownUntil).getTime();
    expect(cooldownMs).toBeGreaterThan(before);
    const delta = cooldownMs - before;
    expect(delta).toBeGreaterThanOrEqual(EXPECTED_PROBE_COOLDOWN_MS);
    // Generous upper bound — give the test a 5s slack to absorb
    // scheduler jitter without becoming tautological.
    expect(delta).toBeLessThan(EXPECTED_PROBE_COOLDOWN_MS + 5_000);

    // ----- in-memory return value -------------------------------------
    // With no prior snapshot on disk, the fallback path returns
    // FALLBACK_CONNECTORS (>= the canonical 6 entries). The exact
    // shape is the responsibility of `connectors-pure`; here we only
    // assert "non-empty, is an array" so this test stays focused on
    // the timeout-write contract.
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    // ----- public helper reads back the same diagnostic ----------------
    const probeError = getLastProbeError();
    expect(probeError).not.toBeNull();
    expect(probeError?.kind).toBe("timeout");
    expect(probeError?.message).toMatch(
      new RegExp(String(EXPECTED_PROBE_TIMEOUT_MS)),
    );
  });

  it("the cooldown marker survives a subsequent probe failure until clearProbeCooldown is called", async () => {
    // Pin the interaction between the timeout-path's cooldown marker
    // and a *later* attempt: a rapid re-open within the cooldown
    // window must short-circuit to cache / FALLBACK and NOT fire
    // another agent probe. Once `clearProbeCooldown` runs, the marker
    // is dropped (but the `lastProbeError` diagnostic stays — that's
    // only cleared by a successful probe via `writeConnectorSnapshot`).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // First call — times out, writes cooldown + lastProbeError.
    const first = refreshConnectors({ silent: true });
    await vi.advanceTimersByTimeAsync(EXPECTED_PROBE_TIMEOUT_MS + 100);
    await first;

    // Cooldown is active now. The hang mock will keep hanging, but
    // `refreshConnectors` should bypass the probe entirely.
    const second = refreshConnectors({ silent: true });
    // No timer advance — the second call must NOT have set a new
    // timeout, so it should resolve synchronously (the cache path).
    const result = await second;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    // The cooldown marker must still be on disk.
    const raw = JSON.parse(readFileSync(CONNECTORS_PATH, "utf8"));
    expect(typeof raw.probeCooldownUntil).toBe("string");
    expect(raw.lastProbeError?.kind).toBe("timeout");

    // Clearing the cooldown drops the marker but preserves the
    // `lastProbeError` diagnostic — that's how a fresh probe failure
    // can still surface even after an admin clears a stale cooldown.
    clearProbeCooldown();
    const afterClear = JSON.parse(readFileSync(CONNECTORS_PATH, "utf8"));
    expect(afterClear.probeCooldownUntil).toBeUndefined();
    expect(afterClear.lastProbeError?.kind).toBe("timeout");
  });

  it("a pre-existing cache file is preserved — only the diagnostic + marker are appended", async () => {
    // The cooldown / error writers follow the "preserve the existing
    // snapshot, append one field" policy from `writeProbeCooldownMarker`
    // — the same shape the loop's tick-side `writeConnectorSnapshot`
    // produces. This test pins that contract: a stale-but-known-good
    // cache must survive a probe timeout so the UI can keep showing
    // the last-known connector state.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // Seed a cache with a known snapshot that predates the timeout
    // (#411: the cache TTL is now 30s, so 5s old is comfortably
    // within validity and still meaningfully "predates" the probe
    // call we're about to make).
    const seededFetchedAt = new Date(Date.now() - 5 * 1000).toISOString();
    const seededConnectors = [
      {
        id: "gmail",
        label: "Gmail",
        connected: true,
        accountCount: 1,
        probed: true,
        fetchedAt: seededFetchedAt,
      },
    ];
    writeFileSync(
      CONNECTORS_PATH,
      JSON.stringify(
        {
          fetchedAt: seededFetchedAt,
          connectors: seededConnectors,
        },
        null,
        2,
      ),
    );

    const promise = refreshConnectors({ silent: true });
    await vi.advanceTimersByTimeAsync(EXPECTED_PROBE_TIMEOUT_MS + 100);
    const result = await promise;

    // Snapshot was preserved.
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gmail", connected: true }),
      ]),
    );

    // Cache file retains the seeded snapshot + the new diagnostic +
    // cooldown marker.
    const raw = JSON.parse(readFileSync(CONNECTORS_PATH, "utf8"));
    expect(raw.fetchedAt).toBe(seededFetchedAt);
    expect(raw.connectors).toHaveLength(1);
    expect(raw.connectors[0].id).toBe("gmail");
    expect(raw.lastProbeError?.kind).toBe("timeout");
    expect(typeof raw.probeCooldownUntil).toBe("string");
  });
});
