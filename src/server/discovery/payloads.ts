import { laneSchema, recommendationSchema, type Lane, type Recommendation } from "@/lib/discovery-contracts";

export type AnalysisLanesPayload = {
  summary: string | null;
  notablePatterns: string[];
  lanes: Lane[];
  trace: Record<string, unknown> | null;
};

export function decodeAnalysisLanesPayload(value: unknown): AnalysisLanesPayload {
  if (Array.isArray(value)) {
    return {
      summary: null,
      notablePatterns: [],
      lanes: value.flatMap((item) => {
        const parsed = laneSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
      trace: null,
    };
  }

  if (!value || typeof value !== "object") {
    return { summary: null, notablePatterns: [], lanes: [], trace: null };
  }

  const payload = value as Record<string, unknown>;
  const rawLanes = Array.isArray(payload.lanes) ? payload.lanes : [];

  return {
    summary: typeof payload.summary === "string" ? payload.summary : null,
    notablePatterns: Array.isArray(payload.notablePatterns)
      ? payload.notablePatterns.filter((item): item is string => typeof item === "string")
      : [],
    lanes: rawLanes.flatMap((item) => {
      const parsed = laneSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
    trace:
      payload.trace && typeof payload.trace === "object" && !Array.isArray(payload.trace)
        ? (payload.trace as Record<string, unknown>)
        : null,
  };
}

export function decodeRecommendationResults(value: unknown): {
  strategyNote: string | null;
  recommendations: Recommendation[];
} {
  if (!value || typeof value !== "object") {
    return { strategyNote: null, recommendations: [] };
  }

  const payload = value as Record<string, unknown>;
  const recommendations = payload.recommendations;
  if (!Array.isArray(recommendations)) {
    return {
      strategyNote: typeof payload.strategyNote === "string" ? payload.strategyNote : null,
      recommendations: [],
    };
  }

  return {
    strategyNote: typeof payload.strategyNote === "string" ? payload.strategyNote : null,
    recommendations: recommendations.flatMap((item) => {
      const parsed = recommendationSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}
