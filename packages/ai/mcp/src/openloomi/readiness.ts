import {
  DEFAULT_OPENLOOMI_BASE_URLS,
  OpenLoomiApiError,
  OpenLoomiClient,
} from "./client";
import { readOpenLoomiAuthToken, type OpenLoomiAuthToken } from "./token";

export const OPENLOOMI_INSTALL_URL =
  "https://openloomi.ai/docs/getting-started";

export type OpenLoomiReadinessState =
  | "READY"
  | "DESKTOP_NOT_DETECTED"
  | "TOKEN_REQUIRED"
  | "AUTH_FAILED"
  | "API_ERROR";

export interface OpenLoomiApiProbe {
  baseUrl: string;
  reachable: boolean;
  status?: number;
  authOk: boolean;
  error?: string;
}

export interface OpenLoomiReadiness {
  ready: boolean;
  state: OpenLoomiReadinessState;
  baseUrl: string | null;
  installUrl: string;
  token: {
    present: boolean;
    source: OpenLoomiAuthToken["source"];
    path?: string;
    error?: string;
  };
  api: {
    reachable: boolean;
    selectedBaseUrl: string | null;
    probes: OpenLoomiApiProbe[];
  };
  auth: {
    ok: boolean;
    status?: number;
    error?: string;
  };
  nextSteps: string[];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function getCandidateBaseUrls(preferredBaseUrl?: string): string[] {
  return uniqueStrings([
    preferredBaseUrl,
    process.env.OPENLOOMI_API_URL,
    ...DEFAULT_OPENLOOMI_BASE_URLS,
  ]);
}

async function probeOpenLoomiApi(input: {
  baseUrl: string;
  token: string | null;
  timeoutMs: number;
}): Promise<OpenLoomiApiProbe> {
  const client = new OpenLoomiClient({
    baseUrl: input.baseUrl,
    token: input.token ?? undefined,
    timeoutMs: input.timeoutMs,
  });

  try {
    await client.getJson("/api/remote-auth/user", {
      token: input.token,
      timeoutMs: input.timeoutMs,
    });
    return {
      baseUrl: client.baseUrl,
      reachable: true,
      status: 200,
      authOk: Boolean(input.token),
    };
  } catch (error) {
    if (error instanceof OpenLoomiApiError) {
      return {
        baseUrl: client.baseUrl,
        reachable: true,
        status: error.status,
        authOk: false,
        error: error.message,
      };
    }

    return {
      baseUrl: client.baseUrl,
      reachable: false,
      authOk: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveReadinessState(input: {
  tokenPresent: boolean;
  selectedProbe: OpenLoomiApiProbe | null;
}): OpenLoomiReadinessState {
  const { tokenPresent, selectedProbe } = input;

  if (!selectedProbe) {
    return "DESKTOP_NOT_DETECTED";
  }

  if (!tokenPresent) {
    return "TOKEN_REQUIRED";
  }

  if (selectedProbe.authOk) {
    return "READY";
  }

  if (selectedProbe.status === 401 || selectedProbe.status === 403) {
    return "AUTH_FAILED";
  }

  return "API_ERROR";
}

function getNextSteps(state: OpenLoomiReadinessState): string[] {
  switch (state) {
    case "READY":
      return [
        "OpenLoomi Desktop is running and token authentication passed.",
        "You can now use OpenLoomi MCP tools from this agent runtime.",
      ];
    case "DESKTOP_NOT_DETECTED":
      return [
        `Install OpenLoomi Desktop from ${OPENLOOMI_INSTALL_URL} if it is not installed.`,
        "Start OpenLoomi Desktop and keep it running.",
        "Run openloomi_setup again after the app is running.",
      ];
    case "TOKEN_REQUIRED":
      return [
        "Open OpenLoomi Desktop and complete sign-in or guest setup.",
        "Wait for ~/.openloomi/token to be created, or set OPENLOOMI_AUTH_TOKEN.",
        "Run openloomi_setup again after the token is available.",
      ];
    case "AUTH_FAILED":
      return [
        "Open OpenLoomi Desktop and refresh the current session.",
        "If OPENLOOMI_AUTH_TOKEN is set, verify it is the current token.",
        "Run openloomi_setup again after re-authentication.",
      ];
    case "API_ERROR":
      return [
        "OpenLoomi Desktop responded, but the readiness probe did not complete cleanly.",
        "Restart OpenLoomi Desktop and run openloomi_setup again.",
      ];
  }
}

export async function checkOpenLoomiReadiness(
  options: {
    authToken?: OpenLoomiAuthToken;
    preferredBaseUrl?: string;
    token?: string;
    timeoutMs?: number;
  } = {},
): Promise<OpenLoomiReadiness> {
  const tokenResult =
    options.authToken ??
    (options.token
      ? ({ token: options.token, source: "env" } satisfies OpenLoomiAuthToken)
      : await readOpenLoomiAuthToken());
  const token = tokenResult.token ?? null;
  const probes = await Promise.all(
    getCandidateBaseUrls(options.preferredBaseUrl).map((baseUrl) =>
      probeOpenLoomiApi({
        baseUrl,
        token,
        timeoutMs: options.timeoutMs ?? 1500,
      }),
    ),
  );
  const selectedProbe =
    probes.find((probe) => probe.authOk) ??
    probes.find((probe) => probe.reachable) ??
    null;
  const state = resolveReadinessState({
    tokenPresent: Boolean(token),
    selectedProbe,
  });

  return {
    ready: state === "READY",
    state,
    baseUrl: selectedProbe?.baseUrl ?? null,
    installUrl: OPENLOOMI_INSTALL_URL,
    token: {
      present: Boolean(token),
      source: tokenResult.source,
      path: tokenResult.path,
      error: tokenResult.error,
    },
    api: {
      reachable: Boolean(selectedProbe),
      selectedBaseUrl: selectedProbe?.baseUrl ?? null,
      probes,
    },
    auth: {
      ok: state === "READY",
      status: selectedProbe?.status,
      error: selectedProbe?.error,
    },
    nextSteps: getNextSteps(state),
  };
}

export function formatOpenLoomiReadiness(
  readiness: OpenLoomiReadiness,
): string {
  const lines = [
    `OpenLoomi MCP readiness: ${readiness.state}`,
    `Desktop API: ${
      readiness.api.reachable
        ? `reachable at ${readiness.api.selectedBaseUrl}`
        : "not detected"
    }`,
    `Token: ${
      readiness.token.present
        ? `found via ${readiness.token.source}`
        : "missing"
    }`,
    `Auth: ${readiness.auth.ok ? "passed" : "not ready"}`,
    "",
    "Next steps:",
    ...readiness.nextSteps.map((step) => `- ${step}`),
  ];

  return lines.join("\n");
}
