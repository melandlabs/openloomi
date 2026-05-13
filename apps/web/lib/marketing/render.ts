import { siteMetadata } from "@/lib/marketing/seo";

import type {
  MarketingEmailTemplateDefinition,
  RenderedMarketingEmail,
  StructuredEmailContent,
  StructuredEmailSection,
  TemplateBuildContext,
} from "./types";

const LOGO_BASE = (
  process.env.MARKETING_ASSET_BASE ??
  siteMetadata.appUrl ??
  siteMetadata.siteUrl ??
  "https://app.openloomi.ai"
).replace(/\/$/, "");

const openloomi_LOGO_URL = `${LOGO_BASE}/images/logo_web.png`;
const MELAND_FOOTER_URL = `${LOGO_BASE}/images/melandfooter.jpg`;

function defaultGreeting(ctx: TemplateBuildContext) {
  if (ctx.user.firstName) {
    return `Hi ${ctx.user.firstName},`;
  }
  if (ctx.user.displayName) {
    return `Hi ${ctx.user.displayName},`;
  }
  const email = ctx.user.email ?? "";
  const prefix = email.split("@")[0] ?? "";
  if (prefix) {
    return `Hi ${prefix.charAt(0).toUpperCase()}${prefix.slice(1)},`;
  }
  return "Hi there,";
}

function renderParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 18px; font-size: 16px; line-height: 1.7; color: #334155;">${paragraph}</p>`,
    )
    .join("");
}

function renderSection(section: StructuredEmailSection): string {
  const heading = section.title
    ? `<h3 style="margin: 32px 0 12px; font-size: 22px; color: #1f3b64; letter-spacing: -0.01em; font-weight: 700; position: relative; padding-bottom: 8px;">
        ${section.title}
        <span style="position: absolute; left: 0; bottom: 0; width: 54px; height: 3px; background: linear-gradient(90deg, #64819e, #590a5c); border-radius: 9999px;"></span>
      </h3>`
    : "";
  const bullets = section.bullets
    ? `<ul style="margin: 16px 0 24px 20px; padding: 0; color: #334155; font-size: 15px; line-height: 1.7;">
        ${section.bullets
          .map(
            (bullet) =>
              `<li style="margin-bottom: 10px; position: relative; padding-left: 4px;">${bullet}</li>`,
          )
          .join("")}
      </ul>`
    : "";
  return `<div style="margin-bottom: 32px;">${heading}${renderParagraphs(section.paragraphs)}${bullets}</div>`;
}

function renderHighlights(
  highlights: NonNullable<StructuredEmailContent["highlights"]>,
): string {
  return `<div style="margin: 0 0 28px;">
    ${highlights
      .map(
        (
          item,
        ) => `<div style="background: linear-gradient(135deg, rgba(100,129,158,0.06), rgba(89,10,92,0.06)); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; border: 1px solid rgba(100,129,158,0.12);">
          <p style="margin: 0; font-weight: 700; font-size: 16px; color: #1f3b64;">${item.label}</p>
          <p style="margin: 8px 0 0; font-size: 15px; color: #4c5565; line-height: 1.7;">${item.description}</p>
        </div>`,
      )
      .join("")}
  </div>`;
}

function renderChecklist(items: string[]): string {
  return `<div style="margin: 32px 0; padding: 18px 22px; background: rgba(79,70,229,0.05); border-radius: 14px; border: 1px solid rgba(79,70,229,0.25);">
    <p style="margin: 0 0 10px; font-weight: 700; font-size: 15px; color: #1f3b64; letter-spacing: 0.02em;">Quick checklist</p>
    <ul style="margin: 0; padding-left: 20px; color: #334155; font-size: 15px; line-height: 1.7;">
      ${items.map((item) => `<li style="margin-bottom: 8px;">${item}</li>`).join("")}
    </ul>
  </div>`;
}

function renderCtas(
  ctx: TemplateBuildContext,
  ctas: NonNullable<StructuredEmailContent["ctas"]>,
): string {
  if (ctas.length === 0) {
    return "";
  }

  return `<div style="margin: 36px 0 12px; text-align: center;">
    ${ctas
      .map((cta) => {
        const href = ctx.links[cta.href];
        const background =
          cta.variant === "secondary"
            ? "#ffffff"
            : "linear-gradient(135deg, #4da6ff 0%, #2a73cc 100%)";
        const color = cta.variant === "secondary" ? "#2a73cc" : "#ffffff";
        const border =
          cta.variant === "secondary"
            ? "1px solid rgba(42,115,204,0.35)"
            : "1px solid transparent";
        const shadow =
          cta.variant === "secondary"
            ? "0 2px 10px rgba(42, 115, 204, 0.08)"
            : "0 10px 24px rgba(45, 139, 255, 0.35)";
        return `<div style="margin: 0 auto 18px;">
          <a href="${href}" style="display: inline-block; min-width: 220px; padding: 15px 26px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; background: ${background}; color: ${color}; border: ${border}; box-shadow: ${shadow}; text-align: center;">${cta.label}</a>
          ${cta.description ? `<p style="margin: 10px 0 0; font-size: 13px; color: #6b7280;">${cta.description}</p>` : ""}
        </div>`;
      })
      .join("")}
  </div>`;
}

function renderHtml(
  template: MarketingEmailTemplateDefinition,
  content: StructuredEmailContent,
  ctx: TemplateBuildContext,
  subject: string,
): string {
  const greeting = content.greeting ?? defaultGreeting(ctx);
  const intro = renderParagraphs(content.intro);
  const sections = content.sections
    ? content.sections.map(renderSection).join("")
    : "";
  const highlights = content.highlights
    ? renderHighlights(content.highlights)
    : "";
  const checklist = content.checklist ? renderChecklist(content.checklist) : "";
  const ctas = content.ctas ? renderCtas(ctx, content.ctas) : "";
  const signatureLine = "The openloomi Team";
  const closingLines = (() => {
    if (Array.isArray(content.closing) && content.closing.length > 0) {
      const hasSignature = content.closing.some(
        (line) =>
          typeof line === "string" &&
          line.toLowerCase().includes("meland labs") &&
          line.toLowerCase().includes("builders of openloomi"),
      );
      return hasSignature
        ? content.closing
        : [...content.closing, signatureLine];
    }
    return [signatureLine];
  })();
  const closing = renderParagraphs(closingLines);
  const year = new Date().getFullYear();
  const { supportEmail, supportUrl, feedbackUrl, unsubscribeUrl } = ctx.support;
  const headerTagline =
    "openloomi is your conversation avatar, redefining communication through privacy, understanding, memory, and intelligence.";
  const stageLabel = template.name || template.stage.replace(/_/g, " ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin: 0; padding: 24px 0; background-color: #f4f6fa; font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; color: #0f172a;">
    <span style="display: none; font-size: 1px; color: #f4f6fa; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;">
      ${typeof template.previewText === "string" ? template.previewText : ""}
    </span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6fa;">
      <tr>
        <td align="center" style="padding: 0 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 640px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);">
            <tr>
              <td style="position: relative; padding: 40px 36px 52px; background: linear-gradient(135deg, #4272c1 0%, #13408f 100%); text-align: center;">
                <div style="position: absolute; inset: 0; opacity: 0.15; background: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22 viewBox=%220 0 100 100%22%3E%3Cpath d=%22M0,50 Q25,0 50,50 T100,50%22 stroke=%22rgba(255,255,255,0.4)%22 fill=%22none%22 stroke-width=%221.5%22/%3E%3C/svg%3E'); background-size: 140px;"></div>
                <div style="position: relative; z-index: 1;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td align="left" style="padding: 0 0 16px;">
                        <img src="${openloomi_LOGO_URL}" alt="openloomi logo" width="88" style="display: block; max-width: 88px; height: auto;" />
                      </td>
                    </tr>
                    <tr>
                      <td align="center">
                        <p style="margin: 0 0 8px; font-weight: 700; font-size: 24px; letter-spacing: -0.01em; color: #ffffff;">
                          openloomi is your communication avatar
                        </p>
                        <p style="margin: 0; max-width: 460px; font-size: 15px; line-height: 1.6; color: rgba(255,255,255,0.92);">
                          Simple communication. Stay focused.
                        </p>
                      </td>
                    </tr>
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 36px 40px 40px; background: #ffffff;">
                <p style="margin: 0 0 18px; font-size: 16px; font-weight: 600; color: #1f3b64;">${greeting}</p>
                ${intro}
                ${highlights}
                ${sections}
                ${checklist}
                ${ctas}
                ${closing}
              </td>
            </tr>
            <tr>
              <td style="padding: 26px 32px 24px; background: #fafafa; border-top: 1px solid #edf1f5; text-align: center;">
                <img src="${MELAND_FOOTER_URL}" alt="Meland Labs logo" style="display: block; max-width: 220px; margin: 0 auto 16px;" />
                <p style="margin: 0 0 10px; font-size: 13px; color: #64748b;">
                  Need support? Email <a href="mailto:${supportEmail}" style="color: #2a73cc; text-decoration: none; font-weight: 600;">${supportEmail}</a>.
                </p>
                <p style="margin: 0 0 10px; font-size: 13px; color: #64748b;">
                  Share feedback any time: <a href="${feedbackUrl}" style="color: #2a73cc; text-decoration: none; font-weight: 600;">Tell the openloomi team what you need</a>.
                </p>
                <p style="margin: 0 0 12px; font-size: 13px; color: #64748b;">
                  Prefer fewer emails? <a href="${unsubscribeUrl}" style="color: #2a73cc; text-decoration: none; font-weight: 600;">Unsubscribe</a>.
                </p>
                <p style="margin: 0; font-size: 12px; color: #94a3b8;">© ${year} openloomi · Meland Labs</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(
  content: StructuredEmailContent,
  ctx: TemplateBuildContext,
  subject: string,
  previewText: string,
): string {
  const greeting = content.greeting ?? defaultGreeting(ctx);
  const intro = content.intro.join("\n\n");

  const highlights = content.highlights
    ? content.highlights
        .map((item) => `${item.label}\n${item.description}`)
        .join("\n\n")
    : "";
  const sections = content.sections
    ? content.sections
        .map((section) => {
          const heading = section.title ? `\n${section.title}\n` : "";
          const paragraphs = section.paragraphs.join("\n\n");
          const bullets = section.bullets
            ? `\n- ${section.bullets.join("\n- ")}`
            : "";
          return `${heading}${paragraphs}${bullets}`;
        })
        .join("\n\n")
    : "";
  const checklist = content.checklist
    ? `\nChecklist:\n- ${content.checklist.join("\n- ")}`
    : "";
  const ctas = content.ctas
    ? `\nTake action:\n${content.ctas
        .map((cta) => `${cta.label}: ${ctx.links[cta.href]}`)
        .join("\n")}`
    : "";
  const signatureLineText = "The openloomi Team";
  const closing = (() => {
    if (Array.isArray(content.closing) && content.closing.length > 0) {
      const hasSignature = content.closing.some(
        (line) =>
          line.toLowerCase().includes("meland labs") &&
          line.toLowerCase().includes("builders of openloomi"),
      );
      const lines = hasSignature
        ? content.closing
        : [...content.closing, signatureLineText];
      return lines.join("\n\n");
    }
    return signatureLineText;
  })();

  const lines = [
    previewText,
    subject,
    "",
    greeting,
    intro,
    highlights,
    sections,
    checklist,
    ctas,
    "",
    closing,
    "",
    `Need help? ${ctx.support.supportEmail} • ${ctx.support.supportUrl}`,
    `Share feedback: ${ctx.support.feedbackUrl}`,
    `Unsubscribe: ${ctx.support.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return lines;
}

export function renderMarketingEmail(
  template: MarketingEmailTemplateDefinition,
  ctx: TemplateBuildContext,
): RenderedMarketingEmail {
  const subject =
    typeof template.subject === "function"
      ? template.subject(ctx)
      : template.subject;
  const previewText = template.previewText;
  const content = template.buildContent(ctx);

  return {
    subject,
    previewText,
    html: renderHtml(template, content, ctx, subject),
    text: renderText(content, ctx, subject, previewText),
  };
}
