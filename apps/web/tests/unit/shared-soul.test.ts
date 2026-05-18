/**
 * Shared Soul Tests
 *
 * Tests for packages/shared/src/soul.ts
 * SO-01 to SO-12
 */

import { describe, it, expect } from "vitest";
import {
  getDefaultPrompt,
  getPresetPrompt,
  SOUL_PRESETS,
  SOUL_PRESET_CUSTOM_ID,
  getSoulPresetByPrompt,
  getSelectedSoulPresetId,
  DEFAULT_PROMPT_EN,
  DEFAULT_PROMPT_ZH,
} from "@openloomi/shared/soul";

describe("shared soul", () => {
  describe("getDefaultPrompt", () => {
    // SO-01: getDefaultPrompt English locale
    it("SO-01: should return English prompt for en-US locale", () => {
      const result = getDefaultPrompt("en-US");
      expect(result).toBe(DEFAULT_PROMPT_EN);
      expect(result).toContain("You are OpenLoomi");
    });

    // SO-02: getDefaultPrompt Chinese locale
    it("SO-02: should return Chinese prompt for zh-Hans locale", () => {
      const result = getDefaultPrompt("zh-Hans");
      expect(result).toBe(DEFAULT_PROMPT_ZH);
      expect(result).toContain("你是 OpenLoomi");
    });

    // SO-03: getDefaultPrompt other locale
    it("SO-03: should return English prompt as fallback for unknown locale", () => {
      const result = getDefaultPrompt("fr-FR");
      expect(result).toBe(DEFAULT_PROMPT_EN);
    });

    // SO-03: also test empty string
    it("SO-03: should return English prompt as fallback for empty string", () => {
      const result = getDefaultPrompt("");
      expect(result).toBe(DEFAULT_PROMPT_EN);
    });
  });

  describe("getPresetPrompt", () => {
    // SO-04: getPresetPrompt known preset
    it("SO-04: should return English strategist prompt for strategist preset", () => {
      const result = getPresetPrompt("strategist", "en-US");
      expect(result).toContain("Strategist");
      expect(result).toContain("30,000 feet");
    });

    // SO-04: also test executor
    it("SO-04: should return English executor prompt for executor preset", () => {
      const result = getPresetPrompt("executor", "en-US");
      expect(result).toContain("Executor");
    });

    // SO-05: getPresetPrompt unknown preset
    it("SO-05: should return empty string for unknown preset", () => {
      const result = getPresetPrompt("unknown", "en-US");
      expect(result).toBe("");
    });
  });

  describe("SOUL_PRESETS", () => {
    // SO-06: SOUL_PRESETS count
    it("SO-06: should have 5 presets", () => {
      expect(SOUL_PRESETS).toHaveLength(5);
    });

    // SO-07: SOUL_PRESETS contains
    it("SO-07: should contain default, strategist, executor, connector, calm", () => {
      const ids = SOUL_PRESETS.map((p) => p.id);
      expect(ids).toContain("default");
      expect(ids).toContain("strategist");
      expect(ids).toContain("executor");
      expect(ids).toContain("connector");
      expect(ids).toContain("calm");
    });

    // SO-07: each preset should have required fields
    it("SO-07: each preset should have id, titleKey, descriptionKey, and prompt", () => {
      for (const preset of SOUL_PRESETS) {
        expect(preset.id).toBeTruthy();
        expect(preset.titleKey).toBeTruthy();
        expect(preset.descriptionKey).toBeTruthy();
        expect(preset.prompt).toBeTruthy();
      }
    });
  });

  describe("getSoulPresetByPrompt", () => {
    // SO-08: getSoulPresetByPrompt match
    it("SO-08: should return preset when matching English default prompt", () => {
      const result = getSoulPresetByPrompt(DEFAULT_PROMPT_EN);
      expect(result).toBeDefined();
      expect(result?.id).toBe("default");
    });

    // SO-08: also test Chinese default
    it("SO-08: should return preset when matching Chinese default prompt", () => {
      const result = getSoulPresetByPrompt(DEFAULT_PROMPT_ZH);
      expect(result).toBeDefined();
      expect(result?.id).toBe("default");
    });

    // SO-09: getSoulPresetByPrompt no match
    it("SO-09: should return undefined for custom prompt", () => {
      const result = getSoulPresetByPrompt("custom text");
      expect(result).toBeUndefined();
    });

    // SO-09: also test empty/invalid
    it("SO-09: should return undefined for empty string", () => {
      const result = getSoulPresetByPrompt("");
      expect(result).toBeUndefined();
    });

    it("SO-09: should return undefined for null", () => {
      const result = getSoulPresetByPrompt(null as any);
      expect(result).toBeUndefined();
    });
  });

  describe("getSelectedSoulPresetId", () => {
    // SO-10: getSelectedSoulPresetId empty
    it("SO-10: should return default for empty string", () => {
      const result = getSelectedSoulPresetId("");
      expect(result).toBe("default");
    });

    // SO-10: also test whitespace
    it("SO-10: should return default for whitespace-only string", () => {
      const result = getSelectedSoulPresetId("   ");
      expect(result).toBe("default");
    });

    // SO-11: getSelectedSoulPresetId match
    it("SO-11: should return preset id when matching a preset prompt", () => {
      const result = getSelectedSoulPresetId(DEFAULT_PROMPT_EN);
      expect(result).toBe("default");
    });

    // SO-12: getSelectedSoulPresetId custom
    it("SO-12: should return custom id for custom prompt", () => {
      const result = getSelectedSoulPresetId("custom prompt text");
      expect(result).toBe(SOUL_PRESET_CUSTOM_ID);
    });

    // SO-12: verify custom id is "custom"
    it("SO-12: SOUL_PRESET_CUSTOM_ID should be 'custom'", () => {
      expect(SOUL_PRESET_CUSTOM_ID).toBe("custom");
    });
  });
});
