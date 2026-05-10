/**
 * Insight weight data related custom hook
 * Used to batch fetch weight multipliers and last viewed time for Insights
 */

import { useEffect, useMemo, useState } from "react";

/**
 * Weights response type
 */
interface WeightsResponse {
  weights: Record<string, number>;
  lastViewedAt?: Record<string, string>;
}

/**
 * Insight weight hook return value
 */
interface UseInsightWeightsReturn {
  weightMultipliers: Map<string, number>;
  lastViewedAtMap: Map<string, Date>;
  isLoading: boolean;
  error: Error | null;
  refreshWeights: () => Promise<void>;
}

/**
 * Insight weight data related custom hook
 *
 * @param insightIds - Array of Insight IDs to fetch weights for
 * @returns Weight data and related state
 *
 * @example
 * const { weightMultipliers, lastViewedAtMap, isLoading } = useInsightWeights(insightIds);
 *
 * // Use weight and view time in sorting (for gradual degradation)
 * const sorted = sortInsightsByEventRank(insights, {
 *   weightMultipliers,
 *   lastViewedAtMap
 * });
 */
export function useInsightWeights(
  insightIds: string[],
): UseInsightWeightsReturn {
  const [weightMultipliers, setWeightMultipliers] = useState<
    Map<string, number>
  >(new Map());
  const [lastViewedAtMap, setLastViewedAtMap] = useState<Map<string, Date>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0); // Used to trigger re-fetch

  // Dedupe and stabilize insightIds to avoid re-fetching when callers create
  // a new array instance with the same IDs on every render.
  const insightIdsKey = [...new Set(insightIds)].sort().join("\u0000");
  const memoizedInsightIds = useMemo(() => {
    return insightIdsKey ? insightIdsKey.split("\u0000") : [];
  }, [insightIdsKey]);

  useEffect(() => {
    let isMounted = true;

    async function fetchWeights() {
      if (memoizedInsightIds.length === 0) {
        setWeightMultipliers((prev) => (prev.size === 0 ? prev : new Map()));
        setLastViewedAtMap((prev) => (prev.size === 0 ? prev : new Map()));
        setIsLoading((prev) => (prev ? false : prev));
        setError((prev) => (prev === null ? prev : null));
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/insights/weights", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            insightIds: memoizedInsightIds,
          }),
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch weights: ${response.statusText}`);
        }

        const data = (await response.json()) as WeightsResponse;

        if (isMounted) {
          const weightMap = new Map<string, number>();
          const viewedAtMap = new Map<string, Date>();

          Object.entries(data.weights).forEach(([id, multiplier]) => {
            weightMap.set(id, multiplier);
          });

          // Parse lastViewedAt timestamps
          Object.entries(data.lastViewedAt || {}).forEach(([id, timestamp]) => {
            if (timestamp) {
              viewedAtMap.set(id, new Date(timestamp));
            }
          });

          setWeightMultipliers(weightMap);
          setLastViewedAtMap(viewedAtMap);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error("Unknown error"));
          // Use default weight 1.0 on failure
          const defaultMap = new Map<string, number>();
          const defaultViewedAtMap = new Map<string, Date>();
          memoizedInsightIds.forEach((id) => defaultMap.set(id, 1.0));
          setWeightMultipliers(defaultMap);
          setLastViewedAtMap(defaultViewedAtMap);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchWeights();

    return () => {
      isMounted = false;
    };
  }, [memoizedInsightIds, version]); // Re-fetch when insightIds or version changes

  /**
   * Manually refresh weight data
   */
  const refreshWeights = async (): Promise<void> => {
    setVersion((v) => v + 1);
  };

  return {
    weightMultipliers,
    lastViewedAtMap,
    isLoading,
    error,
    refreshWeights,
  };
}
