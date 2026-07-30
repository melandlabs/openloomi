import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { OpenLoomiApiError, OpenLoomiClient } from "../openloomi/client";
import {
  checkOpenLoomiReadiness,
  formatOpenLoomiReadiness,
} from "../openloomi/readiness";
import type { OpenLoomiToolContext } from "./index";

const MAX_TEXT_RESULT_LENGTH = 12000;

export type OpenLoomiToolResult = CallToolResult;

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { data: value };
}

function stringifyForText(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  if (text.length <= MAX_TEXT_RESULT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_TEXT_RESULT_LENGTH)}\n...truncated`;
}

export function jsonToolResult(
  title: string,
  value: unknown,
  structuredContent: Record<string, unknown> = toStructuredContent(value),
): OpenLoomiToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${title}\n\n${stringifyForText(value)}`,
      },
    ],
    structuredContent,
  };
}

export function apiErrorToolResult(
  title: string,
  error: unknown,
): OpenLoomiToolResult {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  ) {
    const message = "Request timed out before OpenLoomi responded.";
    return {
      content: [{ type: "text", text: `${title}: ${message}` }],
      structuredContent: {
        error: {
          kind: "timeout",
          message,
        },
      },
      isError: true,
    };
  }

  if (error instanceof OpenLoomiApiError) {
    return {
      content: [
        {
          type: "text",
          text: `${title}: OpenLoomi API request failed (${error.status})\n\n${stringifyForText(
            error.body,
          )}`,
        },
      ],
      structuredContent: {
        error: {
          message: error.message,
          status: error.status,
          body: error.body,
        },
      },
      isError: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${title}: ${message}` }],
    structuredContent: {
      error: { message },
    },
    isError: true,
  };
}

export async function requireReadyOpenLoomiClient(
  context: OpenLoomiToolContext,
): Promise<
  | { ready: true; client: OpenLoomiClient }
  | { ready: false; result: OpenLoomiToolResult }
> {
  const readiness = await checkOpenLoomiReadiness({
    authToken: context.authToken,
    preferredBaseUrl: context.client.baseUrl,
  });

  if (!readiness.ready) {
    return {
      ready: false,
      result: {
        content: [
          {
            type: "text",
            text: formatOpenLoomiReadiness(readiness),
          },
        ],
        structuredContent: { readiness: { ...readiness } },
        isError: true,
      },
    };
  }

  return {
    ready: true,
    client: new OpenLoomiClient({
      baseUrl: readiness.baseUrl ?? context.client.baseUrl,
      token: context.authToken.token ?? undefined,
    }),
  };
}

export async function withReadyOpenLoomiClient(
  context: OpenLoomiToolContext,
  title: string,
  run: (client: OpenLoomiClient) => Promise<OpenLoomiToolResult>,
): Promise<OpenLoomiToolResult> {
  const ready = await requireReadyOpenLoomiClient(context);
  if (!ready.ready) {
    return ready.result;
  }

  try {
    return await run(ready.client);
  } catch (error) {
    return apiErrorToolResult(title, error);
  }
}
