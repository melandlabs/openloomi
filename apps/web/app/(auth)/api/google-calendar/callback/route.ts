import { google } from "googleapis";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  getIntegrationAccountByPlatform,
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
  createBot,
  updateBot,
} from "@/lib/db/queries";
import type { GoogleCalendarStoredCredentials } from "@openloomi/integrations/calendar";
import { AppError } from "@openloomi/shared/errors";

type CalendarStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("googleCalendar", status);
  if (message) {
    url.searchParams.set("googleCalendarMessage", message);
  }
  return url;
}

function mergeCredentials(
  previous: GoogleCalendarStoredCredentials,
  next: {
    access_token?: string | null;
    refresh_token?: string | null;
    scope?: string | null;
    token_type?: string | null;
    expiry_date?: number | null;
  },
): GoogleCalendarStoredCredentials {
  return {
    accessToken: next.access_token ?? previous.accessToken ?? null,
    refreshToken: next.refresh_token ?? previous.refreshToken ?? null,
    scope: next.scope ?? previous.scope ?? null,
    tokenType: next.token_type ?? previous.tokenType ?? null,
    expiryDate: next.expiry_date ?? previous.expiryDate ?? null,
  };
}

export async function GET(request: Request) {
  const session = await auth();

  const baseUrl = getApplicationBaseUrl();
  const defaultRedirect = `${baseUrl}/?page=profile`;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    const message =
      errorParam === "access_denied"
        ? "Access was denied."
        : "Authorization failed.";
    return NextResponse.redirect(
      buildRedirectUrl(defaultRedirect, "cancelled", message),
    );
  }

  if (!stateParam) {
    return NextResponse.redirect(
      buildRedirectUrl(defaultRedirect, "error", "Missing state parameter."),
    );
  }

  let statePayload: CalendarStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as CalendarStatePayload;
  } catch (error) {
    console.error("[google-calendar] Failed to decode state", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        defaultRedirect,
        "error",
        "Invalid authorization state.",
      ),
    );
  }

  const redirectTarget = statePayload?.returnTo?.startsWith("http")
    ? statePayload.returnTo
    : defaultRedirect;

  if (!session?.user) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Sign in to connect Google Calendar.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Google.",
      ),
    );
  }

  const maxStateAgeMs = 10 * 60 * 1000;
  if (
    !statePayload ||
    statePayload.userId !== session.user.id ||
    Date.now() - statePayload.ts > maxStateAgeMs
  ) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Authorization state expired. Try again.",
      ),
    );
  }

  const clientId =
    process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET ??
    process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Google Calendar integration is not configured.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
      `${baseUrl}/api/google-calendar/callback`;

    const oauth2Client = new google.auth.OAuth2({
      clientId,
      clientSecret,
      redirectUri,
    });

    const { tokens } = await oauth2Client.getToken({ code });
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: "v2",
      auth: oauth2Client,
    });

    const userInfo = await oauth2.userinfo.get();

    const calendarClient = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    const calendarList = await calendarClient.calendarList.list({
      maxResults: 20,
      minAccessRole: "reader",
    });

    const primaryCalendar =
      calendarList.data.items?.find((item: any) => item.primary) ??
      calendarList.data.items?.[0];

    const selectedCalendars =
      calendarList.data.items
        ?.filter((item: any) => item.id)
        .slice(0, 10)
        .map((item: any) => ({
          id: item.id as string,
          summary: item.summary ?? item.id ?? "Calendar",
          primary: Boolean(item.primary),
          timeZone: item.timeZone ?? null,
        })) ?? [];

    const existingAccount = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "google_calendar",
    });

    const previousCredentials =
      loadIntegrationCredentials<GoogleCalendarStoredCredentials>(
        existingAccount,
      ) ?? {};

    const mergedCredentials = mergeCredentials(previousCredentials, tokens);

    if (!mergedCredentials.refreshToken) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Google Calendar did not provide a refresh token. Reconnect with “Allow” selected.",
        ),
      );
    }

    const externalId =
      userInfo.data.id ?? existingAccount?.externalId ?? session.user.id;

    const displayName =
      userInfo.data.name ??
      userInfo.data.email ??
      existingAccount?.displayName ??
      "Google Calendar";

    const metadata = {
      email: userInfo.data.email ?? null,
      picture: userInfo.data.picture ?? null,
      displayName,
      calendarIds: existingAccount?.metadata?.calendarIds ??
        selectedCalendars
          .filter((cal: any) => cal.primary)
          .map((cal: any) => cal.id ?? "primary") ?? ["primary"],
      calendars: selectedCalendars,
      timeZone: primaryCalendar?.timeZone ?? null,
      feedEnabled: existingAccount?.metadata?.feedEnabled ?? true,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "google_calendar",
      externalId,
      displayName,
      credentials: mergedCredentials,
      metadata,
      status: "active",
    });

    // Attach or create bot for insights ingestion
    const existingAccounts = await getIntegrationAccountsByUserId({
      userId: session.user.id,
    });
    const associatedBot = existingAccounts.find(
      (item) => item.id === account.id,
    )?.bot;

    if (associatedBot) {
      await updateBot(associatedBot.id, {
        name: associatedBot.name ?? `Google Calendar · ${displayName}`,
        description:
          associatedBot.description ??
          "Automatically created through Google Calendar authorization",
        adapter: "google_calendar",
        adapterConfig: {
          calendarIds: metadata.calendarIds,
          timeZone: metadata.timeZone ?? null,
        },
        enable: true,
      });
    } else {
      await createBot({
        name: `Google Calendar · ${displayName}`,
        description:
          "Automatically created through Google Calendar authorization",
        adapter: "google_calendar",
        adapterConfig: {
          calendarIds: metadata.calendarIds,
          timeZone: metadata.timeZone ?? null,
        },
        enable: true,
        userId: session.user.id,
        platformAccountId: account.id,
      });
    }

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    console.error("[google-calendar] Callback handling failed", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        error instanceof AppError
          ? error.message
          : "Google Calendar authorization failed.",
      ),
    );
  }
}
