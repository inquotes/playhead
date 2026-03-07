import { zodResponseFormat } from "openai/helpers/zod";
import { getOpenAIClient, getOpenAIModel } from "@/server/ai/client";
import {
  ANALYZE_SYSTEM_PROMPT,
  ANALYZE_TASK_PROMPT,
  RECOMMEND_SYSTEM_PROMPT,
  RECOMMEND_TASK_PROMPT,
} from "@/server/ai/prompts";
import {
  type AiLane,
  type AiLaneAnalysis,
  type AiRecommendationResponse,
  laneAnalysisSchema,
  recommendationResponseSchema,
} from "@/server/ai/schemas";
import type { Lane, Recommendation } from "@/server/discovery/types";
import { callLastfmTool } from "@/server/lastfm/mcp";
import {
  detectFirstRecentYear,
  parseArtistInfo,
  type ParsedArtistInfo,
  parseSimilarArtists,
  parseWeeklyArtistChart,
  parseWeeklyTrackChart,
} from "@/server/lastfm/parsers";

type ListeningContext = {
  topArtists: Array<{ artist: string; plays: number }>;
  topTracks: Array<{ artist: string; track: string; plays: number }>;
  artistDetails: Array<{
    artist: string;
    plays: number;
    tags: string[];
    similar: string[];
    firstKnownYear: number | null;
  }>;
  heardArtists: string[];
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40);
}

function normalizeArtist(name: string): string {
  return name.trim().toLowerCase();
}

function mapLane(aiLane: AiLane): Lane {
  return {
    id: slugify(aiLane.id || aiLane.name),
    name: aiLane.name,
    description: aiLane.description,
    whyThisLane: aiLane.whyThisLane,
    confidence: aiLane.confidence,
    artists: aiLane.seedArtists,
    tags: aiLane.seedTags,
    totalPlays: aiLane.totalPlays,
  };
}

export async function buildListeningContext(params: {
  mcpSessionId: string;
  from: number;
  to: number;
}): Promise<ListeningContext> {
  const [artistChart, trackChart] = await Promise.all([
    callLastfmTool(params.mcpSessionId, "get_weekly_artist_chart", {
      from: params.from,
      to: params.to,
    }),
    callLastfmTool(params.mcpSessionId, "get_weekly_track_chart", {
      from: params.from,
      to: params.to,
    }),
  ]);

  const topArtists = parseWeeklyArtistChart(artistChart.text);
  const topTracks = parseWeeklyTrackChart(trackChart.text);

  const details = await Promise.all(
    topArtists.slice(0, 16).map(async (row) => {
      const infoText = await callLastfmTool(params.mcpSessionId, "get_artist_info", {
        artist: row.artist,
      });
      const info = parseArtistInfo(infoText.text);

      return {
        artist: row.artist,
        plays: row.plays,
        tags: info.tags,
        similar: info.similar,
        firstKnownYear: detectFirstRecentYear(info.bio),
      };
    }),
  );

  const heardArtists = [...new Set(topArtists.map((item) => item.artist.trim()))];

  return {
    topArtists,
    topTracks,
    artistDetails: details,
    heardArtists,
  };
}

export async function classifyLanesWithAI(params: {
  rangeLabel: string;
  context: ListeningContext;
}): Promise<{ lanes: Lane[]; summary: string; notablePatterns: string[] }> {
  const client = getOpenAIClient();

  const userPrompt = {
    timeframe: params.rangeLabel,
    userGoal: ANALYZE_TASK_PROMPT,
    listeningContext: params.context,
  };

  const completion = await client.chat.completions.parse({
    model: getOpenAIModel(),
    messages: [
      { role: "system", content: ANALYZE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPrompt) },
    ],
    response_format: zodResponseFormat(laneAnalysisSchema, "lane_analysis"),
  });

  const parsed = completion.choices[0]?.message?.parsed as AiLaneAnalysis | undefined;
  if (!parsed) {
    throw new Error("Failed to parse AI lane analysis response.");
  }

  const lanes = parsed.lanes.map(mapLane);
  return {
    lanes,
    summary: parsed.summary,
    notablePatterns: parsed.notablePatterns,
  };
}

type CandidateArtist = {
  artist: string;
  aggregateMatch: number;
  sourceSeeds: string[];
  tags: string[];
  firstKnownYear: number | null;
  bioSnippet: string;
};

async function buildCandidatePool(params: {
  mcpSessionId: string;
  lane: Lane;
  heardArtists: string[];
}): Promise<CandidateArtist[]> {
  const heardSet = new Set(params.heardArtists.map(normalizeArtist));
  const candidateMap = new Map<string, { artist: string; aggregateMatch: number; sourceSeeds: Set<string> }>();

  for (const seed of params.lane.artists.slice(0, 7)) {
    const similarText = await callLastfmTool(params.mcpSessionId, "get_similar_artists", {
      artist: seed,
      limit: 20,
    });
    const similar = parseSimilarArtists(similarText.text);

    for (const match of similar) {
      const key = normalizeArtist(match.artist);
      if (!key || heardSet.has(key)) continue;

      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, {
          artist: match.artist,
          aggregateMatch: match.match,
          sourceSeeds: new Set([seed]),
        });
      } else {
        existing.aggregateMatch += match.match;
        existing.sourceSeeds.add(seed);
      }
    }
  }

  const ranked = [...candidateMap.values()]
    .sort((a, b) => b.aggregateMatch - a.aggregateMatch)
    .slice(0, 24);

  const details = await Promise.all(
    ranked.map(async (candidate) => {
      const infoText = await callLastfmTool(params.mcpSessionId, "get_artist_info", {
        artist: candidate.artist,
      });
      const info: ParsedArtistInfo = parseArtistInfo(infoText.text);
      const firstKnownYear = detectFirstRecentYear(info.bio);

      return {
        artist: candidate.artist,
        aggregateMatch: candidate.aggregateMatch,
        sourceSeeds: [...candidate.sourceSeeds],
        tags: info.tags,
        firstKnownYear,
        bioSnippet: info.bio.slice(0, 280),
      };
    }),
  );

  return details;
}

export async function recommendWithAI(params: {
  mcpSessionId: string;
  lane: Lane;
  heardArtists: string[];
  newOnly: boolean;
  limit: number;
}): Promise<{ strategyNote: string; recommendations: Recommendation[] }> {
  const candidatePool = await buildCandidatePool({
    mcpSessionId: params.mcpSessionId,
    lane: params.lane,
    heardArtists: params.heardArtists,
  });

  const client = getOpenAIClient();

  const userPrompt = {
    lane: params.lane,
    userGoal: RECOMMEND_TASK_PROMPT,
    newOnly: params.newOnly,
    maxResults: params.limit,
    heardArtists: params.heardArtists,
    candidatePool,
  };

  const completion = await client.chat.completions.parse({
    model: getOpenAIModel(),
    messages: [
      { role: "system", content: RECOMMEND_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPrompt) },
    ],
    response_format: zodResponseFormat(recommendationResponseSchema, "lane_recommendations"),
  });

  const parsed = completion.choices[0]?.message?.parsed as AiRecommendationResponse | undefined;
  if (!parsed) {
    throw new Error("Failed to parse AI recommendation response.");
  }

  const heardSet = new Set(params.heardArtists.map(normalizeArtist));
  const mapped = parsed.recommendations
    .filter((item) => !heardSet.has(normalizeArtist(item.artist)))
    .slice(0, params.limit)
    .map((item) => ({
      artist: item.artist,
      score: item.fitScore,
      reason: item.reason,
      matchSource: item.matchSource,
      tags: item.tags,
      firstKnownYear: item.firstKnownYear,
      isLikelyNewEra: item.isLikelyNewEra,
    }));

  return {
    strategyNote: parsed.strategyNote,
    recommendations: mapped,
  };
}
