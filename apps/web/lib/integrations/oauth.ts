"use client";

import { isTauri } from "@/lib/tauri";

type StartRequest = {
  redirectPath?: string | null;
  token?: string; // Bearer token (Tauri mode)
};

type StartResponse = {
  authorizationUrl: string;
  sessionId?: string;
  redirectUri?: string;
};

type SlackExchangeResponse = {
  accessToken: string;
  authedUser: {
    id?: string;
    scope?: string;
    token_type?: string;
  } | null;
  team: {
    id?: string;
    name?: string;
  } | null;
};

type DiscordExchangeResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
  refreshToken: string | null;
  scope: string | null;
};

type TeamsExchangeResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  expiresAt: number | null;
  tokenType: string | null;
  scope: string | null;
  tenantId: string | null;
  user: {
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string | null;
  } | null;
};

type HubspotExchangeResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  tokenType: string | null;
  scope: string | null;
  hubId: number | null;
  hubDomain: string | null;
  userEmail: string | null;
  userId: number | null;
};

type GoogleDocsExchangeResponse = {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
  expiresIn: number | null;
  email?: string | null;
  name?: string | null;
};

type JiraExchangeResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
};

type LinearExchangeResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
};

async function requestAuthorizationUrl(
  endpoint: string,
  redirectPath: string,
  token?: string,
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("OAuth flow is only available in the browser");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ redirectPath, token } satisfies StartRequest),
  });

  if (!response.ok) {
    let message = "Failed to start OAuth flow";
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore JSON parse errors and use default message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as StartResponse;
  if (!data.authorizationUrl) {
    throw new Error("OAuth endpoint did not return an authorization URL");
  }

  return data.authorizationUrl;
}

async function exchangeAuthorizationCode<T>(
  endpoint: string,
  redirectPath: string,
  code: string,
  state: string,
): Promise<T> {
  if (typeof window === "undefined") {
    throw new Error("OAuth flow is only available in the browser");
  }

  const redirectUri = `${window.location.origin}${redirectPath}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ code, state, redirectUri }),
  });

  if (!response.ok) {
    let message = "Failed to finalize OAuth flow";
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getSlackAuthorizationUrl(
  token?: string,
): Promise<string> {
  // Always use local API, server decides whether to forward to cloud
  // In Tauri mode, pass Bearer token
  return requestAuthorizationUrl(
    "/api/slack/oauth/start",
    "/slack-authorized",
    token,
  );
}

export async function getDiscordAuthorizationUrl(
  token?: string,
): Promise<string> {
  // Always use local API, server decides whether to forward to cloud
  // In Tauri mode, pass Bearer token
  return requestAuthorizationUrl(
    "/api/discord/oauth/start",
    "/discord-authorized",
    token,
  );
}

export async function getXAuthorizationUrl(
  token?: string,
): Promise<{ authorizationUrl: string; sessionId: string }> {
  // Always use local API, server decides whether to forward to cloud
  // In Tauri mode, pass Bearer token
  const response = await fetch("/api/x/oauth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      redirectPath: "/x-authorized",
      token,
    } satisfies StartRequest),
  });

  if (!response.ok) {
    let message = "Failed to start OAuth flow";
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore JSON parse errors and use default message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as StartResponse;
  if (!data.authorizationUrl) {
    throw new Error("OAuth endpoint did not return an authorization URL");
  }
  if (!data.sessionId) {
    throw new Error("OAuth endpoint did not return a session ID");
  }

  return {
    authorizationUrl: data.authorizationUrl,
    sessionId: data.sessionId,
  };
}

export async function getTeamsAuthorizationUrl(): Promise<string> {
  return requestAuthorizationUrl("/api/teams/oauth/start", "/teams-authorized");
}

export async function getHubspotAuthorizationUrl(): Promise<string> {
  return requestAuthorizationUrl(
    "/api/hubspot/oauth/start",
    "/hubspot-authorized",
  );
}

export async function getGoogleDocsAuthorizationUrl(): Promise<string> {
  return requestAuthorizationUrl(
    "/api/google-docs/oauth",
    "/google-docs-authorized",
  );
}

export async function exchangeSlackAuthorizationCode(
  code: string,
  state: string,
): Promise<SlackExchangeResponse> {
  if (isTauri()) {
    // Tauri local version: call cloud public exchange API (no auth required)
    const cloudUrl =
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_CLOUD_API_URL) ||
      "https://app.openloomi.ai";

    const response = await fetch(
      `${cloudUrl}/api/integrations/slack/oauth/exchange`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, state }),
      },
    );

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: "Failed to exchange code" }))) as {
        error?: string;
      };
      throw new Error(error.error || "Failed to exchange authorization code");
    }

    return (await response.json()) as SlackExchangeResponse;
  }

  // Web version: keep original logic
  return exchangeAuthorizationCode<SlackExchangeResponse>(
    "/api/slack/oauth/exchange",
    "/slack-authorized",
    code,
    state,
  );
}

export async function exchangeDiscordAuthorizationCode(
  code: string,
  state: string,
): Promise<DiscordExchangeResponse> {
  if (isTauri()) {
    // Tauri local version: call cloud public exchange API (no auth required)
    const cloudUrl =
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_CLOUD_API_URL) ||
      "https://app.openloomi.ai";

    const response = await fetch(
      `${cloudUrl}/api/integrations/discord/oauth/exchange`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, state }),
      },
    );

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: "Failed to exchange code" }))) as {
        error?: string;
      };
      throw new Error(error.error || "Failed to exchange authorization code");
    }

    return (await response.json()) as DiscordExchangeResponse;
  }

  // Web version: keep original logic
  return exchangeAuthorizationCode<DiscordExchangeResponse>(
    "/api/discord/oauth/exchange",
    "/discord-authorized",
    code,
    state,
  );
}

export async function exchangeTeamsAuthorizationCode(
  code: string,
  state: string,
): Promise<TeamsExchangeResponse> {
  return exchangeAuthorizationCode<TeamsExchangeResponse>(
    "/api/teams/oauth/exchange",
    "/teams-authorized",
    code,
    state,
  );
}

export async function exchangeHubspotAuthorizationCode(
  code: string,
  state: string,
): Promise<HubspotExchangeResponse> {
  return exchangeAuthorizationCode<HubspotExchangeResponse>(
    "/api/hubspot/oauth/exchange",
    "/hubspot-authorized",
    code,
    state,
  );
}

export async function exchangeGoogleDocsAuthorizationCode(
  code: string,
  state: string,
): Promise<GoogleDocsExchangeResponse> {
  return exchangeAuthorizationCode<GoogleDocsExchangeResponse>(
    "/api/google-docs/callback",
    "/google-docs-authorized",
    code,
    state,
  );
}

export async function getJiraAuthorizationUrl(): Promise<string> {
  return requestAuthorizationUrl("/api/jira/oauth/start", "/jira-authorized");
}

export async function getLinearAuthorizationUrl(): Promise<string> {
  return requestAuthorizationUrl(
    "/api/linear/oauth/start",
    "/linear-authorized",
  );
}

export async function getNotionAuthorizationUrl(
  token?: string,
): Promise<string> {
  return requestAuthorizationUrl(
    "/api/notion/oauth/start",
    "/notion-authorized",
    token,
  );
}

export async function exchangeJiraAuthorizationCode(
  code: string,
  state: string,
): Promise<JiraExchangeResponse> {
  return exchangeAuthorizationCode<JiraExchangeResponse>(
    "/api/jira/oauth/exchange",
    "/jira-authorized",
    code,
    state,
  );
}

export async function exchangeLinearAuthorizationCode(
  code: string,
  state: string,
): Promise<LinearExchangeResponse> {
  return exchangeAuthorizationCode<LinearExchangeResponse>(
    "/api/linear/oauth/exchange",
    "/linear-authorized",
    code,
    state,
  );
}
