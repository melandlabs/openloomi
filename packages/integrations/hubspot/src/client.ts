import { AppError } from "@openloomi/shared";

export type HubspotCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  tokenType?: string | null;
  scope?: string | null;
  hubId?: number | null;
  hubDomain?: string | null;
  userEmail?: string | null;
  userId?: string | null;
};

export type HubspotDeal = {
  id: string;
  properties: {
    dealname?: string;
    dealstage?: string;
    pipeline?: string;
    amount?: string;
    closedate?: string | null;
    hs_lastmodifieddate?: string | null;
    [key: string]: unknown;
  };
};

export type HubspotPipelineStage = {
  id: string;
  label?: string | null;
  pipelineId?: string | null;
  pipelineLabel?: string | null;
};

type HubspotSearchResponse = {
  results?: HubspotDeal[];
  paging?: {
    next?: { after?: string };
  };
};

type HubspotPipelineResponse = {
  results?: Array<{
    id: string;
    label?: string | null;
    stages?: Array<{
      id: string;
      label?: string | null;
    }>;
  }>;
};

type HubspotRefreshResponse = {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  token_type?: string | null;
  scope?: string | null;
  hub_id?: number | null;
  error?: string | null;
};

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_DEAL_SEARCH_URL =
  "https://api.hubapi.com/crm/v3/objects/deals/search";
const HUBSPOT_PIPELINES_URL = "https://api.hubapi.com/crm/v3/pipelines/deals";

export type PersistCredentialsOptions = {
  credentials: HubspotCredentials;
  metadata: {
    hubId: number | null;
    hubDomain: string | null;
    userEmail: string | null;
    userId: string | null;
  };
};

type ClientOptions = {
  credentials: HubspotCredentials;
  userId: string;
  platformAccountId?: string | null;
  onPersistCredentials?: (opts: PersistCredentialsOptions) => Promise<void>;
};

export class HubspotClient {
  private credentials: HubspotCredentials;
  private readonly userId: string;
  private readonly platformAccountId: string | null;
  private readonly onPersistCredentials?: (
    opts: PersistCredentialsOptions,
  ) => Promise<void>;
  private stageCache: Map<string, HubspotPipelineStage> | null = null;

  constructor(options: ClientOptions) {
    this.credentials = { ...options.credentials };
    this.userId = options.userId;
    this.platformAccountId = options.platformAccountId ?? null;
    this.onPersistCredentials = options.onPersistCredentials;
  }

  get portalId(): number | null {
    const id = this.credentials.hubId;
    if (typeof id === "number") return id;
    if (typeof id === "string") {
      const parsed = Number(id);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  async fetchRecentDeals({
    sinceMs,
    limit = 50,
    maxPages = 2,
  }: {
    sinceMs?: number;
    limit?: number;
    maxPages?: number;
  }): Promise<HubspotDeal[]> {
    const results: HubspotDeal[] = [];
    const properties = [
      "dealname",
      "dealstage",
      "pipeline",
      "amount",
      "closedate",
      "hs_lastmodifieddate",
    ];

    let after: string | undefined;
    let page = 0;

    do {
      const payload: Record<string, unknown> = {
        sorts: [
          {
            propertyName: "hs_lastmodifieddate",
            direction: "DESCENDING",
          },
        ],
        properties,
        limit,
      };

      if (sinceMs) {
        payload.filterGroups = [
          {
            filters: [
              {
                propertyName: "hs_lastmodifieddate",
                operator: "GT",
                value: sinceMs,
              },
            ],
          },
        ];
      }

      if (after) {
        payload.after = after;
      }

      const data = await this.fetchJson<HubspotSearchResponse>(
        HUBSPOT_DEAL_SEARCH_URL,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      const pageResults = data.results ?? [];
      results.push(...pageResults);
      after = data.paging?.next?.after;
      page += 1;
    } while (after && page < maxPages);

    return results;
  }

  async getStageLookup(): Promise<Map<string, HubspotPipelineStage>> {
    if (this.stageCache) {
      return this.stageCache;
    }

    const pipelines = await this.fetchJson<HubspotPipelineResponse>(
      HUBSPOT_PIPELINES_URL,
      { method: "GET" },
    );

    const map = new Map<string, HubspotPipelineStage>();
    pipelines.results?.forEach((pipeline) => {
      pipeline.stages?.forEach((stage) => {
        map.set(stage.id, {
          id: stage.id,
          label: stage.label ?? stage.id,
          pipelineId: pipeline.id,
          pipelineLabel: pipeline.label ?? pipeline.id,
        });
      });
    });

    this.stageCache = map;
    return map;
  }

  async updateDealStage({
    dealId,
    stageId,
  }: {
    dealId: string;
    stageId: string;
  }): Promise<HubspotDeal> {
    const url = `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealstage&properties=pipeline&properties=dealname`;
    return this.fetchJson<HubspotDeal>(url, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          dealstage: stageId,
        },
      }),
    });
  }

  private isExpired(): boolean {
    const expiresAt = this.credentials.expiresAt;
    if (!expiresAt) {
      return false;
    }
    return Date.now() > expiresAt - 90_000;
  }

  private async refreshIfNeeded() {
    if (!this.isExpired()) {
      return;
    }
    await this.refreshAccessToken();
  }

  private async refreshAccessToken() {
    const refreshToken = this.credentials.refreshToken;
    if (!refreshToken) {
      throw new AppError(
        "unauthorized:api",
        "HubSpot refresh token missing. Please reconnect HubSpot.",
      );
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new AppError(
        "bad_request:api",
        "HubSpot OAuth is not configured on the server.",
      );
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const body = (await response
      .json()
      .catch(() => ({}))) as HubspotRefreshResponse;

    if (!response.ok || !body.access_token) {
      throw new AppError(
        "unauthorized:api",
        body?.error ?? "Failed to refresh HubSpot token",
      );
    }

    this.credentials.accessToken = body.access_token;
    this.credentials.refreshToken =
      body.refresh_token ?? this.credentials.refreshToken ?? null;
    this.credentials.expiresAt = body.expires_in
      ? Date.now() + body.expires_in * 1000
      : null;
    this.credentials.tokenType = body.token_type ?? this.credentials.tokenType;
    this.credentials.scope = body.scope ?? this.credentials.scope ?? null;
    this.credentials.hubId = body.hub_id ?? this.credentials.hubId ?? null;

    await this.persistCredentials();
  }

  private async persistCredentials() {
    if (!this.platformAccountId || !this.onPersistCredentials) return;
    try {
      await this.onPersistCredentials({
        credentials: this.credentials,
        metadata: {
          hubId: this.credentials.hubId ?? null,
          hubDomain: this.credentials.hubDomain ?? null,
          userEmail: this.credentials.userEmail ?? null,
          userId: this.credentials.userId ?? null,
        },
      });
    } catch (error) {
      console.warn("[HubSpot] Failed to persist refreshed credentials", error);
    }
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    await this.refreshIfNeeded();

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.credentials.accessToken}`);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new AppError(
        "bad_request:api",
        `HubSpot API request failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }
}
