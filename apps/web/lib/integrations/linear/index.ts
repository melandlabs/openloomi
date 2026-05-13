import { AppError } from "@openloomi/shared/errors";
import type { BotWithAccount } from "@/lib/db/queries";
import type { UserType } from "@/app/(auth)/auth";

/**
 * Linear API credentials stored in the database
 */
export type LinearStoredCredentials = {
  accessToken?: string | null;
};

/**
 * Linear issue status
 */
export interface LinearIssueStatus {
  id: string;
  name: string;
  color: string;
  type: string;
}

/**
 * Linear priority
 */
export type LinearPriority =
  | "urgent"
  | "high"
  | "medium"
  | "low"
  | "no_priority";

/**
 * Linear issue
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    color: string;
    type: string;
  };
  priority: LinearPriority;
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  creator: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
  };
  team: {
    id: string;
    name: string;
    key: string;
  };
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  url: string;
}

/**
 * Linear comment
 */
export interface LinearComment {
  id: string;
  body: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Linear project
 */
export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  icon?: string;
  color?: string;
  status: string;
}

/**
 * Linear team
 */
export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
  url: string;
}

/**
 * Linear API Adapter for issue tracking and project management
 * Uses Linear OAuth 2.0 personal access tokens
 */
export class LinearAdapter {
  private botId: string;
  private userId: string;
  private platformAccountId: string | null;
  private storedCredentials: LinearStoredCredentials;
  private readonly LINEAR_API_URL = "https://api.linear.app/graphql";
  private ownerUserId: string | undefined;
  private ownerUserType: UserType | undefined;

  constructor(options: {
    bot: BotWithAccount;
    credentials: LinearStoredCredentials;
    ownerUserId?: string;
    ownerUserType?: UserType;
  }) {
    this.botId = options.bot.id;
    this.userId = options.bot.userId;
    this.platformAccountId = options.bot.platformAccount?.id ?? null;
    this.storedCredentials = options.credentials ?? {};
    this.ownerUserId = options.ownerUserId;
    this.ownerUserType = options.ownerUserType;

    if (!this.storedCredentials.accessToken) {
      throw new AppError(
        "bad_request:api",
        "Linear access token is missing. Please reconnect your Linear account.",
      );
    }
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.storedCredentials.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async linearRequest<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(this.LINEAR_API_URL, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        "bad_request:api",
        `Linear API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      throw new AppError(
        "bad_request:api",
        `Linear GraphQL error: ${data.errors[0].message}`,
      );
    }

    if (!data.data) {
      throw new AppError("bad_request:api", "Linear API returned no data");
    }

    return data.data as T;
  }

  /**
   * Get issue by identifier (e.g., "ENG-123")
   */
  async getIssue(identifier: string): Promise<LinearIssue | null> {
    const data = await this.linearRequest<{
      issue: LinearIssue;
    }>(
      `
      query GetIssue($identifier: String!) {
        issue(identifier: $identifier) {
          id
          identifier
          title
          description
          state {
            id
            name
            color
            type
          }
          priority
          assignee {
            id
            name
            email
          }
          creator {
            id
            name
            email
          }
          project {
            id
            name
          }
          team {
            id
            name
            key
          }
          labels {
            id
            name
            color
          }
          createdAt
          updatedAt
          dueDate
          url
        }
      }
    `,
      { identifier },
    );

    return data.issue;
  }

  /**
   * Search issues with filters
   */
  async searchIssues(filters: {
    teamId?: string;
    projectId?: string;
    status?: string;
    priority?: LinearPriority;
    assigneeId?: string;
    first?: number;
  }): Promise<LinearIssue[]> {
    const {
      teamId,
      projectId,
      status,
      priority,
      assigneeId,
      first = 50,
    } = filters;

    let whereClause = "";
    const conditions: string[] = [];

    if (teamId) {
      conditions.push(`{ team: { id: { eq: "${teamId}" } } }`);
    }
    if (projectId) {
      conditions.push(`{ project: { id: { eq: "${projectId}" } } }`);
    }
    if (status) {
      conditions.push(`{ state: { name: { eq: "${status}" } } }`);
    }
    if (priority) {
      conditions.push(
        `{ priority: { eq: ${this.priorityToNumber(priority)} } }`,
      );
    }
    if (assigneeId) {
      conditions.push(`{ assignee: { id: { eq: "${assigneeId}" } } }`);
    }

    if (conditions.length > 0) {
      whereClause = `where: { AND: [${conditions.join(", ")}] }`;
    }

    const query = `
      query SearchIssues {
        issues(first: ${first}${whereClause ? `, ${whereClause}` : ""}) {
          nodes {
            id
            identifier
            title
            description
            state {
              id
              name
              color
              type
            }
            priority
            assignee {
              id
              name
              email
            }
            creator {
              id
              name
              email
            }
            project {
              id
              name
            }
            team {
              id
              name
              key
            }
            labels {
              id
              name
              color
            }
            createdAt
            updatedAt
            dueDate
            url
          }
        }
      }
    `;

    const data = await this.linearRequest<{ issues: { nodes: LinearIssue[] } }>(
      query,
    );
    return data.issues.nodes;
  }

  /**
   * Add comment to an issue
   */
  async addComment(issueId: string, body: string): Promise<LinearComment> {
    const data = await this.linearRequest<{
      commentCreate: { success: boolean; comment: LinearComment };
    }>(
      `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: {
          issueId: $issueId
          body: $body
        }) {
          success
          comment {
            id
            body
            user {
              id
              name
              email
            }
            createdAt
            updatedAt
          }
        }
      }
    `,
      { issueId, body },
    );

    if (!data.commentCreate.success) {
      throw new AppError("bad_request:api", "Failed to create comment");
    }

    return data.commentCreate.comment;
  }

  /**
   * Get comments for an issue
   */
  async getComments(issueId: string): Promise<LinearComment[]> {
    const data = await this.linearRequest<{
      issue: { comments: { nodes: LinearComment[] } };
    }>(
      `
      query GetComments($issueId: String!) {
        issue(id: $issueId) {
          comments {
            nodes {
              id
              body
              user {
                id
                name
                email
              }
              createdAt
              updatedAt
            }
          }
        }
      }
    `,
      { issueId },
    );

    return data.issue.comments.nodes;
  }

  /**
   * Get user's teams
   */
  async getTeams(): Promise<LinearTeam[]> {
    const data = await this.linearRequest<{
      teams: { nodes: LinearTeam[] };
    }>(
      `
      query GetTeams {
        teams {
          nodes {
            id
            name
            key
            description
            url
          }
        }
      }
    `,
    );

    return data.teams.nodes;
  }

  /**
   * Get projects for a team
   */
  async getProjects(teamId?: string): Promise<LinearProject[]> {
    const query = teamId
      ? `
      query GetProjects($teamId: String!) {
        team(id: $teamId) {
          projects {
            nodes {
              id
              name
              description
              url
              icon
              color
              status
            }
          }
        }
      }
    `
      : `
      query GetProjects {
        projects {
          nodes {
            id
            name
            description
            url
            icon
            color
            status
          }
        }
      }
    `;

    const variables = teamId ? { teamId } : undefined;
    const data = await this.linearRequest<
      | { team: { projects: { nodes: LinearProject[] } } }
      | { projects: { nodes: LinearProject[] } }
    >(query, variables);

    if ("team" in data) {
      return data.team.projects.nodes;
    }
    return data.projects.nodes;
  }

  /**
   * Create a new issue
   */
  async createIssue(options: {
    teamId: string;
    title: string;
    description?: string;
    priority?: LinearPriority;
    assigneeId?: string;
    projectId?: string;
    labelIds?: string[];
  }): Promise<LinearIssue> {
    const {
      teamId,
      title,
      description,
      priority,
      assigneeId,
      projectId,
      labelIds,
    } = options;

    const input: Record<string, unknown> = {
      teamId,
      title,
    };

    if (description) {
      input.description = description;
    }

    if (priority) {
      input.priority = this.priorityToNumber(priority);
    }

    if (assigneeId) {
      input.assigneeId = assigneeId;
    }

    if (projectId) {
      input.projectId = projectId;
    }

    if (labelIds && labelIds.length > 0) {
      input.labelIds = labelIds;
    }

    const data = await this.linearRequest<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(
      `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            state {
              id
              name
              color
              type
            }
            priority
            assignee {
              id
              name
              email
            }
            creator {
              id
              name
              email
            }
            project {
              id
              name
            }
            team {
              id
              name
              key
            }
            labels {
              id
              name
              color
            }
            createdAt
            updatedAt
            dueDate
            url
          }
        }
      }
    `,
      { input },
    );

    if (!data.issueCreate.success) {
      throw new AppError("bad_request:api", "Failed to create issue");
    }

    return data.issueCreate.issue;
  }

  /**
   * Update issue state
   */
  async updateIssueState(
    issueId: string,
    stateId: string,
  ): Promise<LinearIssue> {
    const data = await this.linearRequest<{
      issueUpdate: { success: boolean; issue: LinearIssue };
    }>(
      `
      mutation UpdateIssueState($issueId: String!, $stateId: String!) {
        issueUpdate(input: {
          id: $issueId
          stateId: $stateId
        }) {
          success
          issue {
            id
            identifier
            title
            state {
              id
              name
              color
              type
            }
          }
        }
      }
    `,
      { issueId, stateId },
    );

    if (!data.issueUpdate.success) {
      throw new AppError("bad_request:api", "Failed to update issue state");
    }

    return data.issueUpdate.issue;
  }

  /**
   * Get available states for a team
   */
  async getWorkflowStates(teamId: string): Promise<LinearIssueStatus[]> {
    const data = await this.linearRequest<{
      team: { states: { nodes: LinearIssueStatus[] } };
    }>(
      `
      query GetWorkflowStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes {
              id
              name
              color
              type
            }
          }
        }
      }
    `,
      { teamId },
    );

    return data.team.states.nodes;
  }

  /**
   * Search users
   */
  async searchUsers(
    query: string,
    teamId?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
    }>
  > {
    const data = await this.linearRequest<{
      users: { nodes: Array<{ id: string; name: string; email: string }> };
    }>(
      `
      query SearchUsers($query: String!, $teamId: String) {
        users(filter: { query: $query, teamId: $teamId }) {
          nodes {
            id
            name
            email
          }
        }
      }
    `,
      { query, teamId },
    );

    return data.users.nodes;
  }

  /**
   * Convert priority string to Linear API number
   */
  private priorityToNumber(priority: LinearPriority): number {
    const priorityMap: Record<LinearPriority, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
      no_priority: 0,
    };
    return priorityMap[priority] ?? 0;
  }

  /**
   * Convert priority number to Linear API string
   */
  static numberToPriority(priority: number): LinearPriority {
    const priorityMap: Record<number, LinearPriority> = {
      4: "urgent",
      3: "high",
      2: "medium",
      1: "low",
      0: "no_priority",
    };
    return priorityMap[priority] ?? "no_priority";
  }
}
