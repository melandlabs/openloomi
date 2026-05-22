/**
 * Zero-cost email classification based on Gmail native labels and content rules
 * No LLM calls - pure rule-based classification
 */

import type { ExtractEmailInfo } from ".";

export interface EmailClassification {
  importance: "high" | "medium" | "low";
  urgency: "high" | "medium" | "low";
  categories: string[];
  keywords: string[];
}

/**
 * Classify email using Gmail labels + content rules (zero LLM cost)
 */
export function classifyEmail(email: ExtractEmailInfo): EmailClassification {
  // Start with Gmail native labels
  const classification = applyGmailLabels(email);

  // Enhance with content-based rules
  const contentRules = applyContentRules(email);

  // Merge results (content rules override Gmail labels when both exist)
  // BUT: Prevent marketing/updates/social emails from getting boosted by content keywords
  const hasLowPriorityCategory =
    classification.categories.includes("Promotions") ||
    classification.categories.includes("Social") ||
    classification.categories.includes("Updates") ||
    classification.categories.includes("Spam");

  // If email is classified as low-priority category, force low importance/urgency
  if (hasLowPriorityCategory) {
    return {
      importance: "low",
      urgency: "low",
      categories: [
        ...new Set([
          ...classification.categories,
          ...(contentRules.categories || []),
        ]),
      ],
      keywords: [
        ...new Set([
          ...classification.keywords,
          ...(contentRules.keywords || []),
        ]),
      ],
    };
  }

  return {
    importance: (contentRules.importance || classification.importance) as
      | "high"
      | "medium"
      | "low",
    urgency: (contentRules.urgency || classification.urgency) as
      | "high"
      | "medium"
      | "low",
    categories: [
      ...new Set([
        ...classification.categories,
        ...(contentRules.categories || []),
      ]),
    ],
    keywords: [
      ...new Set([
        ...classification.keywords,
        ...(contentRules.keywords || []),
      ]),
    ],
  };
}

/**
 * Apply Gmail native labels (zero cost, already available)
 */
function applyGmailLabels(email: ExtractEmailInfo): EmailClassification {
  const labelIds = email.labelIds || [];
  const gmailCategory = email.gmailCategory;
  const priority = email.priority;

  // Default classification
  const result: EmailClassification = {
    importance: "medium",
    urgency: "low",
    categories: ["Email"],
    keywords: [],
  };

  // Check for special labels (Gmail OAuth only)
  const isImportant =
    labelIds.includes("IMPORTANT") || labelIds.includes("STARRED");
  const isInbox = labelIds.includes("INBOX");
  const isSpam = labelIds.includes("SPAM");
  // Support both Gmail OAuth (labelIds) and IMAP adapter (isSent field)
  const isSent = labelIds.includes("SENT") || email.isSent === true;
  const isTrash = labelIds.includes("TRASH");

  // If spam or trash, mark as low importance
  if (isSpam || isTrash) {
    result.importance = "low";
    result.urgency = "low";
    result.categories.push("Spam");
    return result;
  }

  // If sent, mark as low importance (your own emails)
  if (isSent) {
    result.importance = "low";
    result.urgency = "low";
    result.categories.push("Sent");
    return result;
  }

  // If starred or important, boost importance
  if (isImportant) {
    result.importance = "high";
    result.urgency = "medium";
    result.categories.push("Important");
  }

  // Apply priority header (works for both Gmail OAuth and EmailAdapter/IMAP)
  if (priority === "high") {
    result.importance = "high";
    result.urgency = "high";
  } else if (priority === "low") {
    result.importance = "low";
    result.urgency = "low";
  }

  // Apply Gmail categories (Gmail OAuth only)
  if (gmailCategory) {
    switch (gmailCategory) {
      case "promotions":
        result.importance = "low";
        result.urgency = "low";
        result.categories.push("Promotions");
        break;
      case "social":
        result.importance = "low";
        result.urgency = "low";
        result.categories.push("Social");
        break;
      case "updates":
        result.importance = "low";
        result.urgency = "low";
        result.categories.push("Updates");
        break;
      case "forums":
        result.importance = "medium";
        result.urgency = "low";
        result.categories.push("Forums");
        break;
      case "personal":
        result.importance = "medium";
        result.urgency = "medium";
        result.categories.push("Personal");
        break;
    }
  }

  // Check for label-based categories (Gmail OAuth only)
  if (labelIds.includes("CATEGORY_UPDATES")) {
    result.categories.push("Updates");
  }
  if (labelIds.includes("CATEGORY_FORUMS")) {
    result.categories.push("Forums");
  }
  if (labelIds.includes("CATEGORY_PROMOTIONS")) {
    result.categories.push("Promotions");
  }
  if (labelIds.includes("CATEGORY_SOCIAL")) {
    result.categories.push("Social");
  }

  return result;
}

/**
 * Apply content-based rules (keyword matching, pattern detection)
 */
function applyContentRules(
  email: ExtractEmailInfo,
): Partial<EmailClassification> {
  const result: Partial<EmailClassification> = {
    categories: [],
    keywords: [],
  };

  const subject = (email.subject || "").toLowerCase();
  const body = (email.text || "").toLowerCase();
  const combined = `${subject} ${body}`;

  // Finance/Invoice keywords
  const financeKeywords = [
    "invoice",
    "payment",
    "receipt",
    "billing",
    "paid",
    "refund",
    "transaction",
    "purchase",
    "order",
    "subscription",
    "renewal",
  ];
  if (financeKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Finance");
    result.importance = "high";
    result.urgency = "medium";
    const foundKeywords = financeKeywords.filter((kw) => combined.includes(kw));
    result.keywords?.push(...foundKeywords);
  }

  // Work/Meeting keywords
  const workKeywords = [
    "meeting",
    "deadline",
    "project",
    "report",
    "presentation",
    "review",
    "urgent",
    "asap",
    "action required",
    "please review",
  ];
  if (workKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Work");
    result.importance = result.importance || "high";
    result.urgency = result.urgency || "medium";
    const foundKeywords = workKeywords.filter((kw) => combined.includes(kw));
    result.keywords?.push(...foundKeywords);
  }

  // Travel keywords
  const travelKeywords = [
    "booking",
    "flight",
    "hotel",
    "reservation",
    "itinerary",
    "check-in",
    "boarding pass",
    "confirmation",
  ];
  if (travelKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Travel");
    result.importance = "medium";
    result.urgency = "medium";
    const foundKeywords = travelKeywords.filter((kw) => combined.includes(kw));
    result.keywords?.push(...foundKeywords);
  }

  // Security/Auth keywords
  const securityKeywords = [
    "verify",
    "authentication",
    "login attempt",
    "security alert",
    "unusual activity",
    "password",
    "2fa",
    "verification code",
  ];
  if (securityKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Security");
    result.importance = "high";
    result.urgency = "high";
    const foundKeywords = securityKeywords.filter((kw) =>
      combined.includes(kw),
    );
    result.keywords?.push(...foundKeywords);
  }

  // Notification keywords
  const notificationKeywords = [
    "notification",
    "update",
    "news",
    "alert",
    "announcement",
    "weekly digest",
    "summary",
  ];
  if (notificationKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Notifications");
    result.importance = result.importance || "low";
    result.urgency = result.urgency || "low";
  }

  // Support/Ticket keywords
  const supportKeywords = [
    "ticket",
    "support",
    "issue",
    "bug",
    "error",
    "help request",
    "inquiry",
    "question",
  ];
  if (supportKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Support");
    result.importance = "medium";
    result.urgency = "medium";
    const foundKeywords = supportKeywords.filter((kw) => combined.includes(kw));
    result.keywords?.push(...foundKeywords);
  }

  // Documents/Contract keywords
  const documentKeywords = [
    "contract",
    "agreement",
    "nda",
    "document",
    "attachment",
    "signed",
    "signature required",
    "proposal",
    "quote",
  ];
  if (documentKeywords.some((kw) => combined.includes(kw))) {
    result.categories?.push("Documents");
    result.importance = "high";
    result.urgency = "medium";
    const foundKeywords = documentKeywords.filter((kw) =>
      combined.includes(kw),
    );
    result.keywords?.push(...foundKeywords);
  }

  // Urgency indicators
  const urgencyIndicators = [
    "urgent",
    "asap",
    "immediately",
    "deadline today",
    "expires",
    "action required",
    "time sensitive",
    "emergency",
  ];
  if (urgencyIndicators.some((kw) => combined.includes(kw))) {
    result.urgency = "high";
    result.importance = result.importance || "high";
    result.keywords?.push(
      ...urgencyIndicators.filter((kw) => combined.includes(kw)),
    );
  }

  // Low priority indicators
  const lowPriorityIndicators = [
    "fyi",
    "for your information",
    "no action needed",
    "informational",
    "read only",
    "newsletter",
    "marketing",
  ];
  if (lowPriorityIndicators.some((kw) => combined.includes(kw))) {
    // Only lower if not already marked high
    if (!result.importance || result.importance === "medium") {
      result.importance = "low";
      result.urgency = "low";
    }
  }

  return result;
}

/**
 * Determines if a Gmail email should be skipped (not generate an insight)
 * based on Gmail labels. Filters out promotional, spam, social, updates, forums emails
 * unless explicitly marked as IMPORTANT or STARRED by the user.
 */
export function shouldSkipGmailEmail(email: {
  labelIds?: string[];
  gmailCategory?: string;
}): boolean {
  const labelIds = email.labelIds ?? [];
  const gmailCategory = email.gmailCategory ?? "";

  // If user explicitly marked it important or starred, never skip
  const isUserImportant =
    labelIds.includes("IMPORTANT") || labelIds.includes("STARRED");
  if (isUserImportant) return false;

  // Skip if Gmail categorized it as low-value
  const skipLabelIds = [
    "SPAM",
    "TRASH",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
  ];
  if (labelIds.some((id) => skipLabelIds.includes(id))) return true;

  // Skip if gmailCategory indicates low-value
  const skipCategories = ["promotions", "spam", "social", "updates", "forums"];
  if (skipCategories.includes(gmailCategory)) return true;

  return false;
}

/**
 * Extract top keywords from email content
 */
export function extractTopKeywords(
  email: ExtractEmailInfo,
  maxKeywords = 5,
): string[] {
  const subject = (email.subject || "").toLowerCase();
  const body = (email.text || "").toLowerCase();
  const combined = `${subject} ${body}`;

  // Common words to filter out
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "your",
    "my",
    "his",
    "her",
    "its",
    "our",
    "their",
    "me",
    "him",
    "us",
    "them",
    "what",
    "which",
    "who",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "also",
    "now",
    "here",
    "there",
    "then",
    "once",
    "about",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "up",
    "down",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "new",
    "old",
  ]);

  // Extract words (3+ characters)
  const words = combined
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));

  // Count frequency
  const frequency = new Map<string, number>();
  for (const word of words) {
    frequency.set(word, (frequency.get(word) || 0) + 1);
  }

  // Sort by frequency and return top N
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}
