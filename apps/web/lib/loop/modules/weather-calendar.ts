/**
 * Weather + next calendar events — quiet-day filler (#316).
 *
 * On a quiet morning, surface the local weather and the next 2 calendar
 * events so the card is worth opening. Weather comes from Open-Meteo
 * (no API key required). Calendar events come from the agent's
 * google_calendar probe — when the connector is missing, the calendar
 * section degrades out and we return weather-only (or `null` if even
 * weather fails).
 *
 * Location resolution:
 *   1. `~/.openloomi/loop/location.json` (user-set; populated via a
 *      follow-up settings UI; absent for now, so this branch is
 *      effectively always empty until that ships).
 *   2. `https://ipapi.co/json/` (free, no key, IP-based geolocation).
 *      Soft-fails on any error (rate limit, offline, etc.).
 *   3. `null` → weather section is omitted, calendar-only card.
 *
 * Output shape (rendered by `renderQuietDigest` in `loomi-card.html`):
 *   - `context.items[]` = array of bullets — weather first, then events
 *   - `dialogue`        = the headline string
 *   - `nextStep`        = "Tap to see weather and your day."
 *
 * No side effects: the calendar probe is read-only.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { invokeAgentPrompt } from "../runner";
import type { LoopDecision } from "../types";
import type { QuietDayContext, QuietDayModule } from "../quiet-modules";

const WEATHER_TIMEOUT_MS = 8 * 1000;
const LOCATION_TIMEOUT_MS = 6 * 1000;
const CALENDAR_TIMEOUT_MS = 30 * 1000;

interface Location {
  latitude: number;
  longitude: number;
  /** Optional label (city / region) used in the bullet copy. */
  label?: string;
}

function loadUserLocation(): Location | null {
  try {
    const p = join(homedir(), ".openloomi", "loop", "location.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      latitude: lat,
      longitude: lon,
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    };
  } catch {
    return null;
  }
}

async function fetchIpLocation(): Promise<Location | null> {
  try {
    const res = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(LOCATION_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const lat = Number(json.latitude);
    const lon = Number(json.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      latitude: lat,
      longitude: lon,
      ...(typeof json.city === "string"
        ? { label: json.city }
        : typeof json.region === "string"
          ? { label: json.region }
          : {}),
    };
  } catch {
    return null;
  }
}

interface WeatherSummary {
  temperatureC: number;
  weatherCode: number;
  windKmh: number;
  /** Human label, e.g. "Partly cloudy". */
  label: string;
}

/**
 * WMO weather code → short human label. Covers the codes Open-Meteo
 * surfaces for current conditions; falls back to "—" for anything
 * exotic. Reference: https://open-meteo.com/en/docs
 */
function wmoLabel(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1 || code === 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm + hail";
  return "—";
}

async function fetchWeather(loc: Location): Promise<WeatherSummary | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const current = json.current as Record<string, unknown> | undefined;
    if (!current) return null;
    const t = Number(current.temperature_2m);
    const code = Number(current.weather_code);
    const wind = Number(current.wind_speed_10m);
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(code) ||
      !Number.isFinite(wind)
    ) {
      return null;
    }
    return {
      temperatureC: t,
      weatherCode: code,
      windKmh: wind,
      label: wmoLabel(code),
    };
  } catch {
    return null;
  }
}

interface ParsedEvent {
  title?: string;
  when?: string;
  where?: string;
}

function parseEvents(res: {
  ok: boolean;
  result?: unknown;
  text?: string;
}): ParsedEvent[] {
  const fromObj = (obj: unknown): ParsedEvent[] => {
    if (!obj || typeof obj !== "object") return [];
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.events)) return [];
    return o.events as ParsedEvent[];
  };
  if (!res.ok) return [];
  const fromResult = fromObj(res.result);
  if (fromResult.length) return fromResult.slice(0, 2);
  const m = /```json\s*([\s\S]+?)```/.exec(res.text ?? "");
  if (m) {
    try {
      return fromObj(JSON.parse(m[1])).slice(0, 2);
    } catch {
      return [];
    }
  }
  return [];
}

const CALENDAR_PROMPT = `List the user's next 2 calendar events (skip the all-day ones, prefer timed events with attendees). Output a SINGLE SSE \`result\` event whose \`content\` is JSON:

{
  "events": [
    { "title": string, "when": string, "where"?: string }
  ]
}

Rules:
- "when" is a short human string like "10:00–10:30 today" or "tomorrow 14:00".
- "where" is optional — omit when there's no room / link to share.
- If the user has no upcoming events, return {"events": []}.
- Use the google_calendar toolkit (GOOGLECALENDAR_LIST_EVENTS or equivalent). Do NOT create or modify anything — read-only.
- Fall back to a \`\`\`json fenced block in text if you can't emit a \`result\` event.`;

export const weatherCalendar: QuietDayModule = {
  id: "weather-calendar",
  label: "Weather + first meetings",
  isAvailable: async () => {
    // Open-Meteo is unconditional; calendar gracefully degrades to
    // weather-only when no connector is configured. Always reachable.
    return true;
  },
  async buildDecision(ctx: QuietDayContext): Promise<LoopDecision | null> {
    // Resolve location in order: user-set → IP geolocation → null.
    const loc = loadUserLocation() ?? (await fetchIpLocation());
    const [weather, calRes] = await Promise.all([
      loc ? fetchWeather(loc) : Promise.resolve(null),
      invokeAgentPrompt(CALENDAR_PROMPT, {
        timeoutMs: CALENDAR_TIMEOUT_MS,
      }).catch(
        () =>
          ({ ok: false, result: undefined, text: "" }) as {
            ok: boolean;
            result: unknown;
            text?: string;
          },
      ),
    ]);
    const events = parseEvents(calRes);

    // If both weather and events came back empty, there's nothing to
    // surface — let the caller skip the card entirely.
    if (!weather && events.length === 0) return null;

    const items: Array<{ title: string; summary: string }> = [];
    let headline: string;

    if (weather) {
      const roundedT = Math.round(weather.temperatureC);
      const roundedWind = Math.round(weather.windKmh);
      const where = loc?.label ? ` in ${loc.label}` : "";
      items.push({
        title: `Weather${where}`,
        summary: `${roundedT}°C · ${weather.label.toLowerCase()} · ${roundedWind} km/h wind`,
      });
      headline = `${roundedT}°C and ${weather.label.toLowerCase()}`;
    } else {
      headline = "Your day, ahead";
    }

    for (const e of events) {
      const title = String(e.title ?? "Untitled event").slice(0, 80);
      const when = String(e.when ?? "").slice(0, 60);
      const summary = when ? `${title} — ${when}` : title;
      items.push({ title: "Next", summary });
    }

    const now = new Date().toISOString();
    return {
      id: `quiet_${ctx.kind}_${now}`,
      ts: now,
      status: "pending",
      type: "quiet_digest",
      title: `${ctx.kind === "brief" ? "Morning" : "Evening"} digest · ${ctx.date}`,
      action: { kind: "quiet_digest", params: { module: "weather-calendar" } },
      dialogue: headline,
      nextStep: "Tap to see weather and your day.",
      context: {
        why: [
          `Quiet ${ctx.kind} on ${ctx.date}`,
          `Filler: ${weather ? "weather" : ""}${weather && events.length ? " + " : ""}${events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : ""}`.trim(),
        ],
        memory_refs: [],
        items,
      },
      confidence: 0.8,
    };
  },
};
