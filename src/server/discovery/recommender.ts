import { callLastfmTool } from "@/server/lastfm/mcp";
import { detectFirstRecentYear, parseArtistInfo, parseSimilarArtists } from "@/server/lastfm/parsers";
import type { Lane, Recommendation } from "@/server/discovery/types";

type Candidate = {
  artist: string;
  score: number;
  source: string;
};

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function buildReason(candidate: {
  source: string;
  sharedTags: string[];
  firstKnownYear: number | null;
  newOnly: boolean;
}): string {
  const tagPart =
    candidate.sharedTags.length > 0
      ? `Shares lane tags like ${candidate.sharedTags.slice(0, 2).join(" and ")}.`
      : `Strongly matches artists you already like in this lane.`;

  if (candidate.newOnly && candidate.firstKnownYear && candidate.firstKnownYear >= 2019) {
    return `${tagPart} Likely newer-era act (first known year ${candidate.firstKnownYear}).`;
  }

  return `${tagPart} Similarity seeded from ${candidate.source}.`;
}

export async function generateRecommendations(params: {
  mcpSessionId: string;
  lane: Lane;
  heardArtists: string[];
  newOnly: boolean;
  limit: number;
}): Promise<Recommendation[]> {
  const heardSet = new Set(params.heardArtists.map(normalize));
  const candidateMap = new Map<string, Candidate>();

  const seedArtists = params.lane.artists.slice(0, 6);

  for (const seed of seedArtists) {
    const similarText = await callLastfmTool(params.mcpSessionId, "get_similar_artists", {
      artist: seed,
      limit: 20,
    });

    const similar = parseSimilarArtists(similarText.text);
    for (const item of similar) {
      const key = normalize(item.artist);
      if (!key || heardSet.has(key)) continue;

      const existing = candidateMap.get(key);
      const nextScore = item.match + (existing ? existing.score : 0);

      candidateMap.set(key, {
        artist: item.artist,
        score: nextScore,
        source: existing?.source ?? seed,
      });
    }
  }

  let candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score).slice(0, 20);

  const hydrated: Recommendation[] = [];

  for (const candidate of candidates) {
    const infoText = await callLastfmTool(params.mcpSessionId, "get_artist_info", {
      artist: candidate.artist,
    });

    const info = parseArtistInfo(infoText.text);
    const sharedTags = info.tags.filter((tag) => params.lane.tags.some((laneTag) => tag.includes(laneTag)));
    const firstKnownYear = detectFirstRecentYear(info.bio);

    let score = candidate.score + sharedTags.length * 6;
    if (params.newOnly) {
      if (firstKnownYear && firstKnownYear >= 2019) {
        score += 20;
      } else if (firstKnownYear && firstKnownYear < 2019) {
        score -= 15;
      }
    }

    hydrated.push({
      artist: candidate.artist,
      score,
      matchSource: candidate.source,
      tags: info.tags.slice(0, 5),
      firstKnownYear,
      isLikelyNewEra: Boolean(firstKnownYear && firstKnownYear >= 2019),
      reason: buildReason({
        source: candidate.source,
        sharedTags,
        firstKnownYear,
        newOnly: params.newOnly,
      }),
    });
  }

  if (params.newOnly) {
    const withRecentSignal = hydrated.filter((item) => item.firstKnownYear && item.firstKnownYear >= 2019);
    if (withRecentSignal.length > 0) {
      candidates = [];
      return withRecentSignal.sort((a, b) => b.score - a.score).slice(0, params.limit);
    }
  }

  return hydrated.sort((a, b) => b.score - a.score).slice(0, params.limit);
}
