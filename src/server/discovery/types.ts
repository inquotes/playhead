import type { Recommendation, SimilarArtistHint } from "@/lib/discovery-contracts";

export type { Lane, Recommendation, SimilarArtistHint } from "@/lib/discovery-contracts";

export type TimeWindow = {
  preset: "7d" | "1m" | "6m" | "1y" | "custom";
  from: number;
  to: number;
  label: string;
};

export type ListeningArtist = {
  artistName: string;
  normalizedName: string;
  periodPlaycount: number;
};

export type ArtistProfile = {
  artistName: string;
  normalizedName: string;
  periodPlaycount: number;
  allTimePlaycount: number | null;
  tags: string[];
  similarArtists: string[];
  listeners: number | null;
  metadata: Record<string, unknown>;
};

export type ListeningSnapshot = {
  username: string;
  timeWindow: TimeWindow;
  topArtists: ListeningArtist[];
  artistProfiles: ArtistProfile[];
  knownArtists: Array<{ artistName: string; normalizedName: string; playcount: number }>;
  summary: {
    artistCount: number;
    totalPlays: number;
    topTags: string[];
  };
  metadata?: Record<string, unknown>;
};

export type TasteLane = {
  id: string;
  label: string;
  description: string;
  representativeArtists: string[];
  memberArtists: string[];
  confidence: number;
  sourceWindow: string;
  context: {
    tags: string[];
    totalPlays: number;
    evidence: string[];
  };
};

export type LaneContext = {
  laneId: string;
  label: string;
  description: string;
  representativeArtists: string[];
  memberArtists: string[];
  tags: string[];
  sourceWindow: string;
  similarHints: SimilarArtistHint[];
};

export type RecommendationCandidate = {
  artistName: string;
  normalizedName: string;
  supportingSeedArtists: string[];
  evidence: string[];
  status: "included" | "excluded";
  finalScore: number;
  metadata: Record<string, unknown>;
};

export type RecommendationResult = {
  laneId: string;
  laneLabel: string;
  candidates: RecommendationCandidate[];
  recommendations: Recommendation[];
  strategyNote: string;
  timing?: {
    candidateSeedMergeMs: number;
    similarExpansionMs: number;
    profileEnrichmentMs: number;
    rankingMs: number;
    explanationMs: number;
    albumLookupMs: number;
    totalMs: number;
    llmExplanation?: {
      promptBuildMs: number;
      llmRequestMs: number;
      parseValidateMs: number;
      llmTotalMs: number;
      model: string;
      candidateCount: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      usedFallback: boolean;
    };
  };
};

export type ArtistWithTags = {
  artist: string;
  plays: number;
  tags: string[];
};
