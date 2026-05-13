/**
 * iMessage self-message listener initialization
 *
 * Automatically starts iMessage self-message listening in Tauri desktop environment
 * Only available on macOS and requires user to have authorized iMessage data source
 */

import {
  startIMessageSelfListener as startIMessageSelfListenerSdk,
  stopIMessageSelfListener as stopIMessageSelfListenerSdk,
} from "./self-message-listener";
import { isIMessageAvailable } from "@openloomi/integrations/imessage";
import { getIntegrationAccountsByUserId } from "@/lib/db/queries";

/**
 * Initialize iMessage self-message listener
 * @param userId User ID
 * @param selfIdentifier User's phone number or email (optional)
 * @param authToken Cloud auth token for API configuration (optional)
 */
export async function initIMessageSelfListener(
  userId: string,
  selfIdentifier?: string,
  authToken?: string,
): Promise<void> {
  try {
    // Check macOS environment
    if (!isIMessageAvailable()) {
      console.log(
        "[iMessage Init] Not macOS environment, skipping iMessage self-message listener",
      );
      return;
    }

    // Check if user has authorized iMessage data source
    const allAccounts = await getIntegrationAccountsByUserId({ userId });
    const imessageAccounts = allAccounts.filter(
      (acc) => acc.platform === "imessage" && acc.status === "active",
    );

    if (imessageAccounts.length === 0) {
      console.log(
        `[iMessage Init] User ${userId} has not authorized iMessage data source, skipping self-message listener`,
      );
      return;
    }

    console.log(
      `[iMessage Init] Found ${imessageAccounts.length} iMessage authorized accounts, starting self-message listener...`,
    );

    // Start listener
    await startIMessageSelfListenerSdk(userId, selfIdentifier, authToken);

    console.log(
      `[iMessage Init] Self-message listener started successfully, user: ${userId}`,
    );
  } catch (error) {
    console.error(
      `[iMessage Init] Failed to start self-message listener, user ${userId}:`,
      error,
    );
  }
}

export async function stopIMessageSelfListener(userId: string): Promise<void> {
  await stopIMessageSelfListenerSdk(userId);
}
