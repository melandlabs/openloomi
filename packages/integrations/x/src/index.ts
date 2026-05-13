import { Client, ApiError } from "@xdevplatform/xdk";
import { AppError } from "@openloomi/shared/errors";
import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";
import type { Messages } from "@openloomi/integrations/channels";

type XAdapterOptions = {
  botId: string;
  accessToken: string;
  userId: string;
  username?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  clientId?: string;
  clientSecret?: string;
  onCredentialsUpdated?: (credentials: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
  }) => Promise<void>;
};

type XDMMessage = {
  id: string;
  text?: string;
  event_time?: string;
  sender_id?: string;
};

type XDMConversation = {
  conversation_id: string;
  messages?: XDMMessage[];
  participants?: { user_id: string }[];
};

export class XAdapter {
  private client: Client;
  private userId: string;
  private username?: string | null;
  private botId: string;
  private refreshToken: string | null;
  private expiresAt: number | null;
  private clientId?: string;
  private clientSecret?: string;
  private onCredentialsUpdated?:
    | ((credentials: {
        accessToken: string;
        refreshToken?: string | null;
        expiresAt?: number | null;
      }) => Promise<void>)
    | undefined;

  constructor(options: XAdapterOptions) {
    this.userId = options.userId;
    this.username = options.username ?? null;
    this.botId = options.botId;
    this.refreshToken = options.refreshToken ?? null;
    this.expiresAt = options.expiresAt ?? null;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.onCredentialsUpdated = options.onCredentialsUpdated;
    this.client = new Client({ accessToken: options.accessToken });
  }

  /**
   * Check if the access token is expired or about to expire (within 5 minutes).
   */
  private isTokenExpiringSoon(): boolean {
    if (!this.expiresAt) return false;
    return this.expiresAt - Date.now() < 5 * 60 * 1000;
  }

  /**
   * Ensure we have a valid access token, refreshing if necessary.
   */
  private async ensureAccessToken(): Promise<string> {
    if (!this.isTokenExpiringSoon()) {
      const token = this.client.accessToken;
      if (!token) {
        throw new AppError(
          "unauthorized:x_token_expired",
          `Bot ${this.botId}: X access token is missing.`,
        );
      }
      return token;
    }
    return this.refreshAccessToken();
  }

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      console.warn(
        `[Bot ${this.botId}] No refresh token available for X, cannot refresh.`,
      );
      const token = this.client.accessToken;
      if (!token) {
        throw new AppError(
          "unauthorized:x_token_expired",
          `Bot ${this.botId}: X access token is missing and cannot be refreshed.`,
        );
      }
      return token;
    }

    console.log(`[Bot ${this.botId}] Refreshing X access token...`);

    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      const response = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        },
        body: params,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[Bot ${this.botId}] X token refresh failed (${response.status}): ${text}`,
        );
        const token = this.client.accessToken;
        if (!token) {
          throw new AppError(
            "unauthorized:x_token_expired",
            `Bot ${this.botId}: X access token is missing after refresh failure.`,
          );
        }
        return token;
      }

      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const newAccessToken =
        data.access_token ??
        this.client.accessToken ??
        (() => {
          throw new AppError(
            "unauthorized:x_token_expired",
            `Bot ${this.botId}: X access token is missing (both new and existing).`,
          );
        })();
      const newRefreshToken = data.refresh_token ?? this.refreshToken;
      const newExpiresAt = data.expires_in
        ? Date.now() + data.expires_in * 1000
        : this.expiresAt;

      // Update in-memory state
      this.client = new Client({ accessToken: newAccessToken });
      this.refreshToken = newRefreshToken;
      this.expiresAt = newExpiresAt ?? null;

      // Persist updated credentials to DB
      if (this.onCredentialsUpdated) {
        try {
          await this.onCredentialsUpdated({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresAt: newExpiresAt ?? undefined,
          });
        } catch (err) {
          console.error(
            `[Bot ${this.botId}] Failed to persist refreshed X credentials:`,
            err,
          );
        }
      }

      console.log(`[Bot ${this.botId}] X access token refreshed successfully.`);
      return newAccessToken;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] X token refresh threw an error:`,
        error,
      );
      const token = this.client.accessToken;
      if (!token) {
        throw new AppError(
          "unauthorized:x_token_expired",
          `Bot ${this.botId}: X access token is missing after refresh error.`,
        );
      }
      return token;
    }
  }

  /**
   * Wrap SDK calls to handle ApiError → AppError conversion.
   */
  private async withTokenRefresh<T>(
    fn: () => Promise<T>,
    name: string,
  ): Promise<T> {
    await this.ensureAccessToken();
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(
          `[Bot ${this.botId}] X SDK error (${name}): ${error.status} ${error.statusText}`,
        );
        console.error(
          `[Bot ${this.botId}] X SDK error data:`,
          JSON.stringify(error.data, null, 2),
        );
        if (error.status === 401) {
          throw new AppError(
            "unauthorized:x_token_expired",
            "X access token expired. Please reconnect X in Settings > Integrations.",
          );
        }
        const data = error.data as
          | { detail?: string; title?: string; errors?: unknown[] }
          | undefined;
        const errorMsg =
          data?.detail ?? data?.title ?? `X API error (${error.status})`;
        if (data?.errors && Array.isArray(data.errors)) {
          console.error(
            `[Bot ${this.botId}] X API errors:`,
            JSON.stringify(data.errors, null, 2),
          );
        }
        throw new AppError("bad_request:bot", `X API error: ${errorMsg}`);
      }
      throw error;
    }
  }

  async getMessagesByTime(since: number): Promise<ExtractedMessageInfo[]> {
    const token = await this.ensureAccessToken();
    const fetchWithToken = async <T>(
      path: string,
      params?: Record<string, string>,
    ): Promise<T> => {
      const search = params ? `?${new URLSearchParams(params).toString()}` : "";
      const url = `https://api.twitter.com/2/${path}${search}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const text = await response.text();
        console.error(`[Bot ${this.botId}] X API error ${path}: ${text}`);
        if (response.status === 401) {
          throw new AppError(
            "unauthorized:x_token_expired",
            "X access token expired. Please reconnect X in Settings > Integrations.",
          );
        }
        throw new AppError(
          "bad_request:bot",
          `X API failed (${response.status})`,
        );
      }
      return response.json() as Promise<T>;
    };

    const conversationsResponse = await fetchWithToken<{
      data?: XDMConversation[];
    }>("dm_conversations/with", { max_results: "20" }).catch(() => ({
      data: [],
    }));

    const conversations = conversationsResponse.data ?? [];
    const result: ExtractedMessageInfo[] = [];

    for (const convo of conversations) {
      const convoId = convo.conversation_id;
      if (!convoId) continue;
      const messagesResp = await fetchWithToken<{ data?: XDMMessage[] }>(
        `dm_conversations/${convoId}/messages`,
        { max_results: "50" },
      ).catch(() => ({ data: [] }));

      const messages = messagesResp.data ?? [];
      for (const message of messages) {
        const created = message.event_time
          ? new Date(message.event_time).getTime()
          : Date.now();
        if (created < since * 1000) continue;

        const senderId = message.sender_id ?? "";
        const isSelf = senderId === this.userId;
        const sender =
          isSelf && this.username
            ? this.username
            : isSelf
              ? "Me"
              : senderId || "X User";
        const chatName = `DM ${convoId}`;

        result.push({
          chatType: "private",
          chatName,
          sender,
          text: message.text ?? "",
          timestamp: Math.floor(created / 1000),
          attachments: [],
        });
      }
    }

    return result;
  }

  async sendMessages(
    _channel: "private",
    recipients: string[],
    messages: Messages,
  ): Promise<void> {
    if (recipients.length === 0) {
      throw new AppError("bad_request:bot", "No X DM recipient provided.");
    }
    const textPart = messages.find(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    if (!textPart) {
      throw new AppError("bad_request:bot", "X DM requires text content.");
    }

    const body = {
      direct_message: {
        text: textPart,
      },
    };

    const token = await this.ensureAccessToken();
    for (const recipient of recipients) {
      const response = await fetch(
        `https://api.twitter.com/2/dm_conversations/with/${recipient}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[Bot ${this.botId}] X DM send failed: ${response.status} ${text}`,
        );
        if (response.status === 401) {
          throw new AppError(
            "unauthorized:x_token_expired",
            "X access token expired. Please reconnect X in Settings > Integrations.",
          );
        }
        throw new AppError(
          "bad_request:bot",
          `X DM send failed (${response.status})`,
        );
      }
    }
  }

  async kill(): Promise<void> {
    // nothing to cleanup
  }

  // ============ Tweet Operations ============

  /**
   * Post a new tweet (text only)
   */
  async postTweet(text: string): Promise<{ id: string; text: string }> {
    console.log(
      `[X postTweet] userId=${this.userId} username=${this.username} botId=${this.botId}`,
    );
    return this.withTokenRefresh(async () => {
      const result = await this.client.posts.create({ text });
      if (result.errors?.length) {
        const err = result.errors[0];
        console.error(`[X postTweet] failed: ${JSON.stringify(err)}`);
        throw new AppError(
          "bad_request:bot",
          `X postTweet failed: ${err.detail ?? JSON.stringify(err)}`,
        );
      }
      const data = result.data as { id: string; text: string } | undefined;
      if (!data) {
        throw new AppError("bad_request:bot", "X postTweet returned no data");
      }
      return data;
    }, "posts.create");
  }

  /**
   * Post a tweet with images
   */
  async postTweetWithMedia(
    text: string,
    mediaIds: string[],
  ): Promise<{ id: string; text: string }> {
    return this.withTokenRefresh(async () => {
      const result = await this.client.posts.create({
        text,
        media: { media_ids: mediaIds },
      });
      if (result.errors?.length) {
        const err = result.errors[0];
        console.error(
          `[Bot ${this.botId}] X postTweetWithMedia failed: ${JSON.stringify(err)}`,
        );
        throw new AppError(
          "bad_request:bot",
          `X postTweetWithMedia failed: ${err.detail ?? JSON.stringify(err)}`,
        );
      }
      const data = result.data as { id: string; text: string } | undefined;
      if (!data) {
        throw new AppError(
          "bad_request:bot",
          "X postTweetWithMedia returned no data",
        );
      }
      return data;
    }, "posts.create");
  }

  /**
   * Upload media to X and return media ID
   */
  async uploadMedia(mediaUrl: string): Promise<string> {
    return mediaUrl;
  }

  /**
   * Get user's timeline (recent tweets)
   */
  async getTimeline(maxResults = 20): Promise<
    Array<{
      id: string;
      text: string;
      authorId: string;
      createdAt: string;
    }>
  > {
    return this.withTokenRefresh(async () => {
      const result = await this.client.users.getTimeline(this.userId, {
        maxResults,
        tweetFields: ["createdAt", "authorId"],
      });
      return (result.data ?? []).map((tweet: any) => ({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.authorId ?? tweet.author_id ?? "",
        createdAt: tweet.createdAt ?? tweet.created_at ?? "",
      }));
    }, "users.getTimeline");
  }

  /**
   * Search tweets by query
   */
  async searchTweets(
    query: string,
    maxResults = 20,
  ): Promise<
    Array<{
      id: string;
      text: string;
      authorId: string;
      createdAt: string;
    }>
  > {
    // Twitter API requires max_results between 10 and 100
    const clampedMaxResults = Math.max(10, Math.min(100, maxResults));
    const token = await this.ensureAccessToken();
    const response = await this.client.httpClient.get(
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${clampedMaxResults}&tweet.fields=created_at,author_id`,
      { Authorization: `Bearer ${token}` },
    );
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Bot ${this.botId}] X searchTweets failed: ${text}`);
      throw new AppError(
        "bad_request:bot",
        `X searchTweets failed (${response.status})`,
      );
    }
    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        created_at: string;
      }>;
    };
    return (data.data ?? []).map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      createdAt: tweet.created_at,
    }));
  }

  /**
   * Get user's notifications
   */
  async getNotifications(maxResults = 20): Promise<
    Array<{
      id: string;
      type: string;
      text: string;
      createdAt: string;
    }>
  > {
    const token = await this.ensureAccessToken();
    const response = await this.client.httpClient.get(
      `https://api.twitter.com/2/users/${this.userId}/notifications?max_results=${maxResults}`,
      { Authorization: `Bearer ${token}` },
    );
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Bot ${this.botId}] X getNotifications failed: ${text}`);
      throw new AppError(
        "bad_request:bot",
        `X getNotifications failed (${response.status})`,
      );
    }
    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        type: string;
        message?: { text: string };
        created_at: string;
      }>;
    };
    return (data.data ?? []).map((notif) => ({
      id: notif.id,
      type: notif.type,
      text: notif.message?.text ?? "",
      createdAt: notif.created_at,
    }));
  }

  /**
   * Reply to a tweet
   */
  async replyTo(
    tweetId: string,
    text: string,
  ): Promise<{ id: string; text: string }> {
    return this.withTokenRefresh(async () => {
      const result = await this.client.posts.create({
        text,
        reply: { inReplyToTweetId: tweetId },
      });
      if (result.errors?.length) {
        const err = result.errors[0];
        console.error(
          `[Bot ${this.botId}] X replyTo failed: ${JSON.stringify(err)}`,
        );
        throw new AppError(
          "bad_request:bot",
          `X replyTo failed: ${err.detail ?? JSON.stringify(err)}`,
        );
      }
      const data = result.data as { id: string; text: string } | undefined;
      if (!data) {
        throw new AppError("bad_request:bot", "X replyTo returned no data");
      }
      return data;
    }, "posts.create (reply)");
  }

  /**
   * Retweet a tweet
   */
  async retweet(tweetId: string): Promise<{ retweeted: boolean }> {
    return this.withTokenRefresh(async () => {
      const result = await this.client.users.repostPost(this.userId, {
        body: { tweetId },
      });
      if (result.errors?.length) {
        const err = result.errors[0];
        console.error(
          `[Bot ${this.botId}] X retweet failed: ${JSON.stringify(err)}`,
        );
        throw new AppError(
          "bad_request:bot",
          `X retweet failed: ${err.detail ?? JSON.stringify(err)}`,
        );
      }
      return { retweeted: true };
    }, "users.repostPost");
  }

  /**
   * Like a tweet
   */
  async likeTweet(tweetId: string): Promise<{ liked: boolean }> {
    return this.withTokenRefresh(async () => {
      const result = await this.client.users.likePost(this.userId, {
        body: { tweetId },
      });
      if (result.errors?.length) {
        const err = result.errors[0];
        console.error(
          `[Bot ${this.botId}] X likeTweet failed: ${JSON.stringify(err)}`,
        );
        throw new AppError(
          "bad_request:bot",
          `X likeTweet failed: ${err.detail ?? JSON.stringify(err)}`,
        );
      }
      return { liked: true };
    }, "users.likePost");
  }

  /**
   * Get user profile
   */
  async getProfile(): Promise<{
    id: string;
    username: string;
    name: string;
    bio?: string;
    followersCount: number;
    followingCount: number;
    tweetCount: number;
  }> {
    return this.withTokenRefresh(async () => {
      const result = await this.client.users.getById(this.userId, {
        userFields: ["publicMetrics", "description"],
      });
      const user = result.data as any;
      if (!user) {
        throw new AppError("bad_request:bot", "X getProfile returned no data");
      }
      return {
        id: user.id,
        username: user.username ?? "",
        name: user.name ?? "",
        bio: user.description,
        followersCount:
          user.publicMetrics?.followersCount ??
          user.public_metrics?.followers_count ??
          0,
        followingCount:
          user.publicMetrics?.followingCount ??
          user.public_metrics?.following_count ??
          0,
        tweetCount:
          user.publicMetrics?.tweetCount ??
          user.public_metrics?.tweet_count ??
          0,
      };
    }, "users.getById");
  }
}
