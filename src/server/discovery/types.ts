export type Lane = {
  id: string;
  name: string;
  description: string;
  whyThisLane: string;
  confidence: number;
  artists: string[];
  tags: string[];
  totalPlays: number;
};

export type ArtistWithTags = {
  artist: string;
  plays: number;
  tags: string[];
};

export type Recommendation = {
  artist: string;
  score: number;
  reason: string;
  matchSource: string;
  tags: string[];
  firstKnownYear: number | null;
  isLikelyNewEra: boolean;
};
