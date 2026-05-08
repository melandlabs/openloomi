import { AppError, type ErrorCode } from "@alloomi/shared";
import type { ChatMessage } from "@alloomi/shared";
import { formatISO } from "date-fns";
import type { Session } from "next-auth";
import { getAuthToken } from "@/lib/auth/token-manager";
import type { DBMessage } from "@/lib/db/schema";
import { getUserTimezoneHeaders } from "@/lib/timezone";

/**
 * Basic fetcher for API calls
 */
export const fetcher = async (url: string) => {
  const response = await fetch(url, {
    headers: getUserTimezoneHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new AppError(code as ErrorCode, cause);
  }

  return response.json();
};

/**
 * Fetcher with cloud auth token - automatically adds Authorization header
 * Use this for API calls that require AI Provider authentication
 */
export const fetcherWithCloudAuth: typeof fetcher = async (url) => {
  const cloudAuthToken = typeof window !== "undefined" ? getAuthToken() : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...getUserTimezoneHeaders(),
  };

  if (cloudAuthToken) {
    headers.Authorization = `Bearer ${cloudAuthToken}`;
  }

  const response = await fetch(url, {
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new AppError(code as ErrorCode, cause);
  }

  return response.json();
};

/**
 * Fetch with auth - automatically adds Authorization header for cloud auth
 * Supports all HTTP methods and custom options
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const cloudAuthToken = typeof window !== "undefined" ? getAuthToken() : null;

  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(getUserTimezoneHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }

  if (
    init?.body &&
    !headers.has("Content-Type") &&
    typeof init.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (cloudAuthToken) {
    headers.set("Authorization", `Bearer ${cloudAuthToken}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  return response;
}

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new AppError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new AppError("offline:chat");
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== "undefined") {
    return JSON.parse(localStorage.getItem(key) || "[]");
  }
  return [];
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as "user" | "assistant" | "system",
    parts: message.parts as any,
    metadata: {
      createdAt: formatISO(message.createdAt),
      ...(message.metadata || {}),
    },
  }));
}

export function createPageUrl(pageName: string) {
  return `/${pageName.toLowerCase().replace(/ /g, "-")}`;
}

export function judgeGuest(session: Session) {
  return session?.user?.type === "guest";
}

/**
 * Get the home path based on character tab mode.
 * In character tab mode, returns "/character", otherwise returns "/".
 */
export function getHomePath(): string {
  return "/";
}
