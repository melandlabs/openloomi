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
import { AppError } from "@openloomi/shared/errors";

type InstagramStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

type FBTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type PageEntry = {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id?: string; username?: string };
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("instagram", status);
  if (message) {
    url.searchParams.set("instagramMessage", message);
  }
  return url;
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

  let statePayload: InstagramStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as InstagramStatePayload;
  } catch (error) {
    console.error("[instagram] Failed to decode state", error);
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
        "Sign in to connect Instagram.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Instagram.",
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

  const clientId = process.env.INSTAGRAM_APP_ID ?? process.env.FB_APP_ID;
  const clientSecret =
    process.env.INSTAGRAM_APP_SECRET ?? process.env.FB_APP_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Instagram integration is not configured.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.INSTAGRAM_REDIRECT_URI ?? `${baseUrl}/api/instagram/callback`;

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    });

    const tokenResponse = await fetch(
      "https://graph.facebook.com/v20.0/oauth/access_token",
      {
        method: "POST",
        body: tokenParams,
      },
    );
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new AppError("bad_request:auth", `Token exchange failed: ${text}`);
    }
    const tokenJson = (await tokenResponse.json()) as FBTokenResponse;
    if (!tokenJson.access_token) {
      throw new AppError(
        "bad_request:auth",
        "Instagram did not return an access token.",
      );
    }

    // Fetch pages to locate Instagram business account
    const pagesResponse = await fetch(
      "https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}",
      {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
        },
      },
    );
    const pagesJson = (await pagesResponse.json()) as { data?: PageEntry[] };
    const pages = pagesJson.data ?? [];
    const targetPage = pages.find(
      (page) => page.instagram_business_account?.id,
    );

    if (!targetPage?.instagram_business_account?.id) {
      throw new AppError(
        "bad_request:auth",
        "No Instagram business/creator account connected to your pages.",
      );
    }

    const igBusinessId = targetPage.instagram_business_account.id;
    const username = targetPage.instagram_business_account.username ?? null;
    const pageId = targetPage.id ?? "";
    const pageName = targetPage.name ?? null;
    const pageAccessToken = targetPage.access_token ?? tokenJson.access_token;
    const expiresAt = tokenJson.expires_in
      ? Date.now() + tokenJson.expires_in * 1000
      : null;

    const existingAccount = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "instagram",
    });

    const previousCredentials =
      loadIntegrationCredentials<{
        accessToken?: string;
        pageId?: string;
        igBusinessId?: string;
        username?: string | null;
        pageName?: string | null;
        expiresAt?: number | null;
      }>(existingAccount) ?? {};

    const credentials = {
      accessToken: pageAccessToken ?? previousCredentials.accessToken ?? "",
      pageId: pageId ?? previousCredentials.pageId ?? "",
      igBusinessId: igBusinessId ?? previousCredentials.igBusinessId ?? "",
      username: username ?? previousCredentials.username ?? null,
      pageName: pageName ?? previousCredentials.pageName ?? null,
      expiresAt: expiresAt ?? previousCredentials.expiresAt ?? null,
    };

    const externalId =
      igBusinessId ?? existingAccount?.externalId ?? session.user.id;

    const displayName =
      username ?? pageName ?? existingAccount?.displayName ?? "Instagram";

    const metadata = {
      igBusinessId,
      pageId,
      username,
      pageName,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "instagram",
      externalId,
      displayName,
      credentials,
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

    const adapterConfig = { pageId, igBusinessId, username };
    if (associatedBot) {
      await updateBot(associatedBot.id, {
        name: associatedBot.name ?? `Instagram · ${displayName}`,
        description:
          associatedBot.description ??
          "Automatically created through Instagram authorization",
        adapter: "instagram",
        adapterConfig,
        enable: true,
      });
    } else {
      await createBot({
        name: `Instagram · ${displayName}`,
        description: "Automatically created through Instagram authorization",
        adapter: "instagram",
        adapterConfig,
        enable: true,
        userId: session.user.id,
        platformAccountId: account.id,
      });
    }

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    console.error("[instagram] Callback handling failed", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        error instanceof AppError
          ? error.message
          : "Instagram authorization failed.",
      ),
    );
  }
}
