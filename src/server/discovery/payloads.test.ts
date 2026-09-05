import { describe, expect, it } from "vitest";
import { decodeAnalysisLanesPayload, decodeRecommendationResults } from "./payloads";

const lane = {
  id: "lane-1",
  name: "Dream Pop",
  description: "Airy guitars and soft vocals.",
  whyThisLane: "A recurring part of the listening window.",
  confidence: 0.9,
  artists: ["Beach House"],
  tags: ["dream pop"],
  totalPlays: 42,
};

describe("persisted discovery payloads", () => {
  it("decodes both current and legacy lane containers", () => {
    expect(decodeAnalysisLanesPayload({ summary: "Summary", lanes: [lane] })).toMatchObject({
      summary: "Summary",
      lanes: [lane],
    });
    expect(decodeAnalysisLanesPayload([lane]).lanes).toEqual([lane]);
  });

  it("drops invalid persisted lanes", () => {
    expect(decodeAnalysisLanesPayload({ lanes: [{ id: "incomplete" }] }).lanes).toEqual([]);
  });

  it("decodes validated recommendations", () => {
    const recommendation = {
      artist: "Cocteau Twins",
      score: 91,
      reason: "Shared lane neighborhood.",
      blurb: "A natural next listen.",
      matchSource: "Beach House",
      tags: ["dream pop"],
      evidence: ["Supported by the lane."],
    };
    expect(decodeRecommendationResults({ recommendations: [recommendation] }).recommendations).toEqual([recommendation]);
  });
});
