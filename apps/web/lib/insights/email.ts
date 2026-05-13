import type { ExtractEmailInfo } from "../integrations/email";
import type { DetailData, TimelineData } from "@/lib/ai/subagents/insights";
import type { GeneratedInsightPayload } from "@/lib/insights/transform";
import { EMAIL_TASK_LABEL } from "./constants";
import type { InsightTaskItem } from "@openloomi/insights";
import {
  classifyEmail,
  extractTopKeywords,
} from "../integrations/email/classifier";

const NO_REPLY_ADDRESS_RE =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|notifications?)@/i;

const NO_REPLY_CONTENT_PATTERNS = [
  /\bdo not reply\b/i,
  /\bno reply needed\b/i,
  /\bno action needed\b/i,
  /\bfor your information\b/i,
  /\bfyi\b/i,
  /please do not reply/iu,
  /no reply needed/iu,
  /for your reference/iu,
  /auto reply/iu,
  /auto notification/iu,
] as const;

const REPLY_SIGNAL_PATTERNS = [
  /\?/u,
  /？/u,
  /\bplease reply\b/i,
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bwould you\b/i,
  /\blet me know\b/i,
  /\bplease confirm\b/i,
  /\bneed your response\b/i,
  /\bawaiting your response\b/i,
  /\baction required\b/i,
  /please reply/iu,
  /please confirm/iu,
  /may I ask/iu,
  /kindly/iu,
  /could you please/iu,
  /trouble/iu,
] as const;

type EmailActionSignals = Pick<
  GeneratedInsightPayload,
  "waitingForMe" | "actionRequired" | "actionRequiredDetails" | "isUnreplied"
>;

/**
 * Build email detail content (for LLM + frontend Markdown rendering)
 * Returns { content, originalContent }:
 *   content       —— Markdown body, for AI reading and default display
 *   originalContent —— Uncleaned raw HTML, for info source tab to display email original
 */
export function buildEmailDetailContent(
  email: ExtractEmailInfo,
  senderName: string,
  senderEmail: string,
): { content: string; originalContent?: string } {
  const headerLines: string[] = [];
  if (email.subject && email.subject.trim().length > 0) {
    headerLines.push(`**Subject:** ${email.subject.trim()}`);
  }
  headerLines.push(`**From:** ${senderName} <${senderEmail}>`);
  if (email.cc && email.cc.length > 0) {
    headerLines.push(`**Cc:** ${formatEmailAddresses(email.cc)}`);
  }
  if (email.bcc && email.bcc.length > 0) {
    headerLines.push(`**Bcc:** ${formatEmailAddresses(email.bcc)}`);
  }

  const headerBlock = headerLines.join("\n");

  // Prioritize using uncleaned raw HTML for info source tab display, fallback to cleaned html
  const htmlBody = email.html?.trim();
  const originalContent = email.rawHtml?.trim() || htmlBody || undefined;

  // Prioritize using Markdown (cleaned email body)
  const markdownBody = email.text?.trim();
  if (markdownBody) {
    return {
      content: `${headerBlock}\n\n---\n\n${markdownBody}`,
      originalContent,
    };
  }

  // Fallback to simplified HTML when Markdown is empty
  if (htmlBody) {
    return { content: `${headerBlock}\n\n---\n\n${htmlBody}`, originalContent };
  }

  // Final fallback to snippet
  if (email.snippet) {
    return {
      content: `${headerBlock}\n\n---\n\n${email.snippet}`,
      originalContent,
    };
  }

  return { content: headerBlock, originalContent };
}

export function formatEmailAddresses(
  entries: Array<{ name: string; email: string }>,
) {
  return entries
    .map((entry) => {
      if (entry.name?.trim()) {
        return `${entry.name.trim()} <${entry.email}>`;
      }
      return entry.email;
    })
    .filter(Boolean)
    .join(", ");
}

export function collectEmailParticipants(email: ExtractEmailInfo): string[] {
  const participants = new Set<string>();
  const pushEntry = (entry?: { name?: string; email?: string }) => {
    if (!entry) return;
    const label = entry.name?.trim() || entry.email?.trim();
    if (label) {
      participants.add(label);
    }
  };
  pushEntry(email.from);
  email.cc?.forEach((contact) => pushEntry(contact));
  email.bcc?.forEach((contact) => pushEntry(contact));
  return Array.from(participants);
}

function normalizeEmailText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function buildEmailReplyTaskTitle(email: ExtractEmailInfo): string {
  const sender =
    normalizeEmailText(email.from.name) ||
    normalizeEmailText(email.from.email) ||
    "Unknown sender";
  return `Reply to ${sender}'s email`;
}

function buildEmailReplyContext(email: ExtractEmailInfo): string {
  const subject = normalizeEmailText(email.subject);
  const snippet = normalizeEmailText(email.snippet || email.text);
  if (subject && snippet) {
    return `Email subject: ${subject}. The latest email mentioned: ${snippet}`;
  }
  if (subject) {
    return `Email subject: ${subject}.`;
  }
  if (snippet) {
    return `The latest email mentioned: ${snippet}`;
  }
  return "This email needs a reply.";
}

function buildEmailReplyDraftHint(email: ExtractEmailInfo): string {
  const subject = normalizeEmailText(email.subject);
  const snippet = normalizeEmailText(email.snippet || email.text);
  if (subject && snippet) {
    return `Please reply regarding "${subject}", focusing on: ${snippet}`;
  }
  if (subject) {
    return `Please reply regarding "${subject}".`;
  }
  if (snippet) {
    return `Please reply based on this email: ${snippet}`;
  }
  return "Please reply to this email.";
}

function inferEmailActionSignals(
  email: ExtractEmailInfo,
  accountEmail: string | null,
): EmailActionSignals {
  const senderEmail = normalizeEmailText(email.from.email).toLowerCase();
  const account = normalizeEmailText(accountEmail).toLowerCase();
  const combined = `${normalizeEmailText(email.subject)} ${normalizeEmailText(email.text)}`;
  const lowerCombined = combined.toLowerCase();

  if (!senderEmail) {
    return {
      waitingForMe: null,
      actionRequired: false,
      actionRequiredDetails: null,
      isUnreplied: false,
    };
  }

  if (
    (account && senderEmail === account) ||
    NO_REPLY_ADDRESS_RE.test(senderEmail) ||
    NO_REPLY_CONTENT_PATTERNS.some((pattern) => pattern.test(combined))
  ) {
    return {
      waitingForMe: null,
      actionRequired: false,
      actionRequiredDetails: null,
      isUnreplied: false,
    };
  }

  const hasReplySignal = REPLY_SIGNAL_PATTERNS.some((pattern) =>
    pattern.test(combined),
  );
  const hasQuestionSignal =
    lowerCombined.includes("question") ||
    lowerCombined.includes("inquiry") ||
    combined.includes("？") ||
    combined.includes("?");

  if (!hasReplySignal && !hasQuestionSignal) {
    return {
      waitingForMe: null,
      actionRequired: false,
      actionRequiredDetails: null,
      isUnreplied: false,
    };
  }

  const sender =
    normalizeEmailText(email.from.name) || normalizeEmailText(email.from.email);
  const title = buildEmailReplyTaskTitle(email);
  const task: InsightTaskItem = {
    id: `reply:${email.uid}`,
    title,
    context: buildEmailReplyContext(email),
    requester: sender || null,
    requesterId: senderEmail,
    responder: accountEmail ?? null,
    responderId: accountEmail ?? null,
    priority:
      lowerCombined.includes("urgent") ||
      lowerCombined.includes("asap") ||
      lowerCombined.includes("as soon as possible") ||
      lowerCombined.includes("today")
        ? "high"
        : null,
    status: "pending",
    sourceDetailIds: null,
    from: senderEmail,
    subject: normalizeEmailText(email.subject) || null,
    replyDraft: buildEmailReplyDraftHint(email),
  };

  return {
    waitingForMe: [task],
    actionRequired: true,
    actionRequiredDetails: {
      who: sender || null,
      what: title,
      when: null,
    },
    isUnreplied: true,
  };
}

/**
 * Truncate email subject, keep it concise
 */
export function truncateSubject(subject: string, maxLength = 30): string {
  if (subject.length <= maxLength) {
    return subject;
  }
  return `${subject.substring(0, maxLength).trim()}...`;
}

/**
 * Build merged email description with summaries of 2-3 most recent emails
 */
export function buildMergedEmailDescription(
  recentEmails: ExtractEmailInfo[],
  senderName: string,
  totalCount: number,
): string {
  if (recentEmails.length === 0) {
    return `${totalCount} emails from ${senderName}`;
  }

  const parts: string[] = [];

  // Process each email summary
  for (const email of recentEmails) {
    const subject = email.subject?.trim() || "No subject";
    const snippet = email.snippet?.trim() || "";

    // If snippet exists, truncate to first 80 characters
    const summary =
      snippet.length > 0
        ? snippet.substring(0, 80).trim() + (snippet.length > 80 ? "..." : "")
        : "";

    parts.push(`"${subject}"${summary ? `: ${summary}` : ""}`);
  }

  // Single email: simple description
  if (recentEmails.length === 1) {
    return `${totalCount} emails from ${senderName}. Latest: ${parts[0]}`;
  }

  // Multiple emails: list summaries
  const intro = `${totalCount} emails from ${senderName}. Recent: `;
  const emailSummaries = parts.join("; ");
  return `${intro}${emailSummaries}`;
}

export function buildEmailInsightPayload({
  email,
  accountEmail,
}: {
  email: ExtractEmailInfo;
  accountEmail: string | null;
}): GeneratedInsightPayload {
  const sentAt = Number.isFinite(email.timestamp)
    ? new Date(email.timestamp * 1000)
    : new Date();
  const senderName = email.from.name?.trim() || email.from.email || "Unknown";
  const senderEmail = email.from.email || "unknown@example.com";
  // description uses email subject as brief summary, not snippet
  // snippet will be placed in detail.content as email body
  const description = email.subject?.trim() || `Email from ${senderName}`;
  const { content: detailContent, originalContent: detailOriginal } =
    buildEmailDetailContent(email, senderName, senderEmail);
  const detail: DetailData = {
    time: email.timestamp ?? Math.floor(sentAt.getTime() / 1000),
    person: senderName,
    platform: "gmail",
    channel: senderEmail,
    content: detailContent,
    originalContent: detailOriginal,
    attachments:
      Array.isArray(email.attachments) && email.attachments.length > 0
        ? email.attachments
        : undefined,
  };

  // Apply zero-cost classification (Gmail labels + content rules)
  const classification = classifyEmail(email);
  const keywords = extractTopKeywords(email, 5);
  const actionSignals = inferEmailActionSignals(email, accountEmail);

  // Fallback to title if keywords are empty (ensures title content is searchable via keywords)
  const finalKeywords =
    keywords.length > 0
      ? keywords
      : email.subject?.trim()
        ? [email.subject.trim()]
        : [];

  // Filter categories: remove empty strings and strings with only whitespace
  const filterCategories = (cats: string[]): string[] => {
    return cats
      .filter((cat): cat is string => typeof cat === "string")
      .map((cat) => cat.trim())
      .filter((cat) => cat.length > 0);
  };
  const filteredCategories = filterCategories(classification.categories || []);

  const timeline: TimelineData[] = [
    {
      time: email.timestamp ?? Math.floor(sentAt.getTime() / 1000),
      summary: email.subject?.trim() || `Email from ${senderName}`,
      label: `${senderName} - ${senderEmail}`,
    },
  ];

  return {
    dedupeKey: `gmail:sender:${senderEmail}`,
    taskLabel: EMAIL_TASK_LABEL,
    title:
      email.subject && email.subject.trim().length > 0
        ? email.subject.trim()
        : `Email from ${senderName}`,
    description,
    importance: classification.importance,
    urgency: classification.urgency,
    platform: "gmail",
    account: accountEmail,
    people: collectEmailParticipants(email),
    time: sentAt,
    details: [detail],
    timeline,
    historySummary: null,
    categories: filteredCategories.length > 0 ? filteredCategories : undefined,
    topKeywords: finalKeywords.length > 0 ? finalKeywords : undefined,
    waitingForMe: actionSignals.waitingForMe,
    actionRequired: actionSignals.actionRequired,
    actionRequiredDetails: actionSignals.actionRequiredDetails,
    isUnreplied: actionSignals.isUnreplied,
  };
}

/**
 * Group emails by sender email
 */
export function groupEmailsBySender(
  emails: ExtractEmailInfo[],
): Map<string, ExtractEmailInfo[]> {
  const groups = new Map<string, ExtractEmailInfo[]>();

  for (const email of emails) {
    const senderKey = email.from.email.toLowerCase().trim();
    if (!groups.has(senderKey)) {
      groups.set(senderKey, []);
    }
    const group = groups.get(senderKey);
    if (group) {
      group.push(email);
    }
  }

  return groups;
}

/**
 * Extract sender information from historical email insights
 * Returns Map<senderEmail, Array<detail>>
 */
export function extractHistoricalEmailsBySender(
  historicalPayloads: GeneratedInsightPayload[],
): Map<string, DetailData[]> {
  const senderMap = new Map<string, DetailData[]>();

  for (const payload of historicalPayloads) {
    // Only process email-type insights
    if (payload.taskLabel !== EMAIL_TASK_LABEL || !payload.details) {
      continue;
    }

    // Extract sender email from details (channel field stores sender email)
    for (const detail of payload.details) {
      const senderEmail = detail.channel?.toLowerCase().trim();
      if (senderEmail) {
        if (!senderMap.has(senderEmail)) {
          senderMap.set(senderEmail, []);
        }
        const group = senderMap.get(senderEmail);
        if (group) {
          group.push(detail);
        }
      }
    }
  }

  return senderMap;
}

/**
 * Build merged email Insight Payload
 * Merge multiple emails from the same sender into one Insight
 * @param emails - Newly fetched email list
 * @param accountEmail - Account email
 * @param historicalDetails - Historical email details (optional)
 */
export function buildMergedEmailInsightPayload({
  emails,
  accountEmail,
  historicalDetails,
}: {
  emails: ExtractEmailInfo[];
  accountEmail: string | null;
  historicalDetails?: DetailData[];
}): GeneratedInsightPayload {
  // Sort by time, use the latest as the main email
  const sortedEmails = [...emails].sort((a, b) => b.timestamp - a.timestamp);
  const latestEmail = sortedEmails[0];

  const sentAt = Number.isFinite(latestEmail.timestamp)
    ? new Date(latestEmail.timestamp * 1000)
    : new Date();
  const senderName =
    latestEmail.from.name?.trim() || latestEmail.from.email || "Unknown";

  // Merge historical details and new email details
  const allDetails: DetailData[] = [];

  // First add historical details (if any)
  if (historicalDetails && historicalDetails.length > 0) {
    // Sort historical details by time (old to new)
    const sortedHistorical = [...historicalDetails].sort(
      (a, b) => (a.time ?? 0) - (b.time ?? 0),
    );
    allDetails.push(...sortedHistorical);
  }

  // Then add new email details
  for (const email of sortedEmails) {
    const { content: detailContent, originalContent: detailOriginal } =
      buildEmailDetailContent(
        email,
        email.from.name?.trim() || email.from.email,
        email.from.email,
      );
    allDetails.push({
      time: email.timestamp ?? Math.floor(sentAt.getTime() / 1000),
      person: email.from.name?.trim() || email.from.email,
      platform: "gmail",
      channel: email.from.email,
      content: detailContent,
      originalContent: detailOriginal,
      attachments:
        Array.isArray(email.attachments) && email.attachments.length > 0
          ? email.attachments
          : undefined,
    });
  }

  // Merge all participants, deduplicate
  const allPeople = new Set<string>();
  for (const email of sortedEmails) {
    collectEmailParticipants(email).forEach((p) => allPeople.add(p));
  }
  // Also extract participants from historical details
  if (historicalDetails) {
    for (const detail of historicalDetails) {
      if (detail.person) {
        allPeople.add(detail.person);
      }
    }
  }

  // Calculate total email count (historical + new)
  const historicalCount = historicalDetails?.length ?? 0;
  const totalCount = historicalCount + sortedEmails.length;

  // Get 2-3 most recent emails for better title and description
  const recentEmails = sortedEmails.slice(0, 3);

  // Generate title: sender + subject (or first meaningful subject) + email count
  const primarySubject = recentEmails[0].subject?.trim() || "Email";
  const title = `${senderName} - ${truncateSubject(primarySubject)} (${totalCount} emails)`;

  // Generate description with summaries of 2-3 most recent emails
  const description = buildMergedEmailDescription(
    recentEmails,
    senderName,
    totalCount,
  );

  // Apply zero-cost classification (Gmail labels + content rules)
  // Filter categories: remove empty strings and strings with only whitespace
  const filterCategories = (cats: string[]): string[] => {
    return cats
      .filter((cat): cat is string => typeof cat === "string")
      .map((cat) => cat.trim())
      .filter((cat) => cat.length > 0);
  };

  // Merge all email categories and keywords
  const allCategories = new Set<string>();
  const allKeywords = new Set<string>();

  for (const email of sortedEmails) {
    const classification = classifyEmail(email);
    const filteredCats = filterCategories(classification.categories || []);
    filteredCats.forEach((cat: string) => allCategories.add(cat));
    const keywords = extractTopKeywords(email, 5);
    keywords.forEach((kw: string) => allKeywords.add(kw));
  }
  const latestClassification = classifyEmail(latestEmail);
  const actionSignals = inferEmailActionSignals(latestEmail, accountEmail);

  // Fallback to primary subject if keywords are empty (ensures title content is searchable via keywords)
  if (allKeywords.size === 0 && primarySubject) {
    allKeywords.add(primarySubject);
  }

  // Generate merged dedupeKey (using sender email)
  const senderEmail = latestEmail.from.email || "unknown@example.com";
  const dedupeKey = `gmail:sender:${senderEmail}:merged`;

  return {
    dedupeKey,
    taskLabel: EMAIL_TASK_LABEL,
    title,
    description,
    importance: latestClassification.importance,
    urgency: latestClassification.urgency,
    platform: "gmail",
    account: accountEmail,
    people: Array.from(allPeople),
    time: sentAt,
    details: allDetails,
    timeline: sortedEmails.map((email) => {
      const emailSenderName =
        email.from.name?.trim() || email.from.email || "Unknown";
      return {
        time: email.timestamp ?? Math.floor(sentAt.getTime() / 1000),
        summary: email.subject?.trim() || `Email from ${emailSenderName}`,
        label: `${emailSenderName} - ${email.from.email}`,
      };
    }),
    historySummary: null,
    categories: allCategories.size > 0 ? Array.from(allCategories) : undefined,
    topKeywords:
      allKeywords.size > 0 ? Array.from(allKeywords).slice(0, 10) : undefined,
    waitingForMe: actionSignals.waitingForMe,
    actionRequired: actionSignals.actionRequired,
    actionRequiredDetails: actionSignals.actionRequiredDetails,
    isUnreplied: actionSignals.isUnreplied,
  };
}
