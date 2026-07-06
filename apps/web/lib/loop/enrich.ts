/**
 * Loop enrich — turn a freshly-classified decision into one that carries
 * real "why" / "memory refs" / "person" / "project" context, so the
 * decision card in the UI can show source-chain, context cards, and a
 * calibrated confidence score (the demo's "露出 context" / "判断依据" /
 * "confidence 0.85" requirements).
 *
 * Pipeline (per A2 in the stage plan):
 *   1. Build a natural-language query from the signal payload.
 *   2. Find a matching contact in `userContacts` (by email / handle).
 *   3. Find related insights (project / historical decision) via
 *      `searchInsightsSemantically` with a keyword-only fallback so the
 *      tick still works before the user has configured an embedding
 *      provider.
 *   4. Compute confidence from base + contact hit + project hit + history
 *      hit, capped at 0.9.
 *   5. Emit `why[]`, `memory_refs[]`, `person`, `project_ref`, and a
 *      source-chain snapshot the UI can render directly.
 *
 * This module is intentionally best-effort — every step is wrapped in
 * try/catch and the classifier's existing decision candidate is returned
 * unchanged on failure, so a memory outage can't break the tick.
 */

import { and, eq, ilike, or } from "drizzle-orm";
import { db, userContacts, insight } from "@/lib/db";
import { searchInsightsSemantically } from "@/lib/insights/search";
import type { InsightSemanticSearchResult } from "@/lib/insights/search";

import type { DecisionCandidate } from "./classify";
import type { LoopDecisionContext, LoopSignal } from "./types";

const MAX_INSIGHT_HITS = 5;
const MAX_WHY_ITEMS = 6;

/* -------------------------------------------------------------------------- */
/* Query construction                                                          */
/* -------------------------------------------------------------------------- */

interface QueryParts {
  query: string;
  senderEmail: string | null;
  senderName: string | null;
  subject: string;
  body: string;
  projectHint: string | null;
  hasDeadline: boolean;
  hasUrgentKeyword: boolean;
}

function buildQueryParts(signal: LoopSignal): QueryParts {
  const p = signal.payload as Record<string, unknown>;
  const subject = String(p.subject ?? p.title ?? "").trim();
  const body = String(p.snippet ?? p.body ?? p.text ?? "").trim();
  const senderEmail =
    typeof p.from === "string"
      ? p.from
      : p.from && typeof p.from === "object"
        ? String((p.from as { email?: string }).email ?? "")
        : null;
  const senderName =
    p.fromName != null
      ? String(p.fromName)
      : p.from && typeof p.from === "object"
        ? String((p.from as { name?: string }).name ?? "")
        : null;
  const lowerText = `${subject} ${body}`.toLowerCase();
  return {
    query: [subject, body].filter(Boolean).join(" ").slice(0, 800),
    senderEmail: senderEmail || null,
    senderName: senderName || null,
    subject,
    body,
    projectHint:
      typeof p.project === "string"
        ? p.project
        : typeof p.repo === "string"
          ? p.repo
          : null,
    hasDeadline:
      /(deadline|due|by (?:end of )?(?:day|week|friday|monday)|tomorrow|asap|eod)/i.test(
        `${subject} ${body}`,
      ),
    hasUrgentKeyword:
      /\b(urgent|asap|critical|blocker|blocked|launch|outage|p0)\b/i.test(
        lowerText,
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

interface ContactHit {
  contactId: string;
  contactName: string;
  botId: string;
  metadata: Record<string, unknown>;
}

async function findContact(
  userId: string,
  email: string | null,
  name: string | null,
): Promise<ContactHit | null> {
  if (!email && !name) return null;
  try {
    const conditions = [];
    if (email) conditions.push(ilike(userContacts.contactId, email));
    if (name) conditions.push(ilike(userContacts.contactName, name));
    if (conditions.length === 0) return null;
    const rows = await db
      .select({
        contactId: userContacts.contactId,
        contactName: userContacts.contactName,
        botId: userContacts.botId,
        metadata: userContacts.metadata,
      })
      .from(userContacts)
      .where(and(eq(userContacts.userId, userId), or(...conditions)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      contactId: row.contactId,
      contactName: row.contactName,
      botId: row.botId,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function findRelatedInsightsSemantic(
  userId: string,
  query: string,
): Promise<InsightSemanticSearchResult[]> {
  if (!query) return [];
  try {
    return await searchInsightsSemantically({
      userId,
      query,
      limit: MAX_INSIGHT_HITS,
      threshold: 0.6,
    });
  } catch {
    // No embedding provider configured, or the call failed — fall through
    // to the keyword path. We don't want to break the tick on this.
    return [];
  }
}

async function findRelatedInsightsKeyword(
  userId: string,
  parts: QueryParts,
): Promise<InsightSemanticSearchResult[]> {
  const needle = parts.subject.slice(0, 60) || parts.body.slice(0, 60);
  if (!needle) return [];
  try {
    const pat = `%${needle.replace(/[%_]/g, "")}%`;
    const rows = await db
      .select({
        id: insight.id,
        title: insight.title,
        description: insight.description,
        taskLabel: insight.taskLabel,
      })
      .from(insight)
      .where(
        and(
          eq(insight.userId, userId),
          or(ilike(insight.title, pat), ilike(insight.description, pat)),
        ),
      )
      .limit(MAX_INSIGHT_HITS);
    return rows.map(
      (r: {
        id: string;
        title: string | null;
        description: string | null;
        taskLabel: string | null;
      }) => ({
        type: "insight" as const,
        id: r.id,
        content: `${r.title}${r.description ? ` — ${r.description}` : ""}`,
        similarity: 0.5, // flat for keyword matches; UI can mark as "keyword"
        metadata: {
          botId: "",
          title: r.title ?? "",
          description: r.description ?? "",
          taskLabel: r.taskLabel ?? "",
          importance: "",
          urgency: "",
          platform: null,
          account: null,
          time: null,
          embeddingModel: "",
          embeddingDimensions: 0,
          contentHash: "",
        },
      }),
    );
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Confidence + source-chain                                                   */
/* -------------------------------------------------------------------------- */

function computeConfidence(input: {
  base: number;
  contact: ContactHit | null;
  insightHits: InsightSemanticSearchResult[];
  parts: QueryParts;
}): number {
  let score = input.base;
  if (input.contact) score += 0.08;
  if (input.insightHits.length > 0) score += 0.06;
  // High-priority signal shapes deserve a small bump.
  if (input.parts.hasDeadline) score += 0.04;
  if (input.parts.hasUrgentKeyword) score += 0.03;
  // Diminish marginal returns — but never go below the base.
  return Math.min(0.92, Math.max(input.base, score));
}

function pickProjectRef(
  hits: InsightSemanticSearchResult[],
): InsightSemanticSearchResult | null {
  // Prefer hits whose metadata says "project" or whose taskLabel looks
  // project-shaped ("project", "roadmap", "repo", "team"). For now we just
  // pick the top hit if any; the UI can swap this for a richer heuristic.
  if (hits.length === 0) return null;
  const ranked = [...hits].sort((a, b) => b.similarity - a.similarity);
  return ranked[0];
}

/* -------------------------------------------------------------------------- */
/* Public entry                                                                */
/* -------------------------------------------------------------------------- */

export interface EnrichInput {
  userId: string;
  signal: LoopSignal;
  candidate: DecisionCandidate;
  /** Optional confidence floor. Defaults to the classifier's 0.6. */
  baseConfidence?: number;
}

export interface EnrichOutput {
  /** Why-line bullets the UI shows in the briefing card. */
  why: string[];
  /** Insight ids the UI surfaces as "memory context" chips. */
  memoryRefs: string[];
  /** Resolved contact (if any). */
  person: ContactHit | null;
  /** Top related insight (used as project / history anchor). */
  projectRef: InsightSemanticSearchResult | null;
  /** Confidence score in [0, 1]. */
  confidence: number;
  /** All related insights the UI can render as a context list. */
  relatedInsights: InsightSemanticSearchResult[];
}

/**
 * Run enrichment for one signal. Best-effort: any failure returns a
 * minimal envelope so the caller can still persist the decision.
 */
export async function enrich(input: EnrichInput): Promise<EnrichOutput> {
  const baseConfidence = input.baseConfidence ?? 0.6;
  const parts = buildQueryParts(input.signal);
  const empty: EnrichOutput = {
    why: [`Source: ${input.signal.source}:${input.signal.type}`],
    memoryRefs: [],
    person: null,
    projectRef: null,
    confidence: baseConfidence,
    relatedInsights: [],
  };

  // No userId → can't enrich; return the minimum envelope.
  if (!input.userId) return empty;

  const [contact, semanticHits] = await Promise.all([
    findContact(input.userId, parts.senderEmail, parts.senderName),
    findRelatedInsightsSemantic(input.userId, parts.query),
  ]);

  // Fall back to keyword search when semantic returned nothing (no
  // embedding provider, no signal).
  const insightHits =
    semanticHits.length > 0
      ? semanticHits
      : await findRelatedInsightsKeyword(input.userId, parts);

  const projectRef = pickProjectRef(insightHits);
  const confidence = computeConfidence({
    base: baseConfidence,
    contact,
    insightHits,
    parts,
  });

  // Build the why-line bullets. Order matters — strongest evidence first.
  const why: string[] = [`Source: ${input.signal.source}:${input.signal.type}`];
  if (contact) {
    why.push(`Known contact: ${contact.contactName} <${contact.contactId}>`);
  }
  if (projectRef) {
    const projTitle = projectRef.metadata.title || projectRef.id;
    why.push(
      `Related project: ${projTitle} (sim ${projectRef.similarity.toFixed(2)})`,
    );
  }
  for (const h of insightHits.slice(0, MAX_WHY_ITEMS - why.length)) {
    if (h === projectRef) continue;
    const title = h.metadata.title || h.id;
    why.push(`Memory: ${title} (sim ${h.similarity.toFixed(2)})`);
    if (why.length >= MAX_WHY_ITEMS) break;
  }
  if (parts.hasDeadline) {
    why.push("Deadline keyword detected in subject/body");
  } else if (parts.hasUrgentKeyword) {
    why.push("Urgent keyword detected in subject/body");
  }

  return {
    why,
    memoryRefs: insightHits.map((h) => h.id),
    person: contact,
    projectRef,
    confidence,
    relatedInsights: insightHits,
  };
}

/**
 * Helper: turn an EnrichOutput into the context block we attach to a
 * LoopDecision. Pure function so the runner can call it without re-running
 * the search.
 */
export function enrichToContext(
  out: EnrichOutput,
): LoopDecisionContext & { source_chain: unknown } {
  return {
    why: out.why,
    memory_refs: out.memoryRefs,
    person: out.person?.contactId ?? null,
    project_ref: out.projectRef?.id ?? null,
    source_chain: {
      signal: {
        source: null, // filled by caller
        type: null,
        ts: null,
      },
      person: out.person
        ? {
            id: out.person.contactId,
            name: out.person.contactName,
            botId: out.person.botId,
          }
        : null,
      project: out.projectRef
        ? {
            id: out.projectRef.id,
            title: out.projectRef.metadata.title,
            similarity: out.projectRef.similarity,
          }
        : null,
      timing: { has_deadline: false, has_urgent_keyword: false }, // filled by caller
      priority: derivePriority(out),
      related: out.relatedInsights.map((h) => ({
        id: h.id,
        title: h.metadata.title,
        similarity: h.similarity,
      })),
    },
  } satisfies LoopDecisionContext & { source_chain: unknown };
}

function derivePriority(out: EnrichOutput): "P0" | "P1" | "P2" {
  if (out.confidence >= 0.85) return "P0";
  if (out.confidence >= 0.75) return "P1";
  return "P2";
}

/** Convenience: produce a single LoopDecisionContext from a signal. */
export async function buildDecisionContext(
  input: EnrichInput,
): Promise<LoopDecisionContext & { source_chain: unknown }> {
  const out = await enrich(input);
  return enrichToContext(out);
}
