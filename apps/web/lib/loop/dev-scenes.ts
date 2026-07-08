/**
 * Loop dev-scenes — 8 demo forms from the aha-moment deck, expressible as
 * concrete `LoopDecision` payloads the watcher's natural flow can pick up
 * and surface to the pet's bubble + card.
 *
 * Each form corresponds to one slide in
 * `/Users/timi/Downloads/openloomi-aha-moment-demo/index.html`:
 *   1. connection-check  · endpoints online, starting to judge
 *   2. judgment-system   · see signal → read state → triage attention → wait for approval
 *   3. noise-reduction   · invalid info, doesn't enter your attention
 *   4. low-priority-todo · low priority to queue, high priority to wake
 *   5. decision-briefing · high priority appears immediately, but not as an empty reminder
 *   6. morning-brief     · good morning: news + today's todo
 *   7. night-wrap        · today's wins + tomorrow's plan
 *   8. proactive-cases   · produce 6 typed decisions in one run
 *
 * Forms 4–8 map 1:1 to existing `DecisionType`s and are wired through
 * `store::decisions.add()` — the watcher picks them up on its next 2s
 * poll and they reach the pet's bubble + card UI unchanged.
 *
 * Forms 1–3 describe pipeline states that the pet UI doesn't separately
 * visualise yet (it shows the *result* of the pipeline, not the stages).
 * We surface them by emitting a descriptive loop:state hint + a transient
 * caption via the same watcher channel, keeping the dev panel useful
 * without building the per-form UI the deck demands.
 *
 * The 8 entries are the single source of truth for the dev panel buttons
 * and the POST /api/loop/dev/scene endpoint. Keep them tiny, plain JS, no
 * env / fs access — testing + reuse should be free.
 */

import type { DecisionType, LoopAction, LoopDecision } from "./types";

export type SceneKey =
  | "connection-check"
  | "judgment-system"
  | "noise-reduction"
  | "low-priority-todo"
  | "decision-briefing"
  | "morning-brief"
  | "night-wrap"
  | "proactive-cases";

/**
 * Pet states the dev panel can hint the pet into. Mirrors the keys
 * `watcher::map_state_to_pet` emits and `loomi-widget.html` renders.
 * Kept as its own union (rather than coupled to `DecisionType`) so the
 * form-key → suggestion mapping stays readable.
 */
export type PetStateHint =
  | "idle"
  | "sleeping"
  | "sweeping"
  | "happy"
  | "juggling"
  | "needsinput"
  | "thinking"
  | "working"
  | "greet"
  | null;

export interface DevScene {
  key: SceneKey;
  /** Slide number, 1..8. */
  slide: number;
  /** Short UI label for the dev panel button. */
  label: string;
  /** What the slide actually depicts — used as a tooltip + caption. */
  caption: string;
  /** Which pet state (or `null` to leave untouched) the dev panel hints. */
  hintState: PetStateHint;
  /**
   * Build the decision(s) this scene wants in the pending bucket. Returns
   * 0+ payloads because some scenes (proactive-cases) want multiple
   * decisions at once. The dev endpoint persists them in order; the
   * watcher + bubble + card UI then render them naturally.
   */
  build(): LoopDecision[];
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function decision(input: {
  type: DecisionType;
  title: string;
  action: LoopAction;
  dialogue: string;
  nextStep: string;
  confidence: number;
  context?: LoopDecision["context"];
  source?: LoopDecision["source_signal"];
  needsUser?: boolean;
}): LoopDecision {
  return {
    id: uid("dec_dev"),
    ts: nowIso(),
    status: "pending",
    type: input.type,
    title: input.title,
    action: input.action,
    dialogue: input.dialogue,
    nextStep: input.nextStep,
    confidence: input.confidence,
    ...(input.context ? { context: input.context } : {}),
    ...(input.source ? { source_signal: input.source } : {}),
    ...(input.needsUser !== undefined ? { needs_user: input.needsUser } : {}),
  };
}

function todoDecision(): LoopDecision {
  // Form 4 demo: "Competitor launched a memory workspace beta" — a noisy
  // but low-priority signal the pet parks rather than wakes the user for.
  return decision({
    type: "todo",
    title: "Track: Competitor launched a memory workspace beta",
    action: {
      kind: "todo",
      params: {
        title: "Review competitor memory workspace beta",
        source: "manual:dev-scene",
      },
    },
    dialogue: "I'll queue this for later — urgent noise will still wake you.",
    nextStep:
      "Stays on the todo lane; urgent events keep their lane and will pop the bubble.",
    confidence: 0.62,
    context: {
      why: [
        "Low urgency — no decision blocking other work",
        "Already captured in obsidian note before lunch",
        "Matches the 'queue, don't wake' rule for p2 confidence",
      ],
      memory_refs: ["people/chris.md"],
    },
    source: {
      id: "sig_dev_lowtodo",
      ts: nowIso(),
      source: "manual",
      type: "obsidian_note_changed",
      payload: { path: "ideas/competitor_memory_beta.md" },
    },
  });
}

function highPriorityReplyDecision(): LoopDecision {
  // Form 5 demo: "Mira asks if security review can start today" — high-
  // priority draft_reply that lands as a p0 card with full context.
  return decision({
    type: "draft_reply",
    title: "Reply: Mira — security review can start today",
    action: {
      kind: "email_reply",
      params: {
        to: "mira@acme.dev",
        subject: "Re: Security review start date",
        threadId: "thr_dev_mira_security",
      },
    },
    dialogue:
      "High-priority reply — Mira is blocked on this and is in your 'fast reply' list.",
    nextStep:
      "Tap Run to send the prepared reply; Mirror-mode shows the draft first.",
    confidence: 0.92,
    needsUser: true,
    context: {
      person: "mira@acme.dev",
      why: [
        "Sender in your 'security-review' circle — fast-reply tier",
        "SSO roadmap question already drafted",
        "Thread mentions a 4pm UTC today hard deadline",
      ],
      memory_refs: ["people/mira.md", "insights/security_review_call.md"],
    },
    source: {
      id: "sig_dev_mira_security",
      ts: nowIso(),
      source: "gmail",
      type: "email",
      payload: {
        messageId: "msg_dev_mira_1",
        threadId: "thr_dev_mira_security",
        from: "mira@acme.dev",
        subject: "Security review start date",
        snippet:
          "Can we start the security review today? Need SSO on the roadmap.",
        labels: ["INBOX", "Important"],
        timestamp: nowIso(),
      },
    },
  });
}

function briefDecision(): LoopDecision {
  // Form 6 demo: "Good morning. Start here." — the morning brief as a card.
  return decision({
    type: "brief",
    title: "Morning brief — Good morning. Start here.",
    action: { kind: "brief", params: { source: "manual:dev-scene" } },
    dialogue:
      "Your morning brief is ready — news + today's todos, ranked by what matters.",
    nextStep:
      "Tap Open to see the full brief, or Dismiss to push it to the wrap.",
    confidence: 0.95,
    needsUser: true,
    context: {
      why: [
        "3 unread high-priority emails overnight",
        "2 calendar conflicts tomorrow morning",
        "1 PR waiting for your review",
      ],
      memory_refs: ["insights/morning_digest.md"],
    },
  });
}

function wrapDecision(): LoopDecision {
  // Form 7 demo: "Today wrapped. Tomorrow staged." — the night wrap card.
  return decision({
    type: "wrap",
    title: "Night wrap — Today wrapped. Tomorrow staged.",
    action: { kind: "wrap", params: { source: "manual:dev-scene" } },
    dialogue:
      "End of day: 4 decisions resolved, 1 dismissed, 2 carried to tomorrow.",
    nextStep:
      "Tap Open to see the wrap, or Dismiss to archive without reviewing.",
    confidence: 0.95,
    context: {
      why: [
        "4 done · 1 dismissed · 2 carried",
        "Tomorrow starts with the security review Mira is waiting on",
        "Brief was dismissed at 09:14 — re-prioritized in wrap",
      ],
      memory_refs: ["insights/eod_summary.md"],
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The 8 forms                                                                */
/* -------------------------------------------------------------------------- */

export const DEV_SCENES: Record<SceneKey, DevScene> = {
  "connection-check": {
    key: "connection-check",
    slide: 1,
    label: "Form 1 · Connection check",
    caption:
      "Three green lights: Slack, Email, WhatsApp all reachable. Pipeline can run.",
    hintState: "thinking",
    // No pending decision for this one — the pet stays in thinking while
    // the panel shows a 3-dot connector strip reading from
    // /api/loop/connectors. The watcher will see no change in decisions,
    // and the bubble stays in idle ("All clear") until the user moves on.
    build: () => [],
  },

  "judgment-system": {
    key: "judgment-system",
    slide: 2,
    label: "Form 2 · Judgment system",
    caption:
      "Pipeline: see signal → read state → triage attention → wait for approval before executing.",
    hintState: "thinking",
    build: () => [],
  },

  "noise-reduction": {
    key: "noise-reduction",
    slide: 3,
    label: "Form 3 · Noise reduction",
    caption:
      "Try-this-bundle, reminders from newsletters, digest previews — trashed before they land.",
    hintState: "sweeping",
    build: () => [],
  },

  "low-priority-todo": {
    key: "low-priority-todo",
    slide: 4,
    label: "Form 4 · Low-priority todo",
    caption:
      "Queued, not waking you. Urgent noise keeps its lane and will pop the bubble.",
    hintState: "thinking",
    build: () => [todoDecision()],
  },

  "decision-briefing": {
    key: "decision-briefing",
    slide: 5,
    label: "Form 5 · Decision briefing",
    caption:
      "High-priority reply lands as a p0 card with the draft, context, and confidence.",
    hintState: "needsinput",
    build: () => [highPriorityReplyDecision()],
  },

  "morning-brief": {
    key: "morning-brief",
    slide: 6,
    label: "Form 6 · Morning brief",
    caption:
      "News + today's todos, ranked by what matters. One tap to open the brief.",
    hintState: "needsinput",
    build: () => [briefDecision()],
  },

  "night-wrap": {
    key: "night-wrap",
    slide: 7,
    label: "Form 7 · Night wrap",
    caption:
      "Today's done + tomorrow staged. Carries queued items to the next morning brief.",
    hintState: "working",
    build: () => [wrapDecision()],
  },

  "proactive-cases": {
    key: "proactive-cases",
    slide: 8,
    label: "Form 8 · Proactive cases",
    caption:
      "One tick → six typed decisions: RSVP, reply, PR review, Slack reply, todo, plan.",
    hintState: "juggling",
    build: () => [
      // Calendar invite — RSVP card.
      decision({
        type: "rsvp",
        title: "RSVP — Security review kickoff (Wed 10:00)",
        action: {
          kind: "calendar_rsvp",
          params: {
            eventId: "evt_dev_security_kickoff",
            response: "accepted",
          },
        },
        dialogue:
          "Calendar invite needs a call — accept the security review kickoff?",
        nextStep: "Tap Run to accept, Dry Run to see the plan first.",
        confidence: 0.88,
        needsUser: true,
        context: {
          why: [
            "From your security-review circle",
            "Matches the 3-block-of-focus slot you keep",
          ],
        },
        source: {
          id: "sig_dev_rsvp",
          ts: nowIso(),
          source: "googlecalendar",
          type: "calendar_event",
          payload: {
            eventId: "evt_dev_security_kickoff",
            title: "Security review kickoff",
            start: nowIso(),
            organizer: "mira@acme.dev",
            my_response: "needsAction",
          },
        },
      }),
      // Customer email — draft_reply card.
      decision({
        type: "draft_reply",
        title: "Reply: Customer Q3 upgrade pricing question",
        action: {
          kind: "email_reply",
          params: {
            to: "cto@bigco.com",
            threadId: "thr_dev_bigco_q3",
          },
        },
        dialogue:
          "Customer email waiting on you — pricing follow-up, draft ready.",
        nextStep: "Tap Run to send, Dry Run to see the draft first.",
        confidence: 0.84,
        needsUser: true,
        context: {
          why: [
            "In your 'enterprise-priority' tier",
            "Draft references the Q3 pricing memo",
          ],
        },
        source: {
          id: "sig_dev_bigco",
          ts: nowIso(),
          source: "gmail",
          type: "email",
          payload: {
            messageId: "msg_dev_bigco_q3",
            threadId: "thr_dev_bigco_q3",
            from: "cto@bigco.com",
            subject: "Q3 upgrade pricing — when can we confirm?",
          },
        },
      }),
      // GitHub PR — review card.
      decision({
        type: "review_pr",
        title: "Review PR #482 — feat: bulk export to s3",
        action: {
          kind: "github_review",
          params: {
            repo: "openloomi/core",
            number: 482,
          },
        },
        dialogue: "PR is waiting for review — you've been tagged as reviewer.",
        nextStep: "Tap Run to have the agent produce a review checklist first.",
        confidence: 0.79,
        needsUser: true,
        context: {
          why: [
            "You're a requested reviewer on this PR",
            "Agent pre-read diff and flagged 2 risk hot spots",
          ],
        },
        source: {
          id: "sig_dev_pr482",
          ts: nowIso(),
          source: "github",
          type: "github_pr",
          payload: {
            repo: "openloomi/core",
            number: 482,
            title: "feat: bulk export to s3",
            state: "open",
            user_is_reviewer: true,
          },
        },
      }),
      // Slack thread — slack_reply card.
      decision({
        type: "slack_reply",
        title: "Reply in #frontend-shipping",
        action: {
          kind: "slack_reply",
          params: {
            channel: "frontend-shipping",
            ts: "1735000000.000100",
          },
        },
        dialogue: "@-mention in #frontend-shipping — context already pulled.",
        nextStep: "Tap Dry Run to draft a reply, then Run to send.",
        confidence: 0.81,
        needsUser: true,
        context: {
          why: ["Direct @-mention", "Thread already scanned by the agent"],
        },
        source: {
          id: "sig_dev_slack",
          ts: nowIso(),
          source: "slack",
          type: "slack_message",
          payload: {
            channel: "frontend-shipping",
            ts: "1735000000.000100",
            user: "lin",
            text: "@you can you double-check the bundle size?",
            mentions_me: true,
          },
        },
      }),
      // Messy note — todo lane.
      decision({
        type: "todo",
        title: "Pick up: triage the api-clients inbox",
        action: {
          kind: "todo",
          params: { title: "Triage api-clients inbox" },
        },
        dialogue:
          "Messy note — pinned for the morning, urgent noise still wins.",
        nextStep: "Tap Run to add to today's todo.",
        confidence: 0.6,
        context: {
          why: [
            "Source is an obsidian note flagged 'triage'",
            "Not blocking anyone — p2 lane",
          ],
        },
        source: {
          id: "sig_dev_todo",
          ts: nowIso(),
          source: "obsidian",
          type: "obsidian_note_changed",
          payload: { path: "inbox/api-clients.md" },
        },
      }),
      // Release plan — release_plan card.
      decision({
        type: "release_plan",
        title: "Plan needed: Q3 release rollout",
        action: {
          kind: "release_plan",
          params: { source_path: "plans/q3_release.md" },
        },
        dialogue:
          "Stale release plan — needs sign-off before next deploy window.",
        nextStep: "Tap Run to draft a PR/FAQ and queue approvals.",
        confidence: 0.74,
        context: {
          why: ["Last edit was 8 days ago", "Deploy window opens in 4 days"],
        },
        source: {
          id: "sig_dev_plan",
          ts: nowIso(),
          source: "obsidian",
          type: "obsidian_note_changed",
          payload: { path: "plans/q3_release.md" },
        },
      }),
      // Deadline reminder — deadline_reminder card.
      {
        id: "dec-deadline-demo-001",
        type: "deadline_reminder",
        title: "Deadline Fri 5:00 PM: Q3 OKR draft to leadership",
        action: {
          kind: "deadline_notify",
          params: {
            source: "email",
            sourceRef: { messageId: "msg-deadline-demo-001" },
            deadlineAt: "2026-07-10T17:00:00-07:00",
            message:
              "Please send the Q3 OKR draft to leadership by Friday 5pm.",
            notifyAt: "2026-07-10T16:00:00-07:00",
            channel: "calendar",
          },
        },
        source_signal: {
          id: "sig_dev_deadline",
          ts: nowIso(),
          source: "gmail",
          type: "email",
          payload: {
            messageId: "msg-deadline-demo-001",
            threadId: "thr_dev_deadline",
            from: "ceo@example.com",
            subject: "Q3 OKR draft — please send by Friday",
            snippet:
              "Please send the Q3 OKR draft to leadership by Friday 5pm.",
            _deadlineHint: {
              deadlineAt: "2026-07-10T17:00:00-07:00",
              message: "by Friday 5pm",
              notifyAt: "2026-07-10T16:00:00-07:00",
              confidence: 0.95,
            },
          },
        },
        context: {
          _origin: "manual",
          subject: "Q3 OKR draft — please send by Friday",
          from: "ceo@example.com",
          _deadlineHint: {
            deadlineAt: "2026-07-10T17:00:00-07:00",
            message: "by Friday 5pm",
            notifyAt: "2026-07-10T16:00:00-07:00",
            confidence: 0.95,
          },
        },
        ts: "2026-07-08T09:00:00-07:00",
        status: "pending",
      } as LoopDecision,
    ],
  },
};

export const DEV_SCENE_LIST: DevScene[] = (
  Object.keys(DEV_SCENES) as SceneKey[]
)
  .sort((a, b) => DEV_SCENES[a].slide - DEV_SCENES[b].slide)
  .map((k) => DEV_SCENES[k]);

/**
 * Look up a scene by key. Returns null for unknown keys so the API route
 * can return a clean 400 instead of an undefined deref.
 */
export function getScene(key: string): DevScene | null {
  if (Object.prototype.hasOwnProperty.call(DEV_SCENES, key)) {
    return DEV_SCENES[key as SceneKey];
  }
  return null;
}
