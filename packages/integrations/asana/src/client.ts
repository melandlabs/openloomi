import { AppError } from "@openloomi/shared";

export type AsanaCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  tokenType?: string | null;
  data?: {
    gid?: string;
    email?: string;
    name?: string;
  } | null;
};

export type AsanaTask = {
  gid: string;
  name: string;
  completed: boolean;
  completed_at?: string | null;
  created_at: string;
  modified_at: string;
  due_at?: string | null;
  due_on?: string | null;
  assignee?: {
    gid: string;
    name: string;
  } | null;
  projects?: Array<{
    gid: string;
    name: string;
  }>;
  parent?: {
    gid: string;
    name: string;
  } | null;
  custom_fields?: Array<{
    gid: string;
    name: string;
    display_value?: string;
    type: string;
  }>;
  workspace?: {
    gid: string;
    name: string;
  };
};

export type AsanaProject = {
  gid: string;
  name: string;
  due_on?: string | null;
  created_at: string;
  modified_at: string;
  public: boolean;
  workspace: {
    gid: string;
    name: string;
  };
};

export type AsanaWorkspace = {
  gid: string;
  name: string;
  is_organization: boolean;
};

export type AsanaUser = {
  gid: string;
  email: string;
  name: string;
};

type AsanaMultipleTasksResponse = {
  data: AsanaTask[];
  next_page?: {
    offset: string | null;
    path: string | null;
    uri: string | null;
  } | null;
};

type AsanaProjectsResponse = {
  data: AsanaProject[];
  next_page?: {
    offset: string | null;
    path: string | null;
    uri: string | null;
  } | null;
};

type AsanaWorkspacesResponse = {
  data: AsanaWorkspace[];
};

type AsanaUserResponse = {
  data: AsanaUser;
};

type AsanaTaskResponse = {
  data: AsanaTask;
};

type AsanaRefreshResponse = {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  token_type?: string | null;
  data?: {
    gid?: string;
    email?: string;
    name?: string;
  } | null;
  error?: string | null;
};

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";
const ASANA_TOKEN_URL = "https://app.asana.com/oauth/token";

export type ClientOptions = {
  credentials: AsanaCredentials;
  userId: string;
  platformAccountId?: string | null;
  onCredentialsUpdate?: (credentials: AsanaCredentials) => Promise<void>;
};

export class AsanaClient {
  private credentials: AsanaCredentials;
  private readonly userId: string;
  private readonly platformAccountId: string | null;
  private readonly onCredentialsUpdate?: (
    credentials: AsanaCredentials,
  ) => Promise<void>;

  constructor(options: ClientOptions) {
    this.credentials = { ...options.credentials };
    this.userId = options.userId;
    this.platformAccountId = options.platformAccountId ?? null;
    this.onCredentialsUpdate = options.onCredentialsUpdate;
  }

  async getMe(): Promise<AsanaUser> {
    const response = await this.fetchJson<AsanaUserResponse>(
      `${ASANA_BASE_URL}/users/me`,
      { method: "GET" },
    );
    return response.data;
  }

  async getWorkspaces(): Promise<AsanaWorkspace[]> {
    const response = await this.fetchJson<AsanaWorkspacesResponse>(
      `${ASANA_BASE_URL}/workspaces`,
      { method: "GET" },
    );
    return response.data;
  }

  async getTasks({
    workspace,
    project,
    assignee,
    completed_since,
    limit = 100,
    offset,
  }: {
    workspace?: string;
    project?: string;
    assignee?: string;
    completed_since?: string;
    limit?: number;
    offset?: string;
  } = {}): Promise<{ tasks: AsanaTask[]; nextPage: string | null }> {
    const params = new URLSearchParams();
    params.set("limit", limit.toString());

    if (workspace) params.set("workspace", workspace);
    if (project) params.set("project", project);
    if (assignee) params.set("assignee", assignee);
    if (completed_since) params.set("completed_since", completed_since);
    if (offset) params.set("offset", offset);
    params.set(
      "opt_fields",
      "gid,name,completed,completed_at,created_at,modified_at,due_at,due_on,assignee,name,projects,gid,name,parent,gid,name,custom_fields,gid,name,display_value,type,workspace,gid,name",
    );

    const response = await this.fetchJson<AsanaMultipleTasksResponse>(
      `${ASANA_BASE_URL}/tasks?${params.toString()}`,
      { method: "GET" },
    );

    return {
      tasks: response.data,
      nextPage: response.next_page?.offset ?? null,
    };
  }

  async getTask(taskId: string): Promise<AsanaTask> {
    const params = new URLSearchParams();
    params.set(
      "opt_fields",
      "gid,name,completed,completed_at,created_at,modified_at,due_at,due_on,assignee,name,projects,gid,name,parent,gid,name,custom_fields,gid,name,display_value,type,workspace,gid,name",
    );

    const response = await this.fetchJson<AsanaTaskResponse>(
      `${ASANA_BASE_URL}/tasks/${encodeURIComponent(taskId)}?${params.toString()}`,
      { method: "GET" },
    );
    return response.data;
  }

  async getProjects({
    workspace,
    limit = 100,
    offset,
  }: {
    workspace?: string;
    limit?: number;
    offset?: string;
  } = {}): Promise<{ projects: AsanaProject[]; nextPage: string | null }> {
    const params = new URLSearchParams();
    params.set("limit", limit.toString());

    if (workspace) params.set("workspace", workspace);
    if (offset) params.set("offset", offset);
    params.set(
      "opt_fields",
      "gid,name,due_on,created_at,modified_at,public,workspace,gid,name",
    );

    const response = await this.fetchJson<AsanaProjectsResponse>(
      `${ASANA_BASE_URL}/projects?${params.toString()}`,
      { method: "GET" },
    );

    return {
      projects: response.data,
      nextPage: response.next_page?.offset ?? null,
    };
  }

  async createTask({
    workspace,
    project,
    name,
    notes,
    due_on,
    assignee,
  }: {
    workspace: string;
    project?: string;
    name: string;
    notes?: string;
    due_on?: string;
    assignee?: string;
  }): Promise<AsanaTask> {
    const params = new URLSearchParams();
    params.set(
      "opt_fields",
      "gid,name,completed,completed_at,created_at,modified_at,due_at,due_on,assignee,name,projects,gid,name,parent,gid,name,custom_fields,gid,name,display_value,type,workspace,gid,name",
    );

    const data: Record<string, unknown> = {
      name,
      workspace,
    };

    if (project) data.projects = [project];
    if (notes) data.notes = notes;
    if (due_on) data.due_on = due_on;
    if (assignee) data.assignee = assignee;

    const body = { data };

    const response = await this.fetchJson<AsanaTaskResponse>(
      `${ASANA_BASE_URL}/tasks?${params.toString()}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    return response.data;
  }

  async updateTask({
    taskId,
    name,
    notes,
    completed,
    due_on,
    assignee,
  }: {
    taskId: string;
    name?: string;
    notes?: string;
    completed?: boolean;
    due_on?: string;
    assignee?: string;
  }): Promise<AsanaTask> {
    const params = new URLSearchParams();
    params.set(
      "opt_fields",
      "gid,name,completed,completed_at,created_at,modified_at,due_at,due_on,assignee,name,projects,gid,name,parent,gid,name,custom_fields,gid,name,display_value,type,workspace,gid,name",
    );

    const data: Record<string, unknown> = {};

    if (name !== undefined) data.name = name;
    if (notes !== undefined) data.notes = notes;
    if (completed !== undefined) data.completed = completed;
    if (due_on !== undefined) data.due_on = due_on;
    if (assignee !== undefined) data.assignee = assignee;

    const body = { data };

    const response = await this.fetchJson<AsanaTaskResponse>(
      `${ASANA_BASE_URL}/tasks/${encodeURIComponent(taskId)}?${params.toString()}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
    return response.data;
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
        "Asana refresh token missing. Please reconnect Asana.",
      );
    }

    const clientId = process.env.ASANA_CLIENT_ID;
    const clientSecret = process.env.ASANA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new AppError(
        "bad_request:api",
        "Asana OAuth is not configured on the server.",
      );
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(ASANA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const body = (await response
      .json()
      .catch(() => ({}))) as AsanaRefreshResponse;

    if (!response.ok || !body.access_token) {
      throw new AppError(
        "unauthorized:api",
        body?.error ?? "Failed to refresh Asana token",
      );
    }

    this.credentials.accessToken = body.access_token;
    this.credentials.refreshToken =
      body.refresh_token ?? this.credentials.refreshToken ?? null;
    this.credentials.expiresAt = body.expires_in
      ? Date.now() + body.expires_in * 1000
      : null;
    this.credentials.tokenType = body.token_type ?? this.credentials.tokenType;
    this.credentials.data = body.data ?? this.credentials.data ?? null;

    await this.persistCredentials();
  }

  private async persistCredentials() {
    if (!this.onCredentialsUpdate) return;
    try {
      await this.onCredentialsUpdate(this.credentials);
    } catch (error) {
      console.warn("[Asana] Failed to persist refreshed credentials", error);
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
        `Asana API request failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }
}
