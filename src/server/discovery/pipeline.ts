import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, getOpenAIModel } from "@/server/ai/client";
import { classifyLanes } from "@/server/discovery/classifier";
import type {
  ArtistProfile,
  Lane,
  ListeningSnapshot,
  Recommendation,
  RecommendationCandidate,
  RecommendationResult,
  TasteLane,
  TimeWindow,
} from "@/server/discovery/types";
import {
  getAggregatedWeeklyArtists,
  getArtistProfile,
  getKnownArtists,
  getSimilarArtistProfiles,
  getTopTrackSummary,
} from "@/server/lastfm/service";

const MAX_SNAPSHOT_ARTISTS = 32;
const MAX_PROFILED_ARTISTS = 24;

const laneModelSchema = z.object({
  summary: z.string().min(1),
  notablePatterns: z.array(z.string().min(1)).min(2).max(6),
  lanes: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().min(1),
        representativeArtists: z.array(z.string().min(1)).min(2).max(8),
        memberArtists: z.array(z.string().min(1)).min(3).max(15),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().min(1),
      }),
    )
    .min(3)
    .max(3),
});

const explanationSchema = z.object({
  explanations: z.array(z.object({ artist: z.string().min(1), explanation: z.string().min(1) })).min(1).max(8),
});

function normalizeArtist(value: string): string {
  return value.trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 42);
}

function extractFirstYear(text: string): number | null {
  const years = text.match(/\b(19\d{2}|20\d{2})\b/g);
  if (!years) return null;
  const nums = years.map((year) => Number(year)).filter((year) => year >= 1950 && year <= 2035);
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

function summarizeTags(profiles: ArtistProfile[]): string[] {
  const scoreByTag = new Map<string, number>();
  for (const profile of profiles) {
    const weight = Math.max(1, profile.periodPlaycount);
    for (const tag of profile.tags.slice(0, 6)) {
      scoreByTag.set(tag, (scoreByTag.get(tag) ?? 0) + weight);
    }
  }

  return [...scoreByTag.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag);
}

function mapTasteLanesToUi(lanes: TasteLane[]): Lane[] {
  return lanes.map((lane) => ({
    id: lane.id,
    name: lane.label,
    description: lane.description,
    whyThisLane: lane.context.evidence[0] ?? lane.description,
    confidence: lane.confidence,
    artists: lane.representativeArtists,
    tags: lane.context.tags,
    totalPlays: lane.context.totalPlays,
    sourceWindow: lane.sourceWindow,
    memberArtists: lane.memberArtists,
    evidence: lane.context.evidence,
  }));
}

export async function buildListeningSnapshot(params: {
  username: string;
  timeWindow: TimeWindow;
}): Promise<ListeningSnapshot> {
  const [weeklyArtists, knownArtists, topTracks] = await Promise.all([
    getAggregatedWeeklyArtists({
      username: params.username,
      from: params.timeWindow.from,
      to: params.timeWindow.to,
    }),
    getKnownArtists({ username: params.username }),
    getTopTrackSummary(params.username),
  ]);

  const topArtists = weeklyArtists.slice(0, MAX_SNAPSHOT_ARTISTS).map((row) => ({
    artistName: row.artistName,
    normalizedName: row.normalizedName,
    periodPlaycount: row.playcount,
  }));

  const knownPlayMap = new Map(knownArtists.map((item) => [item.normalizedName, item.playcount]));

  const artistProfiles: ArtistProfile[] = await Promise.all(
    topArtists.slice(0, MAX_PROFILED_ARTISTS).map(async (artist) => {
      const profile = await getArtistProfile({ artistName: artist.artistName, username: params.username });
      return {
        artistName: artist.artistName,
        normalizedName: artist.normalizedName,
        periodPlaycount: artist.periodPlaycount,
        allTimePlaycount: knownPlayMap.get(artist.normalizedName) ?? profile.userPlaycount ?? null,
        tags: profile.tags,
        similarArtists: profile.similarArtists,
        listeners: profile.listeners,
        metadata: {
          bioSnippet: profile.bio.slice(0, 220),
        },
      };
    }),
  );

  const totalPlays = topArtists.reduce((sum, artist) => sum + artist.periodPlaycount, 0);

  return {
    username: params.username,
    timeWindow: params.timeWindow,
    topArtists,
    artistProfiles,
    knownArtists,
    summary: {
      artistCount: topArtists.length,
      totalPlays,
      topTags: summarizeTags(artistProfiles),
    },
    metadata: {
      topTracks: topTracks.slice(0, 20),
    },
  } as ListeningSnapshot;
}

function buildFallbackLanes(snapshot: ListeningSnapshot): {
  summary: string;
  notablePatterns: string[];
  lanes: TasteLane[];
} {
  const fallback = classifyLanes(
    snapshot.artistProfiles.map((profile) => ({
      artist: profile.artistName,
      plays: profile.periodPlaycount,
      tags: profile.tags,
    })),
  )
    .slice(0, 3)
    .map((lane, index) => {
      const memberArtists = snapshot.artistProfiles
        .filter((profile) => lane.tags.some((tag) => profile.tags.some((artistTag) => artistTag.includes(tag))))
        .slice(0, 10)
        .map((profile) => profile.artistName);

      return {
        id: lane.id || `lane-${index + 1}`,
        label: lane.name,
        description: lane.description,
        representativeArtists: lane.artists.slice(0, 6),
        memberArtists: memberArtists.length > 0 ? memberArtists : lane.artists,
        confidence: lane.confidence,
        sourceWindow: snapshot.timeWindow.label,
        context: {
          tags: lane.tags,
          totalPlays: lane.totalPlays,
          evidence: [lane.whyThisLane],
        },
      } satisfies TasteLane;
    });

  return {
    summary: `Built ${fallback.length} lanes from direct Last.fm artist patterns in ${snapshot.timeWindow.label.toLowerCase()}.`,
    notablePatterns: [
      `Top tags include ${snapshot.summary.topTags.slice(0, 3).join(", ") || "mixed signals"}.`,
      "Lane composition is weighted by period playcount and repeated tag overlaps.",
    ],
    lanes: fallback,
  };
}

export async function synthesizeTasteLanes(snapshot: ListeningSnapshot): Promise<{
  summary: string;
  notablePatterns: string[];
  lanes: Lane[];
}> {
  const artistInput = snapshot.artistProfiles.slice(0, 24).map((profile) => ({
    artist: profile.artistName,
    plays: profile.periodPlaycount,
    allTimePlaycount: profile.allTimePlaycount,
    tags: profile.tags.slice(0, 4),
    similarHints: profile.similarArtists.slice(0, 2),
  }));

  const client = getOpenAIClient();

  try {
    const completion = await client.chat.completions.parse({
      model: getOpenAIModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a music taste analyst. Group artists into exactly 3 practical discovery lanes using only supplied evidence. Return concise grounded output.",
        },
        {
          role: "user",
          content: JSON.stringify({
            username: snapshot.username,
            sourceWindow: snapshot.timeWindow.label,
            summary: snapshot.summary,
            artists: artistInput,
          }),
        },
      ],
      response_format: zodResponseFormat(laneModelSchema, "taste_lanes"),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("Lane model did not return parseable output.");
    }

    const periodPlayMap = new Map(snapshot.topArtists.map((artist) => [artist.normalizedName, artist.periodPlaycount]));
    const normalizedArtistMap = new Map(snapshot.topArtists.map((artist) => [artist.normalizedName, artist.artistName]));

    const lanes: TasteLane[] = parsed.lanes.map((lane, idx) => {
      const memberArtists = lane.memberArtists
        .map((name) => {
          const key = normalizeArtist(name);
          return normalizedArtistMap.get(key);
        })
        .filter((name): name is string => Boolean(name));

      const representativeArtists = lane.representativeArtists
        .map((name) => {
          const key = normalizeArtist(name);
          return normalizedArtistMap.get(key) ?? name;
        })
        .filter(Boolean)
        .slice(0, 6);

      const totalPlays = (memberArtists.length > 0 ? memberArtists : representativeArtists).reduce(
        (sum, name) => sum + (periodPlayMap.get(normalizeArtist(name)) ?? 0),
        0,
      );

      const tags = summarizeTags(
        snapshot.artistProfiles.filter((profile) =>
          new Set((memberArtists.length > 0 ? memberArtists : representativeArtists).map(normalizeArtist)).has(profile.normalizedName),
        ),
      ).slice(0, 6);

      return {
        id: slugify(`${lane.label}-${idx + 1}`) || `lane-${idx + 1}`,
        label: lane.label,
        description: lane.description,
        representativeArtists,
        memberArtists: memberArtists.length > 0 ? memberArtists : representativeArtists,
        confidence: Math.min(1, Math.max(0, lane.confidence)),
        sourceWindow: snapshot.timeWindow.label,
        context: {
          tags,
          totalPlays,
          evidence: [lane.reasoning],
        },
      };
    });

    return {
      summary: parsed.summary,
      notablePatterns: parsed.notablePatterns,
      lanes: mapTasteLanesToUi(lanes),
    };
  } catch {
    const fallback = buildFallbackLanes(snapshot);
    return {
      summary: fallback.summary,
      notablePatterns: fallback.notablePatterns,
      lanes: mapTasteLanesToUi(fallback.lanes),
    };
  }
}

function rankCandidate(params: {
  supportCount: number;
  supportMatchTotal: number;
  candidateTags: string[];
  laneTags: string[];
  knownPlaycount: number | null;
  listeners: number | null;
}): { score: number; evidence: string[] } {
  const laneTagSet = new Set(params.laneTags.map((tag) => tag.toLowerCase()));
  const tagOverlap = params.candidateTags.filter((tag) => laneTagSet.has(tag)).length;
  const supportScore = params.supportCount * 26;
  const similarityScore = Math.min(36, params.supportMatchTotal * 0.35);
  const overlapScore = tagOverlap * 9;
  const noveltyScore =
    params.knownPlaycount === null
      ? 16
      : params.knownPlaycount < 10
        ? Math.max(0, 14 - params.knownPlaycount)
        : -30;
  const listenerScore = params.listeners && params.listeners > 0 ? Math.max(0, 8 - Math.log10(params.listeners)) : 0;

  const score = Math.max(0, supportScore + similarityScore + overlapScore + noveltyScore + listenerScore);

  const evidence = [
    `Supported by ${params.supportCount} lane seed artist${params.supportCount === 1 ? "" : "s"}.`,
    tagOverlap > 0 ? `Shares ${tagOverlap} lane tag${tagOverlap === 1 ? "" : "s"}.` : "Primary signal is artist-neighborhood similarity.",
    params.knownPlaycount === null
      ? "Not found in broad known-history scan."
      : params.knownPlaycount < 10
        ? `Known lightly (${params.knownPlaycount} plays all-time), treated as discovery-eligible.`
        : `Known heavily (${params.knownPlaycount} plays all-time), penalized.`,
  ];

  return { score, evidence };
}

async function generateRecommendationExplanations(params: {
  lane: Lane;
  candidates: Recommendation[];
}): Promise<Map<string, string>> {
  const client = getOpenAIClient();

  try {
    const completion = await client.chat.completions.parse({
      model: getOpenAIModel(),
      messages: [
        {
          role: "system",
          content:
            "You write concise recommendation explanations grounded only in supplied evidence. Do not invent facts or biographies.",
        },
        {
          role: "user",
          content: JSON.stringify({
            lane: {
              label: params.lane.name,
              description: params.lane.description,
              tags: params.lane.tags,
            },
            candidates: params.candidates.map((candidate) => ({
              artist: candidate.artist,
              matchSource: candidate.matchSource,
              tags: candidate.tags,
              evidence: candidate.evidence,
            })),
          }),
        },
      ],
      response_format: zodResponseFormat(explanationSchema, "recommendation_explanations"),
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("Explanation output missing.");
    }

    const map = new Map<string, string>();
    for (const item of parsed.explanations) {
      map.set(normalizeArtist(item.artist), item.explanation);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function generateDeterministicRecommendations(params: {
  username: string;
  lane: Lane;
  snapshot: ListeningSnapshot;
  limit: number;
  newPreferred: boolean;
}): Promise<RecommendationResult> {
  const limit = Math.max(1, Math.min(4, params.limit));
  const knownPlayMap = new Map(params.snapshot.knownArtists.map((artist) => [artist.normalizedName, artist.playcount]));
  const seedArtists = [...new Set([...(params.lane.memberArtists ?? []), ...params.lane.artists])]
    .filter(Boolean)
    .slice(0, 8);

  const laneTagSet = new Set(params.lane.tags.map((tag) => tag.toLowerCase()));
  const candidateMap = new Map<
    string,
    {
      artistName: string;
      supportSeeds: Set<string>;
      supportMatchTotal: number;
    }
  >();

  for (const seed of seedArtists) {
    const similar = await getSimilarArtistProfiles({ artistName: seed, username: params.username, limit: 24 });
    for (const match of similar) {
      const existing = candidateMap.get(match.normalizedName);
      if (!existing) {
        candidateMap.set(match.normalizedName, {
          artistName: match.artistName,
          supportSeeds: new Set([seed]),
          supportMatchTotal: match.match,
        });
        continue;
      }

      existing.supportSeeds.add(seed);
      existing.supportMatchTotal += match.match;
    }
  }

  const rankedCandidates = [...candidateMap.entries()]
    .map(([normalizedName, value]) => ({ normalizedName, ...value }))
    .sort((a, b) => b.supportMatchTotal - a.supportMatchTotal)
    .slice(0, 30);

  const recommendationCandidates: RecommendationCandidate[] = [];

  for (const candidate of rankedCandidates) {
    const knownPlaycount = knownPlayMap.get(candidate.normalizedName) ?? null;
    const profile = await getArtistProfile({ artistName: candidate.artistName, username: params.username });

    const rank = rankCandidate({
      supportCount: candidate.supportSeeds.size,
      supportMatchTotal: candidate.supportMatchTotal,
      candidateTags: profile.tags,
      laneTags: [...laneTagSet],
      knownPlaycount,
      listeners: profile.listeners,
    });

    const excluded = (knownPlaycount ?? 0) >= 10;
    const firstKnownYear = extractFirstYear(profile.bio);
    const newEraAdjust =
      params.newPreferred && firstKnownYear
        ? firstKnownYear >= 2019
          ? 8
          : -4
        : 0;

    recommendationCandidates.push({
      artistName: candidate.artistName,
      normalizedName: candidate.normalizedName,
      supportingSeedArtists: [...candidate.supportSeeds],
      evidence: rank.evidence,
      status: excluded ? "excluded" : "included",
      finalScore: (excluded ? rank.score - 30 : rank.score) + newEraAdjust,
      metadata: {
        tags: profile.tags.slice(0, 6),
        listeners: profile.listeners,
        knownPlaycount,
        supportMatchTotal: candidate.supportMatchTotal,
        firstKnownYear,
      },
    });
  }

  const selected = recommendationCandidates
    .filter((candidate) => candidate.status === "included")
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);

  const baseRecommendations: Recommendation[] = selected.map((candidate) => {
    const tags = ((candidate.metadata.tags as string[] | undefined) ?? []).slice(0, 5);
    const firstKnownYear = (candidate.metadata.firstKnownYear as number | null | undefined) ?? null;

    return {
      artist: candidate.artistName,
      score: Math.round(candidate.finalScore),
      reason: candidate.evidence[0] ?? "Fits this lane based on deterministic similarity signals.",
      matchSource: candidate.supportingSeedArtists[0] ?? params.lane.artists[0] ?? "lane_seed",
      tags,
      firstKnownYear,
      isLikelyNewEra: Boolean(firstKnownYear && firstKnownYear >= 2019),
      evidence: candidate.evidence,
    };
  });

  const explanationMap = await generateRecommendationExplanations({
    lane: params.lane,
    candidates: baseRecommendations,
  });

  const recommendations = baseRecommendations.map((recommendation) => ({
    ...recommendation,
    reason:
      explanationMap.get(normalizeArtist(recommendation.artist)) ??
      `${recommendation.artist} aligns with ${params.lane.name} through ${recommendation.matchSource} and shared sonic traits.`,
  }));

  return {
    laneId: params.lane.id,
    laneLabel: params.lane.name,
    candidates: recommendationCandidates,
    recommendations,
    strategyNote:
      "Candidates are generated deterministically from lane seed neighborhoods, filtered against broad known history, ranked by support + overlap + novelty, then explained by the LLM.",
  };
}
