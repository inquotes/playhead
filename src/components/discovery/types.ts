import { normalizeArtistName, uniqueArtists } from "@/lib/artists";
import type { AgentRunStatus, Lane, Recommendation } from "@/lib/discovery-contracts";

export { normalizeArtistName, uniqueArtists };
export type { Lane, Recommendation } from "@/lib/discovery-contracts";

export type ConnectionStatus = {
  isAuthenticated: boolean;
  user: {
    id: string;
    lastfmUsername: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

export type AgentRun = {
  id: string;
  mode: "analyze" | "recommend";
  status: AgentRunStatus;
  result: unknown;
  errorMessage: string | null;
};

export type UsernameValidationResponse = {
  ok: true;
  username: string;
  normalizedUsername: string;
};

export type HistoryRecommendationRun = {
  id: string;
  selectedLane: string;
  createdAt: string;
  strategyNote: string | null;
  recommendations: Recommendation[];
};

export type HistoryAnalysisResponse = {
  ok: true;
  analysisRunId: string;
  targetUsername: string | null;
  range: {
    from: number;
    to: number;
    label: string;
  };
  summary: string | null;
  lanes: Lane[];
  recommendationRuns: HistoryRecommendationRun[];
};

export type SavedArtistRecord = {
  id: string;
  artistName: string;
  normalizedName: string;
  savedAt: string;
  recommendationContextJson?: {
    blurb?: string;
    recommendedAlbum?: string | null;
    chips?: string[];
  } | null;
};

export type AgentLiveEvent = {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ViewState = "landing" | "time-select" | "analyzing" | "clusters" | "cluster-detail";

export const RANGE_OPTIONS = [
  { id: "7d", label: "Last 7 Days", desc: "Recent rotation" },
  { id: "6m", label: "Last 6 Months", desc: "Seasonal taste" },
  { id: "1y", label: "Last Year", desc: "Full portrait" },
  { id: "custom", label: "Select Your Own Time Range", desc: "Month-level range" },
] as const;

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type RangeOptionId = (typeof RANGE_OPTIONS)[number]["id"];

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json()) as T & { ok?: boolean; message?: string };
  if (!response.ok || ("ok" in data && data.ok === false)) {
    throw new Error((data as { message?: string }).message ?? "Request failed.");
  }
  return data;
}

export type RunResult = {
  analysisRunId?: string;
  recommendationRunId?: string;
  targetUsername?: string;
  knownHistoryCoverage?: "full_recent_year" | "partial";
  knownHistoryMessage?: string | null;
  range?: { label?: string };
  lanes: Lane[];
  summary?: string;
  recommendations: Recommendation[];
};
