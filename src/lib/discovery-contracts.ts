import { z } from "zod";

export const rangePresetSchema = z.enum(["7d", "1m", "6m", "1y", "custom"]);
export type RangePreset = z.infer<typeof rangePresetSchema>;

export const analyzeDiscoveryRequestSchema = z.object({
  preset: rangePresetSchema,
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  targetUsername: z.string().trim().min(2).max(64).optional(),
});
export type AnalyzeDiscoveryRequest = z.infer<typeof analyzeDiscoveryRequestSchema>;

export const recommendDiscoveryRequestSchema = z.object({
  analysisRunId: z.string().min(1),
  laneId: z.string().min(1),
  limit: z.number().int().min(1).max(4).default(4),
});
export type RecommendDiscoveryRequest = z.infer<typeof recommendDiscoveryRequestSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "completed",
  "failed",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const similarArtistHintSchema = z.object({
  artistName: z.string(),
  normalizedName: z.string(),
  supportSeeds: z.array(z.string()),
  aggregateMatch: z.number(),
});
export type SimilarArtistHint = z.infer<typeof similarArtistHintSchema>;

export const laneSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  whyThisLane: z.string(),
  confidence: z.number(),
  artists: z.array(z.string()),
  tags: z.array(z.string()),
  totalPlays: z.number(),
  sourceWindow: z.string().optional(),
  memberArtists: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  similarHints: z.array(similarArtistHintSchema).optional(),
});
export type Lane = z.infer<typeof laneSchema>;

export const recommendationSchema = z.object({
  artist: z.string(),
  score: z.number(),
  reason: z.string().default(""),
  blurb: z.string().default(""),
  recommendedAlbum: z.string().nullable().optional(),
  matchSource: z.string(),
  tags: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
