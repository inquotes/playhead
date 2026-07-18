import { describe, expect, it } from "vitest";
import { computeReadinessUpdate } from "./weekly-history";

const emptyCurrent = { recentYearReadyAt: null, fullHistoryReadyAt: null };

describe("computeReadinessUpdate", () => {
  const now = new Date("2026-07-18T12:00:00Z");

  it("sets timestamps on the first ready transition", () => {
    const update = computeReadinessUpdate({
      recentYearReady: true,
      fullReady: true,
      current: emptyCurrent,
      now,
    });
    expect(update).toEqual({ recentYearReadyAt: now, fullHistoryReadyAt: now });
  });

  it("never overwrites an existing timestamp", () => {
    const original = new Date("2026-01-01T00:00:00Z");
    const update = computeReadinessUpdate({
      recentYearReady: true,
      fullReady: true,
      current: { recentYearReadyAt: original, fullHistoryReadyAt: original },
      now,
    });
    expect(update).toEqual({});
  });

  it("keeps existing timestamps when a new pending week makes readiness false", () => {
    const original = new Date("2026-01-01T00:00:00Z");
    const update = computeReadinessUpdate({
      recentYearReady: false,
      fullReady: false,
      current: { recentYearReadyAt: original, fullHistoryReadyAt: original },
      now,
    });
    expect(update).toEqual({});
  });

  it("returns no fields when never ready", () => {
    const update = computeReadinessUpdate({
      recentYearReady: false,
      fullReady: false,
      current: emptyCurrent,
      now,
    });
    expect(update).toEqual({});
  });

  it("sets recent-year independently of full history", () => {
    const update = computeReadinessUpdate({
      recentYearReady: true,
      fullReady: false,
      current: emptyCurrent,
      now,
    });
    expect(update).toEqual({ recentYearReadyAt: now });
  });
});
