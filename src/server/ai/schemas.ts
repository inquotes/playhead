import { z } from "zod";

export const laneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  whyThisLane: z.string().min(1),
  confidence: z.number().min(0).max(1),
  seedArtists: z.array(z.string().min(1)).min(3).max(12),
  seedTags: z.array(z.string().min(1)).min(1).max(10),
  totalPlays: z.number().int().min(0),
});

export const laneAnalysisSchema = z.object({
  summary: z.string().min(1),
  notablePatterns: z.array(z.string().min(1)).min(2).max(8),
  lanes: z.array(laneSchema).min(3).max(6),
});

export const recommendationSchema = z.object({
  artist: z.string().min(1),
  fitScore: z.number().min(0).max(100),
  reason: z.string().min(1),
  matchSource: z.string().min(1),
  tags: z.array(z.string()).max(8),
  firstKnownYear: z.number().int().min(1950).max(2035).nullable(),
  isLikelyNewEra: z.boolean(),
});

export const recommendationResponseSchema = z.object({
  strategyNote: z.string().min(1),
  recommendations: z.array(recommendationSchema).min(1).max(20),
});

export type AiLane = z.infer<typeof laneSchema>;
export type AiLaneAnalysis = z.infer<typeof laneAnalysisSchema>;
export type AiRecommendation = z.infer<typeof recommendationSchema>;
export type AiRecommendationResponse = z.infer<typeof recommendationResponseSchema>;
