import "server-only";

import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { AppError } from "@openloomi/shared/errors";
import {
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
  updateIntegrationAccount,
  type IntegrationAccountWithBot,
} from "@/lib/db/queries";

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export type GoogleDriveStoredCredentials = {
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  expiryDate?: number | null;
};

type DriveClientContext = {
  account: IntegrationAccountWithBot;
  oauth2Client: OAuth2Client;
  storedCredentials: GoogleDriveStoredCredentials;
};

export type UploadedGoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink?: string | null;
  webContentLink?: string | null;
  iconLink?: string | null;
};

function resolveDriveCredentialsUpdate(
  previous: GoogleDriveStoredCredentials,
  next: OAuth2Client["credentials"],
): GoogleDriveStoredCredentials {
  return {
    accessToken: next.access_token ?? previous.accessToken ?? null,
    refreshToken: next.refresh_token ?? previous.refreshToken ?? null,
    scope: next.scope ?? previous.scope ?? null,
    tokenType: next.token_type ?? previous.tokenType ?? null,
    expiryDate: next.expiry_date ?? previous.expiryDate ?? null,
  };
}

function credentialsChanged(
  a: GoogleDriveStoredCredentials,
  b: GoogleDriveStoredCredentials,
): boolean {
  return (
    (a.accessToken ?? null) !== (b.accessToken ?? null) ||
    (a.refreshToken ?? null) !== (b.refreshToken ?? null) ||
    (a.scope ?? null) !== (b.scope ?? null) ||
    (a.tokenType ?? null) !== (b.tokenType ?? null) ||
    (a.expiryDate ?? null) !== (b.expiryDate ?? null)
  );
}

async function resolveDriveClient(userId: string): Promise<DriveClientContext> {
  const account = await getIntegrationAccountByPlatform({
    userId,
    platform: "google_drive",
  });

  if (!account) {
    throw new AppError(
      "forbidden:api",
      "Google Drive is not connected. Connect your account to continue.",
    );
  }

  const storedCredentials =
    loadIntegrationCredentials<GoogleDriveStoredCredentials>(account) ?? {};

  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new AppError(
      "bad_request:api",
      "Google Drive integration is not configured. Please contact support.",
    );
  }

  const refreshToken =
    storedCredentials.refreshToken ?? process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new AppError(
      "forbidden:auth",
      "Google Drive authorization has expired. Reconnect your account to continue.",
    );
  }

  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI ?? "";

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: storedCredentials.accessToken ?? undefined,
    scope: storedCredentials.scope ?? undefined,
    token_type: storedCredentials.tokenType ?? undefined,
    expiry_date: storedCredentials.expiryDate ?? undefined,
  });

  return { account, oauth2Client, storedCredentials };
}

async function persistDriveCredentials(context: DriveClientContext) {
  const { oauth2Client, storedCredentials, account } = context;
  const nextCredentials = resolveDriveCredentialsUpdate(
    storedCredentials,
    oauth2Client.credentials,
  );

  if (credentialsChanged(storedCredentials, nextCredentials)) {
    await updateIntegrationAccount({
      userId: account.userId,
      platformAccountId: account.id,
      credentials: nextCredentials,
    });
    context.storedCredentials = nextCredentials;
  }
}

function buildDownloadLink(file: drive_v3.Schema$File): string | null {
  if (file.webContentLink) {
    return file.webContentLink;
  }
  if (file.id) {
    return `https://drive.google.com/uc?id=${file.id}&export=download`;
  }
  return null;
}

export async function uploadFileToGoogleDrive({
  userId,
  fileName,
  mimeType,
  data,
  folderId,
}: {
  userId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  folderId?: string | null;
}): Promise<UploadedGoogleDriveFile> {
  const context = await resolveDriveClient(userId);

  const drive = google.drive({
    version: "v3",
    auth: context.oauth2Client,
  });

  const requestBody: drive_v3.Schema$File = {
    name: fileName,
    mimeType,
  };

  if (folderId) {
    requestBody.parents = [folderId];
  }

  const media = {
    mimeType,
    body: Readable.from(data),
  };

  const response = await drive.files.create({
    requestBody,
    media,
    fields: "id, name, mimeType, size, webViewLink, webContentLink, iconLink",
    supportsAllDrives: false,
  });

  const file = response.data;

  if (!file.id) {
    throw new AppError(
      "bad_request:api",
      "Google Drive did not return a file identifier.",
    );
  }

  await persistDriveCredentials(context);

  return {
    id: file.id,
    name: file.name ?? fileName,
    mimeType: file.mimeType ?? mimeType,
    sizeBytes: file.size
      ? Number.parseInt(file.size, 10) || data.length
      : data.length,
    webViewLink:
      file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    webContentLink: buildDownloadLink(file),
    iconLink: file.iconLink ?? null,
  };
}

export async function deleteGoogleDriveFile({
  userId,
  fileId,
}: {
  userId: string;
  fileId: string;
}) {
  const context = await resolveDriveClient(userId);

  const drive = google.drive({
    version: "v3",
    auth: context.oauth2Client,
  });

  await drive.files
    .delete({
      fileId,
      supportsAllDrives: false,
    })
    .catch((error: any) => {
      throw new AppError(
        "bad_request:api",
        `Failed to delete file from Google Drive: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

  await persistDriveCredentials(context);
}
