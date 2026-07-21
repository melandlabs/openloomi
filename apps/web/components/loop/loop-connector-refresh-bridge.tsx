"use client";

/**
 * Bridge that force-refreshes the Loop connector snapshot whenever a
 * Composio OAuth flow completes anywhere in the app (#411).
 *
 * The `integration:accountAuthorized` CustomEvent is dispatched by
 * `apps/web/lib/integrations/client.ts` after a successful OAuth
 * round-trip (Linear, GitHub, Slack, etc.). Previously, the only
 * listeners were page-scoped: the `/connectors` page itself and the
 * Home component's `mutateIntegrations() + sendMessage("continue")`
 * retry. Neither refreshed the Loop's connector snapshot — that
 * snapshot lived on a 24h disk cache (`CACHE_TTL_MS` in
 * `connectors.ts`) which made OAuth-success-but-OFF the default state
 * for up to a day after a connection change.
 *
 * Now that the CLI direct probe resolves the same question in ~200ms
 * (see `composio-cli.ts::probeViaCli`), we can fire a force-refresh
 * on every OAuth completion with no perceptible latency. The fetch
 * hits `POST /api/loop/connectors { refresh: true }` which always
 * bypasses the cache; the trailing SWR `mutate` revalidates any
 * mounted `useLoopConnectors()` consumers so the `/connectors` page,
 * the pet status card, and the connector-capability badges all
 * repaint without a manual reload.
 *
 * Why a bridge at the (chat) layout (not in Home or on the page):
 *   The OAuth callback can resolve while the user is on `/chat`,
 *   `/inbox`, `/connectors`, `/loop/<id>` etc. — anywhere the auth
 *   dialog might have been opened. Mounting the listener at the
 *   layout level (sibling of `LoopNavBridge` and `PetChatBridge`)
 *   covers the entire (chat) tree in one place.
 *
 * Failures are swallowed silently: the next explicit refresh or tick
 * will pick up the new state anyway, and surfacing an error toast on
 * every OAuth completion would be noisy. The `lastProbeError` from
 * `writeProbeError` (#391) remains the canonical diagnostic surface.
 */

import { useEffect } from "react";
import { mutate as mutateSWR } from "swr";

import { getAuthToken } from "@/lib/auth/token-manager";

const KEY = "/api/loop/connectors";

export function LoopConnectorRefreshBridge() {
  useEffect(() => {
    const handler = async () => {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (typeof window !== "undefined") {
        const token = getAuthToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
      try {
        await fetch(KEY, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ refresh: true }),
        });
      } catch {
        // Swallow — the next tick or explicit refresh will retry.
      } finally {
        // Revalidate any mounted `useLoopConnectors()` consumers
        // regardless of fetch outcome so a transient network blip
        // doesn't strand the UI on stale cache.
        await mutateSWR(KEY);
      }
    };
    window.addEventListener("integration:accountAuthorized", handler);
    return () =>
      window.removeEventListener("integration:accountAuthorized", handler);
  }, []);
  return null;
}
