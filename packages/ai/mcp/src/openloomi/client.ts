export const DEFAULT_OPENLOOMI_BASE_URLS = [
  "http://127.0.0.1:3414",
  "http://localhost:3414",
  "http://127.0.0.1:3515",
  "http://localhost:3515",
] as const;

export interface OpenLoomiClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenLoomiRequestOptions extends RequestInit {
  token?: string | null;
  timeoutMs?: number;
}

export class OpenLoomiApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "OpenLoomiApiError";
    this.status = status;
    this.body = body;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createAbortSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

export class OpenLoomiClient {
  readonly baseUrl: string;
  readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenLoomiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ??
        process.env.OPENLOOMI_API_URL ??
        DEFAULT_OPENLOOMI_BASE_URLS[0],
    );
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T = unknown>(
    path: string,
    options: OpenLoomiRequestOptions = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    const token = options.token === undefined ? this.token : options.token;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      signal:
        options.signal ??
        createAbortSignal(options.timeoutMs ?? this.timeoutMs),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `OpenLoomi API request failed with status ${response.status}`;
      throw new OpenLoomiApiError(message, response.status, body);
    }

    return body as T;
  }

  getJson<T = unknown>(
    path: string,
    options: Omit<OpenLoomiRequestOptions, "method"> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  postJson<T = unknown>(
    path: string,
    body: unknown,
    options: Omit<OpenLoomiRequestOptions, "body" | "method"> = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");

    return this.request<T>(path, {
      ...options,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
}

export async function resolveOpenLoomiBaseUrl(
  options: {
    baseUrl?: string;
    token?: string | null;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string | null> {
  const candidates = [
    options.baseUrl,
    process.env.OPENLOOMI_API_URL,
    ...DEFAULT_OPENLOOMI_BASE_URLS,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const client = new OpenLoomiClient({
      baseUrl: candidate,
      token: options.token ?? undefined,
      timeoutMs: options.timeoutMs ?? 1500,
      fetchImpl: options.fetchImpl,
    });

    try {
      await client.request("/api/remote-auth/user", {
        token: options.token ?? null,
        timeoutMs: options.timeoutMs ?? 1500,
      });
      return client.baseUrl;
    } catch (error) {
      if (error instanceof OpenLoomiApiError && error.status < 500) {
        return client.baseUrl;
      }
    }
  }

  return null;
}
