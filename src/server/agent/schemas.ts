import { z } from "zod";

export const agentTraceStepSchema = z.object({
  index: z.number().int().min(1),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  status: z.enum(["success", "error", "budget_skipped"]),
  durationMs: z.number().int().min(0),
  preview: z.string(),
});

export const analyzeLaneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  whyThisLane: z.string().min(1),
  confidence: z.number().min(0).max(1),
  artists: z.array(z.string().min(1)).min(3).max(12),
  tags: z.array(z.string().min(1)).min(1).max(10),
  totalPlays: z.number().int().min(0),
  evidence: z.array(z.string().min(1)).min(1).max(8),
});

export const analyzeFinalSchema = z.object({
  summary: z.string().min(1),
  notablePatterns: z.array(z.string().min(1)).min(2).max(8),
  lanes: z.array(analyzeLaneSchema).min(3).max(6),
  heardArtists: z.array(z.string().min(1)).min(1).max(500),
});

export const recommendItemSchema = z.object({
  artist: z.string().min(1),
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
  matchSource: z.string().min(1),
  tags: z.array(z.string().min(1)).max(8),
  firstKnownYear: z.number().int().min(1950).max(2035).nullable(),
  isLikelyNewEra: z.boolean(),
  evidence: z.array(z.string().min(1)).min(1).max(6),
});

export const recommendFinalSchema = z.object({
  strategyNote: z.string().min(1),
  recommendations: z.array(recommendItemSchema).min(1).max(20),
});

export type AnalyzeFinal = z.infer<typeof analyzeFinalSchema>;
export type RecommendFinal = z.infer<typeof recommendFinalSchema>;
export type AgentTraceStep = z.infer<typeof agentTraceStepSchema>;
