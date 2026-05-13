"use client";

import { useTranslation } from "react-i18next";
import {
  AvatarDisplay,
  getAvatarConfigByState,
  AvatarState,
} from "@/components/agent-avatar";

/**
 * Personalization avatar settings component props
 */
interface PersonalizationAvatarSettingsProps {
  /** Whether to show */
  open: boolean;
}

/**
 * Personalization avatar settings component
 */
export function PersonalizationAvatarSettings({
  open,
}: PersonalizationAvatarSettingsProps) {
  const { t } = useTranslation();

  /**
   * Use avatar config with default state
   */
  const avatarConfig = getAvatarConfigByState(AvatarState.DEFAULT);

  /**
   * Agent name
   */
  const displayName = "openloomi";

  return (
    <div className="w-full h-full flex flex-col gap-4 sm:gap-6 md:gap-8">
      {/* Avatar preview area - responsive size optimization */}
      <div className="flex flex-col items-center gap-4 pt-2 sm:pt-4 md:pt-6">
        <div className="relative flex items-center justify-center">
          <AvatarDisplay
            config={avatarConfig}
            className="w-[90px] h-[90px] xs:w-[130px] xs:h-[130px] sm:w-[140px] sm:h-[140px] md:w-[170px] md:h-[170px] lg:w-[200px] lg:h-[200px]"
            enableInteractions={true}
          />
        </div>
        <div className="flex flex-col items-center gap-1 w-full max-w-xs">
          <div className="flex items-center justify-center gap-2 w-full">
            <span className="text-base sm:text-lg font-semibold text-foreground text-center">
              {displayName}
            </span>
          </div>
        </div>
      </div>

      {/* Description text */}
      <div className="flex flex-col items-center gap-2 px-4">
        <p className="text-sm text-muted-foreground text-center">
          {t(
            "settings.avatarStateDescription",
            "openloomi's appearance automatically changes based on different states",
          )}
        </p>
      </div>
    </div>
  );
}
