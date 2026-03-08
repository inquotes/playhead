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

export type SimilarArtistHint = {
  artistName: string;
  normalizedName: string;
  supportSeeds: string[];
  aggregateMatch: number;
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

export type Recommendation = {
  artist: string;
  score: number;
  reason: string;
  blurb: string;
  recommendedAlbum?: string | null;
  matchSource: string;
  tags: string[];
  evidence: string[];
};

export type RecommendationResult = {
  laneId: string;
  laneLabel: string;
  candidates: RecommendationCandidate[];
  recommendations: Recommendation[];
  strategyNote: string;
};

export type Lane = {
  id: string;
  name: string;
  description: string;
  whyThisLane: string;
  confidence: number;
  artists: string[];
  tags: string[];
  totalPlays: number;
  sourceWindow?: string;
  memberArtists?: string[];
  evidence?: string[];
  similarHints?: SimilarArtistHint[];
};

export type ArtistWithTags = {
  artist: string;
  plays: number;
  tags: string[];
};
