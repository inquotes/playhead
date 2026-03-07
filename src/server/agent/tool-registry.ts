import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { callLastfmTool } from "@/server/lastfm/mcp";
import {
  detectFirstRecentYear,
  parseArtistInfo,
  parseSimilarArtists,
  parseWeeklyArtistChart,
  parseWeeklyTrackChart,
} from "@/server/lastfm/parsers";

export const FINAL_ANALYZE_TOOL_NAME = "submit_final_analysis";
export const FINAL_RECOMMEND_TOOL_NAME = "submit_final_recommendations";

type AgentMode = "analyze" | "recommend";

export type AgentToolExecutionResult = {
  text: string;
  parsed: Record<string, unknown> | null;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: {
    mcpSessionId: string;
    argumentsObject: Record<string, unknown>;
  }) => Promise<AgentToolExecutionResult>;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeArtist(name: string): string {
  return name.trim().toLowerCase();
}

const getListeningSnapshotTool: AgentToolDefinition = {
  name: "tool_get_listening_snapshot",
  description:
    "Fetches a compact listening snapshot for the target range (top artists, tracks, and heard artist set).",
  parameters: {
    type: "object",
    properties: {
      from: { type: "number", description: "Range start as unix timestamp (seconds)." },
      to: { type: "number", description: "Range end as unix timestamp (seconds)." },
      artistLimit: { type: "number", description: "Optional max top artists to return (10-60)." },
      trackLimit: { type: "number", description: "Optional max top tracks to return (10-60)." },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute(params) {
    const from = toInt(params.argumentsObject.from, 0, 0, 4_102_444_800);
    const to = toInt(params.argumentsObject.to, 0, 0, 4_102_444_800);
    if (!from || !to || from >= to) {
      throw new Error("Invalid range for tool_get_listening_snapshot.");
    }

    const artistLimit = toInt(params.argumentsObject.artistLimit, 30, 10, 60);
    const trackLimit = toInt(params.argumentsObject.trackLimit, 30, 10, 60);

    const [artistChart, trackChart] = await Promise.all([
      callLastfmTool(params.mcpSessionId, "get_weekly_artist_chart", { from, to }),
      callLastfmTool(params.mcpSessionId, "get_weekly_track_chart", { from, to }),
    ]);

    const topArtists = parseWeeklyArtistChart(artistChart.text).slice(0, artistLimit);
    const topTracks = parseWeeklyTrackChart(trackChart.text).slice(0, trackLimit);
    const heardArtists = [...new Set(topArtists.map((item) => item.artist.trim()))];

    return {
      text: `Loaded snapshot with ${topArtists.length} artists and ${topTracks.length} tracks.`,
      parsed: {
        from,
        to,
        topArtists,
        topTracks,
        heardArtists,
      },
    };
  },
};

const getRecommendationCandidatesTool: AgentToolDefinition = {
  name: "tool_get_recommendation_candidates",
  description:
    "Builds unseen candidate artists from similar-artist neighborhoods of seed artists. Excludes heard artists.",
  parameters: {
    type: "object",
    properties: {
      seedArtists: { type: "array", items: { type: "string" } },
      heardArtists: { type: "array", items: { type: "string" } },
      perSeedLimit: { type: "number", description: "Similar artists to fetch per seed (5-50)." },
      maxCandidates: { type: "number", description: "Max candidates returned after aggregation (10-80)." },
    },
    required: ["seedArtists"],
    additionalProperties: false,
  },
  async execute(params) {
    const seedArtists = toStringArray(params.argumentsObject.seedArtists).slice(0, 8);
    if (seedArtists.length === 0) {
      throw new Error("tool_get_recommendation_candidates requires at least one seed artist.");
    }

    const heardSet = new Set(toStringArray(params.argumentsObject.heardArtists).map(normalizeArtist));
    const perSeedLimit = toInt(params.argumentsObject.perSeedLimit, 20, 5, 50);
    const maxCandidates = toInt(params.argumentsObject.maxCandidates, 30, 10, 80);

    const responses = await Promise.all(
      seedArtists.map(async (artist) => {
        const result = await callLastfmTool(params.mcpSessionId, "get_similar_artists", {
          artist,
          limit: perSeedLimit,
        });

        return {
          seed: artist,
          rows: parseSimilarArtists(result.text),
        };
      }),
    );

    const pool = new Map<string, { artist: string; aggregateMatch: number; sourceSeeds: Set<string> }>();
    for (const response of responses) {
      for (const row of response.rows) {
        const key = normalizeArtist(row.artist);
        if (!key || heardSet.has(key)) continue;

        const existing = pool.get(key);
        if (!existing) {
          pool.set(key, {
            artist: row.artist,
            aggregateMatch: row.match,
            sourceSeeds: new Set([response.seed]),
          });
          continue;
        }

        existing.aggregateMatch += row.match;
        existing.sourceSeeds.add(response.seed);
      }
    }

    const candidates = [...pool.values()]
      .sort((a, b) => b.aggregateMatch - a.aggregateMatch)
      .slice(0, maxCandidates)
      .map((candidate) => ({
        artist: candidate.artist,
        aggregateMatch: candidate.aggregateMatch,
        sourceSeeds: [...candidate.sourceSeeds],
      }));

    return {
      text: `Built ${candidates.length} unseen candidates from ${seedArtists.length} seeds.`,
      parsed: {
        seedArtists,
        candidates,
      },
    };
  },
};

const getArtistProfilesTool: AgentToolDefinition = {
  name: "tool_get_artist_profiles",
  description:
    "Fetches compact profile metadata for a list of artists (tags, similar artists, and first-known year signal).",
  parameters: {
    type: "object",
    properties: {
      artists: { type: "array", items: { type: "string" } },
      limit: { type: "number", description: "Max artists to fetch (1-20)." },
    },
    required: ["artists"],
    additionalProperties: false,
  },
  async execute(params) {
    const artistsInput = toStringArray(params.argumentsObject.artists);
    const limit = toInt(params.argumentsObject.limit, 10, 1, 20);
    const artists = artistsInput.slice(0, limit);

    if (artists.length === 0) {
      throw new Error("tool_get_artist_profiles requires at least one artist.");
    }

    const profiles = await Promise.all(
      artists.map(async (artist) => {
        const infoText = await callLastfmTool(params.mcpSessionId, "get_artist_info", { artist });
        const info = parseArtistInfo(infoText.text);

        return {
          artist,
          tags: info.tags.slice(0, 12),
          similar: info.similar.slice(0, 10),
          yourPlays: info.yourPlays,
          firstKnownYear: detectFirstRecentYear(info.bio),
          bioSnippet: info.bio.slice(0, 220),
        };
      }),
    );

    return {
      text: `Fetched ${profiles.length} artist profiles.`,
      parsed: {
        profiles,
      },
    };
  },
};

export function getAgentToolDefinitions(mode: AgentMode): AgentToolDefinition[] {
  if (mode === "analyze") {
    return [getListeningSnapshotTool, getRecommendationCandidatesTool, getArtistProfilesTool];
  }

  return [getRecommendationCandidatesTool, getArtistProfilesTool];
}

export function buildOpenAiTools(params: {
  toolDefinitions: AgentToolDefinition[];
  finalTool: ChatCompletionTool;
}): ChatCompletionTool[] {
  const tools: ChatCompletionTool[] = params.toolDefinitions.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  return [...tools, params.finalTool];
}

export async function executeAgentTool(params: {
  mcpSessionId: string;
  toolDefinitions: AgentToolDefinition[];
  toolName: string;
  argumentsObject: Record<string, unknown>;
}): Promise<AgentToolExecutionResult> {
  const match = params.toolDefinitions.find((tool) => tool.name === params.toolName);
  if (!match) {
    throw new Error(`Unknown agent tool: ${params.toolName}`);
  }

  return match.execute({
    mcpSessionId: params.mcpSessionId,
    argumentsObject: params.argumentsObject,
  });
}
