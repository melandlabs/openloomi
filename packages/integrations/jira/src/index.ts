import { AppError } from "@openloomi/shared/errors";

/**
 * Jira API credentials stored in the database
 */
export type JiraStoredCredentials = {
  accessToken?: string | null;
  instanceUrl?: string | null;
  email?: string | null;
  cloudId?: string | null;
};

/**
 * Jira issue type
 */
export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: {
      content?: Array<{
        content?: Array<{
          text?: string;
          type?: string;
        }>;
        type?: string;
      }>;
      type?: string;
      version?: number;
    };
    status?: {
      name: string;
      statusCategory?: {
        key: string;
        name: string;
      };
    };
    priority?: {
      name: string;
      id: string;
    };
    issuetype?: {
      name: string;
      iconUrl?: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    };
    reporter?: {
      displayName: string;
      emailAddress: string;
    };
    created: string;
    updated: string;
    comment?: {
      comments?: Array<{
        id: string;
        body?: {
          content?: Array<{
            content?: Array<{
              text?: string;
              type?: string;
            }>;
            type?: string;
          }>;
          type?: string;
        };
        created: string;
        author?: {
          displayName: string;
          emailAddress: string;
        };
      }>;
      total: number;
    };
  };
}

/**
 * Jira project
 */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  self: string;
}

/**
 * Jira API Adapter for issue tracking and project management
 * Supports Jira Cloud with OAuth 2.0
 */
export class JiraAdapter {
  private storedCredentials: JiraStoredCredentials;
  private instanceUrl: string;

  constructor(options: { credentials: JiraStoredCredentials }) {
    this.storedCredentials = options.credentials ?? {};

    this.instanceUrl =
      this.storedCredentials.instanceUrl ?? "https://api.atlassian.com/ex/jira";

    if (!this.storedCredentials.accessToken) {
      throw new AppError(
        "bad_request:api",
        "Jira access token is missing. Please reconnect your Jira account.",
      );
    }
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.storedCredentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async jiraRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.instanceUrl}/rest/api/3${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        "bad_request:api",
        `Jira API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get issue by key
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.jiraRequest<JiraIssue>(`/issue/${issueKey}`);
  }

  /**
   * Search issues using JQL
   */
  async searchIssues(
    jql: string,
    maxResults = 50,
  ): Promise<{
    issues: JiraIssue[];
    total: number;
    startAt: number;
  }> {
    return this.jiraRequest("/search", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: [
          "summary",
          "description",
          "status",
          "priority",
          "issuetype",
          "assignee",
          "reporter",
          "created",
          "updated",
          "comment",
        ],
      }),
    });
  }

  /**
   * Add comment to an issue
   */
  async addComment(
    issueKey: string,
    body: string,
  ): Promise<{
    id: string;
    self: string;
  }> {
    return this.jiraRequest(`/issue/${issueKey}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: body,
                },
              ],
            },
          ],
        },
      }),
    });
  }

  /**
   * Get comments for an issue
   */
  async getComments(issueKey: string): Promise<JiraIssue["fields"]["comment"]> {
    return this.jiraRequest(`/issue/${issueKey}/comment`);
  }

  /**
   * Get user's projects
   */
  async getProjects(): Promise<JiraProject[]> {
    return this.jiraRequest("/project");
  }

  /**
   * Create a new issue
   */
  async createIssue(options: {
    projectKey: string;
    summary: string;
    description?: string;
    issueType: string;
    priority?: string;
    assigneeId?: string;
  }): Promise<{ key: string; id: string; self: string }> {
    const {
      projectKey,
      summary,
      description,
      issueType,
      priority,
      assigneeId,
    } = options;

    const issueBody: Record<string, unknown> = {
      fields: {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
      },
    };

    if (description) {
      (issueBody.fields as Record<string, unknown>).description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: description,
              },
            ],
          },
        ],
      };
    }

    if (priority) {
      (issueBody.fields as Record<string, unknown>).priority = {
        name: priority,
      };
    }

    if (assigneeId) {
      (issueBody.fields as Record<string, unknown>).assignee = {
        id: assigneeId,
      };
    }

    return this.jiraRequest("/issue", {
      method: "POST",
      body: JSON.stringify(issueBody),
    });
  }

  /**
   * Update issue status
   */
  async transitionIssue(
    issueKey: string,
    transitionName: string,
  ): Promise<void> {
    // First get available transitions
    const transitions = await this.jiraRequest<{
      transitions: Array<{ id: string; name: string }>;
    }>(`/issue/${issueKey}/transitions`);

    const transition = transitions.transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
    );

    if (!transition) {
      throw new AppError(
        "bad_request:api",
        `Transition "${transitionName}" not found for issue ${issueKey}`,
      );
    }

    await this.jiraRequest(`/issue/${issueKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({
        transition: { id: transition.id },
      }),
    });
  }

  /**
   * Search for users assignable to issues
   */
  async searchAssignableUsers(
    query: string,
    projectKey?: string,
  ): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress: string;
    }>
  > {
    const params = new URLSearchParams({
      query,
      maxResults: "20",
    });

    if (projectKey) {
      params.append("projectKey", projectKey);
    }

    return this.jiraRequest(`/user/assignable/search?${params.toString()}`);
  }

  /**
   * Format issue description to plain text
   */
  static formatIssueDescription(
    description?: JiraIssue["fields"]["description"],
  ): string {
    if (!description?.content) return "";

    return description.content
      .map(
        (paragraph) =>
          paragraph.content?.map((text) => text.text || "").join("") || "",
      )
      .join("\n\n");
  }

  /**
   * Format comment body to plain text
   */
  static formatCommentBody(body?: {
    content?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
      type?: string;
    }>;
  }): string {
    if (!body?.content) return "";

    return body.content
      .map(
        (paragraph) =>
          paragraph.content?.map((text) => text.text || "").join("") || "",
      )
      .join("\n\n");
  }
}
