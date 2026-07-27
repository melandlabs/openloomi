import { resolveMemoryGraphCorrectionPolicy } from "@/lib/memory/memory-graph-correction-policy";
import { describe, expect, it } from "vitest";

describe("memory graph correction policy", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveMemoryGraphCorrectionPolicy("operator-1", {})).toEqual({
      enabled: false,
      reasonCodes: ["memory_graph_correction_disabled"],
    });
  });

  it("requires the authenticated user to be in the operator allowlist", () => {
    expect(
      resolveMemoryGraphCorrectionPolicy("operator-1", {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "true",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS: "operator-2",
      }),
    ).toEqual({
      enabled: false,
      reasonCodes: ["memory_graph_correction_operator_miss"],
    });
  });

  it("lets the kill switch override an enabled operator", () => {
    expect(
      resolveMemoryGraphCorrectionPolicy("operator-1", {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "true",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS: "operator-1",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH: "true",
      }),
    ).toEqual({
      enabled: false,
      reasonCodes: ["memory_graph_correction_kill_switch"],
    });
  });

  it("enables only an explicitly allowlisted operator", () => {
    expect(
      resolveMemoryGraphCorrectionPolicy("operator-1", {
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED: "true",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS:
          "operator-2, operator-1",
        OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH: "false",
      }),
    ).toEqual({
      enabled: true,
      reasonCodes: ["memory_graph_correction_operator_enabled"],
    });
  });
});
