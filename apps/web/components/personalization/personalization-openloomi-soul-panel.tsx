"use client";

import { PersonalizationSwrBoundary } from "./personalization-swr-boundary";
import { PersonalizationBasicSettings } from "./personalization-basic-settings";

/**
 * Full-page openloomi Soul settings (formerly the personalization dialog "basic" tab).
 */
export function PersonalizationopenloomiSoulPanel() {
  return (
    <PersonalizationSwrBoundary>
      <PersonalizationBasicSettings open />
    </PersonalizationSwrBoundary>
  );
}
