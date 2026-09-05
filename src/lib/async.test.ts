import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./async";

describe("mapWithConcurrency", () => {
  it("preserves input order while bounding active work", async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([6, 2, 4, 8]);
    expect(peak).toBe(2);
  });
});
