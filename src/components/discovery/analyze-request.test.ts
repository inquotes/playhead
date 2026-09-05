import { describe, expect, it } from "vitest";
import { buildAnalyzeRequest } from "./analyze-request";

describe("buildAnalyzeRequest", () => {
  it("preserves another username for a custom date range", () => {
    expect(
      buildAnalyzeRequest({
        preset: "custom",
        customRange: {
          startYear: 2025,
          startMonth: 1,
          endYear: 2025,
          endMonth: 3,
        },
        targetUsername: "another-listener",
      }),
    ).toEqual({
      preset: "custom",
      from: 1735689600,
      to: 1743465599,
      targetUsername: "another-listener",
    });
  });

  it("omits the target for a self analysis", () => {
    expect(
      buildAnalyzeRequest({
        preset: "6m",
        customRange: {
          startYear: null,
          startMonth: null,
          endYear: null,
          endMonth: null,
        },
        targetUsername: null,
      }),
    ).toEqual({ preset: "6m" });
  });

  it("rejects a reversed custom range", () => {
    expect(() =>
      buildAnalyzeRequest({
        preset: "custom",
        customRange: {
          startYear: 2025,
          startMonth: 4,
          endYear: 2025,
          endMonth: 3,
        },
        targetUsername: null,
      }),
    ).toThrow("Please choose a valid start and end month.");
  });
});
