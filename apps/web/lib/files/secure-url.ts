/**
 * Generate secure file access URL
 * All files are accessed via backend proxy to ensure permission checking
 */

import { DEV_PORT, PROD_PORT } from "@openloomi/shared";
import type { Attachment } from "@openloomi/shared";

/**
 * Get current application base URL
 * Supports both server-side and client-side
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    // Client-side: use current page's origin
    return window.location.origin;
  }

  // Server-side: use environment variables
  const isDevelopment = process.env.NODE_ENV === "development";
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    `http://localhost:${isDevelopment ? DEV_PORT : PROD_PORT}`
  );
}

/**
 * Check if URL is an external platform URL that needs proxy (e.g., platforms requiring authentication)
 * These platform URLs typically require authentication or are time-sensitive, cannot be loaded directly in browser
 */
function isExternalPlatformUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const externalHosts = [
      "t.me",
      "telegram.org",
      "api.telegram.org",
      "files.slack.com",
      "slack.com",
      "discord.com",
      "discordapp.com",
      "cdn.discordapp.com",
      "mail.google.com",
      "gmail.com",
    ];
    return externalHosts.some(
      (host) =>
        parsed.hostname.includes(host) || parsed.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/**
 * Get secure file download URL (via backend proxy)
 * @param attachment - Attachment object
 * @returns Secure file URL, returns empty string for external URLs that cannot be loaded directly
 */
export function getSecureFileUrl(attachment: Attachment): string {
  const { url, blobPath, pathname, downloadUrl } = attachment as {
    url?: string | null;
    blobPath?: string | null;
    pathname?: string | null;
    downloadUrl?: string | null;
  };

  // Check if it's Vercel Blob URL, if so use original URL (with signature, time-sensitive)
  // No need for backend proxy, as Vercel Blob URL already includes access permission and time control
  // Check this condition first to ensure Vercel Blob URLs are handled correctly
  if (url && isVercelBlobUrl(url)) {
    return url;
  }

  // Use known paths first (filter out empty strings)
  const filePath = blobPath || pathname || null;

  if (!filePath || filePath.trim().length === 0) {
    // If no path, try to extract from URL
    if (url && isVercelBlobUrl(url)) {
      const path = extractPathFromBlobUrl(url);
      if (path) {
        return `${getBaseUrl()}/api/files/download?path=${encodeURIComponent(path)}`;
      }
    }

    // For external platform URLs, don't use directly (needs backend proxy or has expired)
    // Return empty string to let component fall back to icon display
    const fallbackUrl = url || downloadUrl || "";
    if (fallbackUrl && isExternalPlatformUrl(fallbackUrl)) {
      return "";
    }

    return fallbackUrl;
  }

  // For local storage or other files requiring permission checking, return proxy URL
  return `${getBaseUrl()}/api/files/download?path=${encodeURIComponent(filePath)}`;
}

/**
 * Check if it's Vercel Blob URL
 */
function isVercelBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("vercel-storage.com") ||
      parsed.hostname.includes("blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

/**
 * Extract path from Vercel Blob URL
 */
function extractPathFromBlobUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    // Remove leading slash
    return path.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}
