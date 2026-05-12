import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// Emails mostly use tables for layout, Turndown doesn't recognize table tags by default
// Add custom rule to convert table layout to plain text (one line per row, cells separated by spaces)
// Also detect layout table rows (cells contain lots of content or nested block elements), avoid flattening entire email body to one line
turndownService.addRule("tableRow", {
  filter: "tr",
  replacement(content, node) {
    const cellNodes = Array.from(node.childNodes).filter(
      (c) => c.nodeName === "TD" || c.nodeName === "TH",
    );

    // Layout detection: any cell with long textContent, or only contains single cell with block-level elements
    const isLayoutRow = cellNodes.some((cell) => {
      const text = (cell.textContent ?? "").trim();
      if (text.length > 300) return true;
      const el = cell as Element;
      if (typeof el.querySelector === "function") {
        if (el.querySelector("table,div,p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote"))
          return true;
      }
      return false;
    });

    if (isLayoutRow) {
      return content ? `\n${content.trim()}\n` : "";
    }

    const cells: string[] = [];
    for (const child of cellNodes) {
      const text = (child.textContent ?? "").trim();
      if (text) cells.push(text);
    }
    return cells.length > 0 ? `${cells.join("  ")}\n` : "";
  },
});

turndownService.addRule("tableCell", {
  filter: ["td", "th"],
  replacement(content) {
    return content.trim();
  },
});

turndownService.addRule("tableContainer", {
  filter: ["table", "thead", "tbody", "tfoot"],
  replacement(content) {
    return `\n\n${content.trim()}\n\n`;
  },
});

/**
 * Unified email content cleaning pipeline
 * Regardless of source (IMAP / Gmail OAuth / Outlook), this function produces clean Markdown + plain text
 */
export function cleanEmailForLLM({
  html,
  text,
}: {
  html?: string | null;
  text?: string | null;
}): { markdown: string; plain: string; cleanHtml?: string } {
  const rawHtml = html?.trim() ?? "";
  const rawText = text ?? "";

  if (rawHtml.length > 0) {
    const { markdown, plain } = selectPrimaryMarkdown(rawHtml);
    // Always use sanitizeEmailHtmlContent to preserve original HTML structure (including tables),
    // instead of simplified version rebuilt by markdownToBasicHtml
    const sanitizedHtml = sanitizeEmailHtmlContent(rawHtml);
    const fallbackPlain =
      plain.trim().length > 0
        ? plain
        : stripQuotedText(htmlToPlainText(rawHtml));
    return {
      markdown: markdown || cleanupMarkdown(htmlToPlainText(rawHtml)),
      plain: fallbackPlain,
      cleanHtml: sanitizedHtml || undefined,
    };
  }

  const strippedText = stripQuotedText(rawText);
  const markdown = cleanupMarkdown(strippedText);
  const plain = markdownToPlainText(markdown);

  return {
    markdown,
    plain: plain || strippedText,
    cleanHtml: markdown ? markdownToBasicHtml(markdown) : undefined,
  };
}

// ---------------------------------------------------------------------------
// HTML → Plain text
// ---------------------------------------------------------------------------

export function htmlToPlainText(html?: string | null): string {
  if (!html) return "";
  let text = html;
  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  for (const [entity, value] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, "g"), value);
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Blank line collapse
// ---------------------------------------------------------------------------

function collapseBlankLines(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Remove quoted/reply content
// ---------------------------------------------------------------------------

export function stripQuotedText(text: string): string {
  if (!text) return "";
  const normalized = collapseBlankLines(text);
  const lines = normalized.split("\n");

  const markers = [
    /^On .+wrote:?$/i,
    /^From[:：]/,
    /^From:\s/i,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^_{3,}/,
  ];

  const resultLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith(">")) {
      continue;
    }

    if (markers.some((m) => m.test(trimmed))) {
      let nextLineIndex = i + 1;
      while (nextLineIndex < lines.length && !lines[nextLineIndex].trim()) {
        nextLineIndex++;
      }

      if (
        nextLineIndex < lines.length &&
        lines[nextLineIndex].trim().startsWith(">")
      ) {
        continue;
      }

      if (
        /^From:\s/i.test(trimmed) ||
        /^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed)
      ) {
        break;
      }
    }

    resultLines.push(line);
  }

  return collapseBlankLines(resultLines.join("\n"));
}

function stripQuotedHtml(html: string): string {
  return html
    .replace(
      /<blockquote[^>]*class="gmail_quote"[^>]*>[\s\S]*?<\/blockquote>/gi,
      "",
    )
    .replace(/<div[^>]*class="gmail_quote"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class="gmail_attr"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<hr[^>]*>[\s\S]*?(From:|From:|Original Message|Sent:)/gi, "<hr>");
}

// ---------------------------------------------------------------------------
// Boilerplate detection
// ---------------------------------------------------------------------------

export function isBoilerplate(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;

  // 1. Exact matches / prefix matches for common short text
  const exactBoilerplate = [
    "unsubscribe",
    "privacy policy",
    "terms of service",
    "terms of use",
    "view in browser",
    "view online",
    "manage preferences",
    "update preferences",
    "marketing preferences",
    "safe unsubscribe",
  ];

  if (
    exactBoilerplate.some(
      (k) => lower === k || (lower.startsWith(k) && lower.length < 50),
    )
  ) {
    return true;
  }

  // 2. Keyword inclusion (limit to short text to avoid false positives on main content)
  const boilerplateKeywords = [
    "unsubscribe",
    "view this email in your browser",
    "received this email because",
    "copyright ©",
    "all rights reserved",
    "no longer wish to receive",
    "opt out",
    "email preferences",
    "click here to unsubscribe",
    "manage your subscription",
    "update your preferences",
    "if you no longer want",
    "this is an automated",
    "do not reply to this email",
  ];

  if (boilerplateKeywords.some((keyword) => lower.includes(keyword))) {
    if (lower.length < 300) return true;
  }

  // 3. Promotional template content detection (social media, download app, etc.)
  const promoPatterns = [
    "follow us",
    "connect with us",
    "join us on",
    "find us on",
    "like us on",
    "share this",
    "forward to a friend",
    "forward this email",
    "download the app",
    "download our app",
    "get the app",
    "available on the app store",
    "available on google play",
    "powered by",
    "sent with",
    "sent via",
  ];

  if (promoPatterns.some((p) => lower.includes(p))) {
    if (lower.length < 200) return true;
  }

  // 4. Navigation bar detection (short text connected by separators)
  const navSeparators = [" | ", " · ", " / ", " • "];
  const hasSeparator = navSeparators.some((sep) => lower.includes(sep));

  if (hasSeparator && lower.length <= 150) {
    return true;
  }

  // 5. Link density detection: if link count is much higher than normal text in a paragraph, likely template navigation
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (linkCount >= 3 && wordCount < linkCount * 8) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTML cleaning (moderate strength)
// ---------------------------------------------------------------------------

function isTrackingImage(src: string): boolean {
  if (!src) return true;
  const lower = src.toLowerCase();
  const trackingPatterns = [
    "tracking",
    "pixel",
    "beacon",
    "open.",
    "click.",
    "/t/",
    "/o/",
    "mailchimp.com/track",
    "sendgrid.net/wf/",
    "list-manage.com/track",
    "emltrk",
    "ci6.googleusercontent.com",
  ];
  return trackingPatterns.some((p) => lower.includes(p));
}

function sanitizeEmailHtmlContent(html: string): string {
  const withoutQuotes = stripQuotedHtml(html);
  return sanitizeHtml(withoutQuotes, {
    allowedTags: [
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "b",
      "i",
      "a",
      "img",
      "br",
      "hr",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "name", "target"],
      img: ["src", "alt"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    exclusiveFilter(frame) {
      // Tracking pixel detection
      if (frame.tag === "img") {
        const src = frame.attribs?.src ?? "";
        const alt = frame.attribs?.alt ?? "";
        if (!alt && isTrackingImage(src)) return true;
        if (!src) return true;
      }
      // Don't do boilerplate check on container-level elements, avoid false positives on entire tables/rows
      const containerTags = new Set([
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "ul",
        "ol",
      ]);
      if (containerTags.has(frame.tag)) return false;
      const text = (frame.text ?? "").trim();
      if (
        !text &&
        frame.tag !== "img" &&
        frame.tag !== "br" &&
        frame.tag !== "hr"
      )
        return false;
      return isBoilerplate(text);
    },
  });
}

// ---------------------------------------------------------------------------
// Markdown cleaning
// ---------------------------------------------------------------------------

export function cleanupMarkdown(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const lower = line.toLowerCase();
      if (line.trim().startsWith(">")) return false;
      if (lower.includes("unsubscribe")) return false;
      if (lower.includes("view in browser")) return false;
      if (lower.includes("privacy policy")) return false;
      if (/^--+$/.test(line.trim())) return false;
      return true;
    });
  return collapseBlankLines(lines.join("\n"));
}

function markdownToPlainText(markdown: string): string {
  if (!markdown) return "";
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^>+\s?/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Content block scoring (select most valuable content)
// ---------------------------------------------------------------------------

function scoreContentBlock(block: string): number {
  const plain = markdownToPlainText(block);
  if (!plain) return -1;
  const lower = plain.toLowerCase();
  const words = plain.split(/\s+/).filter(Boolean);
  let score = plain.length;

  // Downweight very short text
  if (words.length < 6) {
    score -= 80;
  }

  // Zero out boilerplate directly
  if (isBoilerplate(plain)) {
    return -1;
  }

  // Downweight excessive link density (promotional navigation area)
  const linkCount = (block.match(/\[.*?\]\(.*?\)/g) || []).length;
  if (linkCount >= 2 && words.length < linkCount * 6) {
    score -= plain.length * 0.8;
  }

  // Downweight social media keywords
  const socialKeywords = [
    "facebook",
    "twitter",
    "instagram",
    "linkedin",
    "youtube",
    "tiktok",
    "pinterest",
    "whatsapp",
    "telegram",
    "wechat",
  ];
  const socialHits = socialKeywords.filter((k) => lower.includes(k)).length;
  if (socialHits >= 2) {
    score -= plain.length * 0.7;
  }

  // Downweight pure CTA button text (very short + contains common verbs)
  const ctaPatterns = [
    /^(shop|buy|order|subscribe|sign up|register|learn more|read more|get started|try|join)/i,
  ];
  if (words.length <= 5 && ctaPatterns.some((p) => p.test(plain.trim()))) {
    score -= 100;
  }

  return score;
}

function selectPrimaryMarkdown(html: string): {
  markdown: string;
  plain: string;
} {
  const sanitized = sanitizeEmailHtmlContent(html);
  const markdown = cleanupMarkdown(turndownService.turndown(sanitized));
  if (!markdown.trim()) {
    return { markdown: "", plain: "" };
  }

  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    const plain = markdownToPlainText(markdown);
    return { markdown, plain };
  }

  // Keep positive-scoring blocks in original order, discard negative-scoring blocks (promotional/boilerplate)
  const chosen = blocks.filter((block) => scoreContentBlock(block) > 0);

  const finalMarkdown = collapseBlankLines(
    (chosen.length > 0 ? chosen : blocks.slice(0, 3)).join("\n\n"),
  );
  const plain = markdownToPlainText(finalMarkdown);
  return {
    markdown: finalMarkdown,
    plain,
  };
}

// ---------------------------------------------------------------------------
// Markdown → Basic HTML (used as cleanHtml fallback)
// ---------------------------------------------------------------------------

function markdownToBasicHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const htmlParts: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const isList = lines.every((line) => /^[-*+]\s+/.test(line.trim()));

    if (isList) {
      const items = lines
        .map(
          (line) =>
            `<li>${escapeHtml(line.replace(/^[-*+]\s+/, "").trim())}</li>`,
        )
        .join("");
      htmlParts.push(`<ul>${items}</ul>`);
      continue;
    }

    if (/^#{1,6}\s+/.test(lines[0])) {
      const level = Math.min(lines[0].match(/^#+/)?.[0].length ?? 1, 6);
      const content = escapeHtml(lines[0].replace(/^#{1,6}\s+/, "").trim());
      htmlParts.push(`<h${level}>${content}</h${level}>`);
      if (lines.length > 1) {
        htmlParts.push(
          `<p>${escapeHtml(lines.slice(1).join(" ")).replace(/\n/g, "<br/>")}</p>`,
        );
      }
      continue;
    }

    htmlParts.push(`<p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`);
  }

  return htmlParts.join("\n");
}

// ---------------------------------------------------------------------------
// Snippet generation
// ---------------------------------------------------------------------------

export function buildSnippet(plainText: string, maxLength = 240): string {
  const normalized = plainText.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
