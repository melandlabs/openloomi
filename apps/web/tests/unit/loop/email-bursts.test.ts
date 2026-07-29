/**
 * SP-3 — email burst aggregator regression tests.
 *
 * Mirrors `github-notifications.test.ts` deliberately. Pins:
 *   - canonical-key derivation prefers `messageId`, falls back to
 *     `threadId:from`, then `from:subject`;
 *   - cross-source dedupe collapses `gmail` / `email` records of the
 *     same message to one item;
 *   - sender extraction lowercases + strips display name;
 *   - aggregation threshold: >= 5 emails in <= 15 min from the same
 *     sender → digest. Below threshold, the per-signal path wins.
 *   - aggregator excludes threadIds already covered by a typed
 *     `email_reply` decision or a prior pending digest;
 *   - aggregator merges new items into an existing pending digest
 *     instead of creating a second summary card;
 *   - bounded digest caps at MAX_EMAIL_BURST_ITEMS items.
 *   - `unknown` decisions are NEVER treated as having already
 *     summarized emails (otherwise they'd suppress the digest they
 *     couldn't cover).
 */
import { describe, expect, it } from "vitest";
import {
  BURST_THRESHOLD,
  EMAIL_BURSTS_MODULE,
  MAX_EMAIL_BURST_ITEMS,
  aggregateEmailBursts,
  buildEmailBurstDigest,
  collectCoveredEmailBurstKeys,
  emailBurstKey,
  findPendingEmailBurst,
  isEmailBurstDecision,
  isEmailBurstSignal,
  normalizeEmailBursts,
} from "@/lib/loop/email-bursts";
import type { LoopDecision, LoopSignal } from "@/lib/loop/types";

// Anchor all `now`-relative math at this point.
const NOW = new Date("2026-07-17T12:00:00.000Z").getTime();

function sig(
  id: string,
  payload: Record<string, unknown>,
  opts: {
    source?: "gmail" | "email";
    ts?: string;
  } = {},
): LoopSignal {
  return {
    id,
    ts: opts.ts ?? "2026-07-17T11:55:00.000Z",
    source: opts.source ?? "gmail",
    type: "email",
    payload,
  };
}

function typedDecision(
  source: LoopSignal,
  type: LoopDecision["type"] = "email_reply",
): LoopDecision {
  return {
    id: `dec_${source.id}`,
    ts: "2026-07-17T00:00:00.000Z",
    status: "pending",
    type,
    title: "typed",
    action: { kind: "email_reply", params: {} },
    source_signal: source,
  };
}

// ---------------------------------------------------------------------------
// Recognition + canonicalization
// ---------------------------------------------------------------------------

describe("isEmailBurstSignal", () => {
  it("accepts gmail + email sources with type email", () => {
    expect(isEmailBurstSignal(sig("s1", { from: "a@x.com" }))).toBe(true);
    expect(
      isEmailBurstSignal(sig("s2", { from: "a@x.com" }, { source: "email" })),
    ).toBe(true);
  });

  it("rejects wrong type / wrong source / null", () => {
    expect(isEmailBurstSignal(null)).toBe(false);
    expect(
      isEmailBurstSignal({
        id: "s3",
        ts: "x",
        source: "gmail",
        type: "calendar_event",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isEmailBurstSignal({
        id: "s4",
        ts: "x",
        source: "manual",
        type: "email",
        payload: {},
      }),
    ).toBe(false);
  });
});

describe("emailBurstKey", () => {
  it("prefers the messageId", () => {
    const k = emailBurstKey(
      sig("s1", { messageId: "msg_abc", from: "a@x.com" }),
    );
    expect(k).toBe("email:msg:msg_abc");
  });

  it("falls back to threadId + from when messageId missing", () => {
    const k = emailBurstKey(sig("s1", { threadId: "thr_1", from: "a@x.com" }));
    expect(k).toBe("email:thread:a@x.com:thr_1");
  });

  it("falls back to from + subject when messageId + threadId missing", () => {
    const k = emailBurstKey(
      sig("s1", { from: "a@x.com", subject: "Hi there" }),
    );
    expect(k).toBe("email:from-subject:a@x.com:hi there");
  });

  it("returns null when nothing usable is present", () => {
    expect(emailBurstKey(sig("s1", {}))).toBeNull();
  });
});

describe("normalizeEmailBursts", () => {
  it("collapses cross-source duplicates by canonical key", () => {
    const items = normalizeEmailBursts([
      sig(
        "s1",
        { messageId: "m1", from: "a@x.com", subject: "S" },
        { source: "gmail" },
      ),
      sig(
        "s2",
        { messageId: "m1", from: "a@x.com", subject: "S" },
        { source: "email" },
      ),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("email:msg:m1");
  });

  it("lower-cases the from address", () => {
    const items = normalizeEmailBursts([
      sig("s1", { from: "Alice@Example.COM", subject: "S" }),
    ]);
    expect(items[0].from).toBe("alice@example.com");
  });

  it("strips the display name from `from`", () => {
    const items = normalizeEmailBursts([
      sig("s1", { from: '"Alice" <alice@x.com>', subject: "S" }),
    ]);
    expect(items[0].from).toBe("alice@x.com");
    expect(items[0].fromName).toBe("Alice");
  });

  it("ignores signals that are not email typed", () => {
    const items = normalizeEmailBursts([
      {
        id: "s1",
        ts: "2026-07-17T11:55:00.000Z",
        source: "gmail",
        type: "calendar_event",
        payload: { from: "a@x.com" },
      },
    ]);
    expect(items).toHaveLength(0);
  });

  it("skips signals with no canonical key", () => {
    const items = normalizeEmailBursts([sig("s1", { from: "" })]);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Digest recognition + covered-key collection
// ---------------------------------------------------------------------------

describe("isEmailBurstDecision + collectCoveredEmailBurstKeys", () => {
  it("identifies email_burst_digest decisions with the right module", () => {
    const dec = buildEmailBurstDigest("a@x.com", undefined, [
      {
        key: "email:msg:m1",
        from: "a@x.com",
        title: "S1",
        ts: "2026-07-17T11:50:00.000Z",
      },
    ]);
    expect(isEmailBurstDecision(dec)).toBe(true);
  });

  it("rejects other quiet_digest / unknown modules", () => {
    const other = {
      id: "x",
      ts: "x",
      status: "pending",
      type: "quiet_digest",
      title: "x",
      action: {
        kind: "quiet_digest",
        params: { module: "github-notifications" },
      },
    } as LoopDecision;
    expect(isEmailBurstDecision(other)).toBe(false);
  });

  it("collects burst_keys + threadIds from typed email_reply decisions", () => {
    const sig1 = sig("s1", {
      messageId: "m1",
      threadId: "thr1",
      from: "a@x.com",
    });
    const sig2 = sig("s2", {
      messageId: "m2",
      threadId: "thr2",
      from: "a@x.com",
    });
    const typed = typedDecision(sig1);
    const covered = collectCoveredEmailBurstKeys([typed]);
    const k1 = emailBurstKey(sig1);
    const k2 = emailBurstKey(sig2);
    if (!k1 || !k2) throw new Error("expected non-null keys");
    expect(covered.has(k1)).toBe(true);
    expect(covered.has(k2)).toBe(false);
  });

  it("does not treat unknown decisions as covered", () => {
    const sig1 = sig("s1", { messageId: "m1", from: "a@x.com" });
    const unknown: LoopDecision = {
      id: "u1",
      ts: "x",
      status: "pending",
      type: "unknown",
      title: "x",
      action: { kind: "noop", params: {} },
      source_signal: sig1,
    };
    const covered = collectCoveredEmailBurstKeys([unknown]);
    const k = emailBurstKey(sig1);
    if (!k) throw new Error("expected non-null key");
    expect(covered.has(k)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

describe("buildEmailBurstDigest", () => {
  it("produces a read-only email_burst_digest with bounded items", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      key: `k${i}`,
      from: "a@x.com",
      title: `S${i}`,
      ts: new Date(NOW - i * 60_000).toISOString(),
    }));
    const dec = buildEmailBurstDigest("a@x.com", "Alice", items);
    expect(dec.type).toBe("email_burst_digest");
    expect((dec.action.params as { module: string }).module).toBe(
      EMAIL_BURSTS_MODULE,
    );
    expect(dec.context?.count).toBe(MAX_EMAIL_BURST_ITEMS);
    expect((dec.context?.items as unknown[]).length).toBe(
      MAX_EMAIL_BURST_ITEMS,
    );
  });

  it("uses singular phrasing for one item", () => {
    const dec = buildEmailBurstDigest("a@x.com", undefined, [
      {
        key: "k1",
        from: "a@x.com",
        title: "S1",
        ts: "2026-07-17T11:50:00.000Z",
      },
    ]);
    expect(dec.title).toMatch(/^1 email from /);
    expect(dec.dialogue).toMatch(/^1 email from /);
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe("aggregateEmailBursts", () => {
  function fiveFromAlice(opts: { startMinAgo?: number } = {}): LoopSignal[] {
    const start = NOW - (opts.startMinAgo ?? 10) * 60_000;
    return Array.from({ length: BURST_THRESHOLD }, (_, i) => ({
      id: `sig_a_${i}`,
      ts: new Date(start + i * 30_000).toISOString(),
      source: "gmail",
      type: "email",
      payload: {
        messageId: `m_a_${i}`,
        threadId: "thr_alice",
        from: '"Alice" <alice@example.com>',
        subject: `Hello ${i}`,
        snippet: `Snippet ${i}`,
      },
    }));
  }

  it("returns noop when there are no email signals", () => {
    const res = aggregateEmailBursts({
      signals: [],
      decisions: [],
      now: NOW,
    });
    expect(res.kind).toBe("noop");
  });

  it("returns noop when fewer than BURST_THRESHOLD emails from one sender", () => {
    const res = aggregateEmailBursts({
      signals: fiveFromAlice().slice(0, BURST_THRESHOLD - 1),
      decisions: [],
      now: NOW,
    });
    expect(res.kind).toBe("noop");
  });

  it("creates a digest when BURST_THRESHOLD emails land in the window", () => {
    const res = aggregateEmailBursts({
      signals: fiveFromAlice(),
      decisions: [],
      now: NOW,
    });
    expect(res.kind).toBe("create");
    if (res.kind !== "create" || !res.decision) {
      throw new Error("expected create kind with non-null decision");
    }
    const digest = res.decision;
    expect(digest.type).toBe("email_burst_digest");
    expect(digest.title).toMatch(/^5 emails from /);
    expect((digest.context as { from: string }).from).toBe("alice@example.com");
    expect((digest.context as { fromName: string }).fromName).toBe("Alice");
    expect((digest.context as { count: number }).count).toBe(BURST_THRESHOLD);
    expect(res.newKeys).toHaveLength(BURST_THRESHOLD);
  });

  it("returns noop when the spread is wider than BURST_WINDOW_MS", () => {
    // 5 emails spread over 30 minutes (> 15 min window).
    const sigs = Array.from({ length: BURST_THRESHOLD }, (_, i) => ({
      id: `sig_spread_${i}`,
      ts: new Date(NOW - (30 - i * 6) * 60_000).toISOString(),
      source: "gmail",
      type: "email",
      payload: {
        messageId: `m_spread_${i}`,
        from: "a@x.com",
      },
    }));
    const res = aggregateEmailBursts({
      signals: sigs,
      decisions: [],
      now: NOW,
    });
    expect(res.kind).toBe("noop");
  });

  it("does not aggregate bursts across different senders in one tick", () => {
    // 5 from alice + 3 from bob → alice bursts; bob stays per-signal.
    const alice = fiveFromAlice();
    const bob = Array.from({ length: 3 }, (_, i) => ({
      id: `sig_b_${i}`,
      ts: new Date(NOW - 5 * 60_000 + i * 30_000).toISOString(),
      source: "gmail",
      type: "email",
      payload: {
        messageId: `m_b_${i}`,
        from: "bob@example.com",
      },
    }));
    const res = aggregateEmailBursts({
      signals: [...alice, ...bob],
      decisions: [],
      now: NOW,
    });
    expect(res.kind).toBe("create");
    if (res.kind !== "create" || !res.decision) {
      throw new Error("expected create kind with non-null decision");
    }
    expect(res.decision.title).toMatch(/alice/);
  });

  it("excludes keys already covered by a typed email_reply decision", () => {
    const sigs = fiveFromAlice();
    // First two are already covered by typed decisions.
    const typed = sigs.slice(0, 2).map((s) => typedDecision(s));
    const res = aggregateEmailBursts({
      signals: sigs,
      decisions: typed,
      now: NOW,
    });
    expect(res.kind).toBe("create");
    if (res.kind !== "create" || !res.decision) {
      throw new Error("expected create kind with non-null decision");
    }
    expect((res.decision.context as { count: number }).count).toBe(
      BURST_THRESHOLD - 2,
    );
    expect(res.newKeys).toHaveLength(BURST_THRESHOLD - 2);
  });

  it("merges new items into an existing pending digest", () => {
    const pending = buildEmailBurstDigest(
      "alice@example.com",
      "Alice",
      fiveFromAlice().map((s) => ({
        // biome-ignore lint/style/noNonNullAssertion: test fixture has valid keys
        key: emailBurstKey(s)!,
        from: "alice@example.com",
        title: "old",
        ts: s.ts,
      })),
      { ts: "2026-07-17T11:50:00.000Z" },
    );
    pending.status = "pending";
    // New batch — different messageIds, same sender, BURST_THRESHOLD
    // signals so `isBurst` qualifies them. The merge should add them
    // to the existing pending digest, not spawn a second card.
    const newSigs = Array.from({ length: BURST_THRESHOLD }, (_, i) => ({
      id: `sig_new_${i}`,
      ts: new Date(NOW - 5 * 60_000 + i * 30_000).toISOString(),
      source: "gmail",
      type: "email",
      payload: {
        messageId: `m_new_${i}`,
        from: "alice@example.com",
        subject: "fresh",
      },
    }));
    const res = aggregateEmailBursts({
      signals: newSigs,
      decisions: [pending],
      now: NOW,
    });
    expect(res.kind).toBe("merge");
    if (res.kind !== "merge" || !res.decision) {
      throw new Error("expected merge kind with non-null decision");
    }
    expect(res.decision.id).toBe(pending.id);
    expect((res.decision.context as { count: number }).count).toBe(
      BURST_THRESHOLD + BURST_THRESHOLD,
    );
  });

  it("returns noop when the existing digest already covers all new keys", () => {
    const sigs = fiveFromAlice();
    const pending = buildEmailBurstDigest(
      "alice@example.com",
      undefined,
      sigs.map((s) => ({
        // biome-ignore lint/style/noNonNullAssertion: test fixture has valid keys
        key: emailBurstKey(s)!,
        from: "alice@example.com",
        title: "old",
        ts: s.ts,
      })),
    );
    pending.status = "pending";
    const res = aggregateEmailBursts({
      signals: sigs, // same signals
      decisions: [pending],
      now: NOW,
    });
    expect(res.kind).toBe("noop");
  });
});

describe("findPendingEmailBurst", () => {
  it("finds the first pending email-burst digest", () => {
    const dec = buildEmailBurstDigest("a@x.com", undefined, [
      {
        key: "k1",
        from: "a@x.com",
        title: "S1",
        ts: NOW.toString(),
      },
    ]);
    dec.status = "pending";
    expect(findPendingEmailBurst([dec])).toBe(dec);
  });
  it("returns null when no pending burst exists", () => {
    expect(findPendingEmailBurst([])).toBeNull();
  });
});
