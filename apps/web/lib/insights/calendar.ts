import type { DetailData } from "@/lib/ai/subagents/insights";
import type { GeneratedInsightPayload } from "@/lib/insights/transform";
import type { HubspotDeal } from "@openloomi/integrations/hubspot";
import type { OutlookCalendarEvent } from "@openloomi/integrations/calendar";
import type { GoogleDocSummary } from "@openloomi/integrations/google-docs";

export function normalizeHubId(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function buildHubspotInsightPayload(
  deal: HubspotDeal,
  stageLookup: Map<
    string,
    { label?: string | null; pipelineLabel?: string | null }
  >,
  portalId: number | null,
  accountLabel: string | null,
): GeneratedInsightPayload {
  const stageId = deal.properties.dealstage ?? "unknown_stage";
  const stage = stageLookup.get(stageId);
  const pipelineLabel =
    stage?.pipelineLabel ??
    (typeof deal.properties.pipeline === "string"
      ? deal.properties.pipeline
      : null) ??
    "HubSpot pipeline";
  const stageLabel = stage?.label ?? stageId;
  const dealName = deal.properties.dealname ?? `Deal ${deal.id}`;
  const amount = deal.properties.amount;
  const amountText =
    typeof amount === "string" && amount.trim().length > 0
      ? `Amount: ${amount}`
      : null;

  const closeDateMs = Number.parseInt(deal.properties.closedate ?? "", 10);
  const closeDateText = Number.isFinite(closeDateMs)
    ? `Close date: ${new Date(closeDateMs).toLocaleDateString()}`
    : null;

  const lastModified =
    Number.parseInt(deal.properties.hs_lastmodifieddate ?? "", 10) ||
    Date.now();

  const link =
    portalId && deal.id
      ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`
      : null;

  const detail: DetailData = {
    time: Math.floor(lastModified / 1000),
    person: "HubSpot",
    platform: "hubspot",
    channel: pipelineLabel,
    content:
      [
        `Deal: ${dealName}`,
        stageLabel ? `Stage: ${stageLabel}` : null,
        amountText,
        closeDateText,
      ]
        .filter(Boolean)
        .join(" · ") || `Deal ${deal.id} updated`,
  };

  const sources =
    link || stageLabel
      ? [
          {
            platform: "hubspot" as const,
            snippet: `${dealName}${stageLabel ? ` · ${stageLabel}` : ""}`,
            link: link ?? undefined,
          },
        ]
      : null;

  return {
    dedupeKey: `hubspot:${deal.id}:${lastModified}:${stageId}`,
    taskLabel: "hubspot_deal",
    title: `${dealName} updated`,
    description: [stageLabel, pipelineLabel].filter(Boolean).join(" · "),
    importance: "medium",
    urgency: "low",
    platform: "hubspot",
    account: accountLabel ?? null,
    groups: pipelineLabel ? [pipelineLabel] : undefined,
    sources,
    time: new Date(lastModified),
    details: [detail],
  };
}

export function buildGoogleDocInsight(
  doc: GoogleDocSummary,
  accountEmail: string | null,
): GeneratedInsightPayload {
  const owners = doc.owners.length > 0 ? doc.owners.slice(0, 3) : null;
  const link = doc.webViewLink ?? null;

  return {
    dedupeKey: `google_docs:${doc.id}:${doc.modifiedTime.getTime()}`,
    taskLabel: "google_docs_update",
    title: `${doc.name} updated`,
    description: owners ? `Owners: ${owners.join(", ")}` : "Google Doc updated",
    importance: "medium",
    urgency: "low",
    platform: "google_docs",
    account: accountEmail,
    people: owners ?? undefined,
    time: doc.modifiedTime,
    sources: link
      ? [
          {
            platform: "google_docs" as const,
            snippet: doc.name,
            link,
          },
        ]
      : null,
    details: [
      {
        time: Math.floor(doc.modifiedTime.getTime() / 1000),
        person: owners?.[0] ?? "Google Docs",
        platform: "google_docs",
        channel: owners?.join(", ") ?? "Google Docs",
        content: `${doc.name} was modified`,
      },
    ],
  };
}

export function buildOutlookCalendarInsight(
  event: OutlookCalendarEvent,
  accountEmail: string | null,
): GeneratedInsightPayload {
  const startMs = new Date(event.start.dateTime).getTime();
  const updatedMs = event.lastModifiedDateTime
    ? new Date(event.lastModifiedDateTime).getTime()
    : startMs;
  const organizer =
    event.organizer?.emailAddress?.name ??
    event.organizer?.emailAddress?.address ??
    accountEmail ??
    "Organizer";
  const attendeeNames = (event.attendees ?? [])
    .map((att) => att.emailAddress?.name ?? att.emailAddress?.address ?? null)
    .filter(Boolean) as string[];
  const location = event.location?.displayName ?? "No location provided";
  const timeText = new Date(startMs).toLocaleString("en-US", {
    timeZone: event.start.timeZone ?? undefined,
  });

  return {
    dedupeKey: `outlook_calendar:${event.id}:${updatedMs}`,
    taskLabel: "outlook_calendar_event",
    title: event.subject ?? "Calendar event updated",
    description: `${timeText} · ${location}`,
    importance: "medium",
    urgency: "medium",
    platform: "outlook_calendar",
    account: accountEmail,
    groups: ["calendar"],
    people: attendeeNames.length > 0 ? attendeeNames.slice(0, 6) : undefined,
    sources: event.webLink
      ? [
          {
            platform: "outlook_calendar" as const,
            snippet: event.subject ?? "Calendar event",
            link: event.webLink,
          },
        ]
      : null,
    time: new Date(updatedMs),
    details: [
      {
        time: Math.floor(startMs / 1000),
        person: organizer,
        platform: "outlook_calendar",
        channel: location,
        content: [
          event.subject ?? "Calendar event",
          `When: ${timeText}`,
          attendeeNames.length > 0
            ? `Attendees: ${attendeeNames.slice(0, 6).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ],
  };
}
