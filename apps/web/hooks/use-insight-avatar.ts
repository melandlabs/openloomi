/**
 * Custom hook for Insight Avatar
 * Includes avatar configuration and assistant name management
 */

import { useMemo } from "react";
import { getAvatarConfigByState, AvatarState } from "@/components/agent-avatar";
import type { AvatarConfiguration } from "@/components/agent-avatar/types";

/**
 * Return value of Insight Avatar Hook
 */
interface UseInsightAvatarReturn {
  avatarConfig: AvatarConfiguration;
  assistantName: string;
}

/**
 * Custom hook for Insight Avatar
 * @param state Avatar state, defaults to DEFAULT
 * @returns Avatar configuration and assistant name
 */
export function useInsightAvatar(
  state: AvatarState = AvatarState.DEFAULT,
): UseInsightAvatarReturn {
  /**
   * Agent name
   */
  const assistantName = "openloomi";

  /**
   * Get avatar configuration based on state
   */
  const avatarConfig = useMemo(() => getAvatarConfigByState(state), [state]);

  return {
    avatarConfig,
    assistantName,
  };
}
