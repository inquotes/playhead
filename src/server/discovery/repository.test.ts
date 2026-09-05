import { describe, expect, it, vi } from "vitest";

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn() }));

vi.mock("@/server/db", () => ({
  prisma: {
    recommendationRun: { upsert: upsertMock },
  },
}));

import { replaceRecommendationRun } from "./repository";

describe("replaceRecommendationRun", () => {
  it("updates by the database-enforced analysis and lane identity", async () => {
    upsertMock.mockResolvedValue({ id: "recommendation-1" });

    await replaceRecommendationRun({
      visitorSessionId: "visitor-1",
      userAccountId: "user-1",
      targetLastfmUsername: "listener",
      analysisRunId: "analysis-1",
      selectedLane: "lane-1",
      resultsJson: { recommendations: [] },
    });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          analysisRunId_selectedLane: {
            analysisRunId: "analysis-1",
            selectedLane: "lane-1",
          },
        },
        update: expect.objectContaining({ resultsJson: { recommendations: [] } }),
      }),
    );
  });
});
