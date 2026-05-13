/**
 * ConfigProvider implementation for apps/web
 *
 * Implements the ConfigProvider interface from @openloomi/integrations/core
 * using environment variables from apps/web.
 */

import type { AppConfigProvider } from "@openloomi/integrations/core";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { getAppMemoryDir } from "@/lib/utils/path";

/**
 * Implementation of AppConfigProvider that uses environment variables
 */
export class WebConfigProvider implements AppConfigProvider {
  /**
   * Get an environment variable
   */
  get(key: string): string | undefined {
    return process.env[key];
  }

  /**
   * Get a required environment variable (throws if not set)
   */
  getRequired(key: string): string {
    const value = process.env[key];
    if (value === undefined || value === "") {
      throw new Error(`Config key "${key}" is not configured`);
    }
    return value;
  }

  /**
   * Get the default AI model identifier
   */
  getDefaultAIModel(): string {
    return DEFAULT_AI_MODEL;
  }

  /**
   * Get the AI proxy base URL
   */
  getAIProxyBaseUrl(): string {
    return AI_PROXY_BASE_URL ?? "";
  }

  /**
   * Get the application memory directory path
   */
  getAppMemoryDir(): string {
    return getAppMemoryDir();
  }
}

/**
 * Singleton instance of WebConfigProvider
 */
export const configProvider = new WebConfigProvider();
