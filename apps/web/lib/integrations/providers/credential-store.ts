/**
 * CredentialStore implementation for apps/web
 *
 * Provides implementations of CredentialStore interface from @openloomi/integrations/core
 * using the database queries from apps/web.
 */

import type { PlatformId } from "@openloomi/integrations/core";
import type { IntegrationId } from "@/lib/integrations/client";
import {
  getIntegrationAccountsByUserId,
  getIntegrationAccountByPlatform,
  getIntegrationAccountById,
  updateIntegrationAccount,
  upsertIntegrationAccount,
} from "@/lib/db/queries";
import {
  rotateCredentials as doRotateCredentials,
  getCredentialRotationHistory,
  revertToPreviousCredential,
  type RotationHistoryEntry,
} from "@/lib/credentials/rotation-service";

/**
 * Implementation of CredentialStore that uses apps/web database queries
 */
export class WebCredentialStore {
  /**
   * Get all integration accounts for a user
   */
  async getAccountsByUserId(userId: string) {
    return getIntegrationAccountsByUserId({ userId });
  }

  /**
   * Get integration account by platform for a user
   */
  async getAccountByPlatform(userId: string, platform: PlatformId) {
    return getIntegrationAccountByPlatform({
      userId,
      platform: platform as IntegrationId,
    });
  }

  /**
   * Get integration account by ID
   */
  async getAccountById(userId: string, platformAccountId: string) {
    return getIntegrationAccountById({ userId, platformAccountId });
  }

  /**
   * Update integration account credentials/metadata/status
   */
  async updateAccount(params: {
    userId: string;
    platformAccountId: string;
    status?: string;
    credentials?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await updateIntegrationAccount(params);
  }

  /**
   * Create a new integration account
   */
  async createAccount(params: {
    userId: string;
    platform: PlatformId;
    platformAccountId?: string | null;
    status?: string;
    credentials?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }) {
    // Generate a platform-specific externalId if not provided
    const externalId =
      params.platformAccountId ??
      `${params.platform}-${params.userId}-${Date.now()}`;
    const displayName = `${params.platform} Account`;

    return upsertIntegrationAccount({
      userId: params.userId,
      platform: params.platform as IntegrationId,
      externalId,
      displayName,
      credentials: params.credentials ?? {},
      metadata: params.metadata ?? null,
      status: params.status ?? "active",
    });
  }

  /**
   * Rotate credentials for an integration account
   *
   * @param params - Rotation parameters including accountId, userId, new credentials, and optional reason
   */
  async rotateCredentials(params: {
    accountId: string;
    userId: string;
    newCredentials: Record<string, unknown>;
    reason?: string;
  }): Promise<void> {
    await doRotateCredentials({
      ...params,
      rotatedBy: params.userId,
    });
  }

  /**
   * Get rotation history for an integration account
   *
   * @param accountId - The account ID to get history for
   * @returns Array of rotation history entries
   */
  async getRotationHistory(accountId: string): Promise<RotationHistoryEntry[]> {
    return getCredentialRotationHistory(accountId);
  }

  /**
   * Revert to a previous credential from rotation history
   *
   * @param accountId - The account ID
   * @param historyId - The rotation history entry ID to revert to
   * @param userId - The user performing the revert
   */
  async revertToPreviousCredential(
    accountId: string,
    historyId: string,
    userId: string,
  ): Promise<void> {
    await revertToPreviousCredential(accountId, historyId, userId);
  }
}

/**
 * Singleton instance of WebCredentialStore
 */
export const credentialStore = new WebCredentialStore();
