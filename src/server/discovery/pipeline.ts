import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, getOpenAIModel, getOpenAIReasoningEffort } from "@/server/ai/client";
import { classifyLanes } from "@/server/discovery/classifier";
import type {
  ArtistProfile,
  Lane,
  LaneContext,
  ListeningSnapshot,
  Recommendation,
  RecommendationCandidate,
  RecommendationResult,
  SimilarArtistHint,
  TasteLane,
  TimeWindow,
} from "@/server/discovery/types";
import {
  getAggregatedWeeklyArtists,
  getArtistProfile,
  getLatestWeeklyChartBoundary,
  getArtistTopAlbumSuggestion,
  getKnownArtists,
  getRecentArtistCounts,
  getSimilarArtistProfiles,
  getTopTrackSummary,
} from "@/server/lastfm/service";

const MAX_SNAPSHOT_ARTISTS = 32;
const MAX_PROFILED_ARTISTS = 24;

const laneModelSchema = z.object({
  summary: z.string().min(1).max(220),
  notablePatterns: z.array(z.string().min(1).max(140)).min(2).max(6),
  lanes: z
    .array(
      z.object({
        label: z.string().min(1).max(48),
        description: z.string().min(1).max(180),
        representativeArtists: z.array(z.string().min(1).max(80)).min(2).max(8),
        memberArtists: z.array(z.string().min(1).max(80)).min(3).max(15),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().min(1).max(180),
      }),
    )
    .min(3)
    .max(3),
});

const explanationSchema = z.object({
  explanations: z.array(z.object({ artist: z.string().min(1).max(80), blurb: z.string().min(1).max(220) })).min(1).max(8),
});

export function normalizeArtist(value: string): string {
  return value.trim().toLowerCase();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 42);
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

function compactArtistList(artists: string[], max = 3): string {
  const cleaned = [...new Set(artists.map((artist) => artist.trim()).filter(Boolean))].slice(0, max);
  return cleaned.join(", ");
}

function containsTechnicalLanguage(text: string): boolean {
  return /\b(metadata|sparse|deterministic|algorithm|model|llm|signal|pipeline|schema|parseable)\b/i.test(text);
}

function enrichLaneDescription(params: {
  description: string;
  representativeArtists: string[];
  tags: string[];
}): string {
  const base = params.description.trim();
  if (base.length >= 60 && !containsTechnicalLanguage(base)) {
    return base;
  }

  const tagText = params.tags.slice(0, 3).join(", ") || "distinct moods";
  const artistText = compactArtistList(params.representativeArtists);
  return `A lane shaped by ${tagText}, anchored by ${artistText}.`;
}

function enrichLaneReasoning(params: {
  reasoning: string;
  representativeArtists: string[];
  tags: string[];
}): string {
  const base = params.reasoning.trim();
  if (base.length >= 55 && !containsTechnicalLanguage(base)) {
    return base;
  }

  const artistText = compactArtistList(params.representativeArtists);
  const tagText = params.tags.slice(0, 2).join(" and ") || "a cohesive vibe";
  return `${artistText} consistently pull this lane toward ${tagText}.`;
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

export function uniqueNormalizedArtists(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const normalized = normalizeArtist(cleaned);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleaned);
  }
  return output;
}

export function countTagOverlap(candidateTags: string[], laneTags: string[]): number {
  if (candidateTags.length === 0 || laneTags.length === 0) return 0;
  const laneTagSet = new Set(laneTags.map((tag) => tag.toLowerCase()));
  return candidateTags.reduce((count, tag) => {
    return laneTagSet.has(tag.toLowerCase()) ? count + 1 : count;
  }, 0);
}

function expandLaneMemberArtists(params: {
  representativeArtists: string[];
  memberArtists: string[];
  laneTags: string[];
  artistProfiles: ArtistProfile[];
}): string[] {
  const representativeArtists = uniqueNormalizedArtists(params.representativeArtists);
  const seedMembers = uniqueNormalizedArtists([...params.memberArtists, ...representativeArtists]);
  const targetCount = Math.min(15, representativeArtists.length + 4);
  if (seedMembers.length >= targetCount) {
    return seedMembers.slice(0, targetCount);
  }

  const used = new Set(seedMembers.map((artist) => normalizeArtist(artist)));
  const rankedCandidates = [...params.artistProfiles]
    .filter((profile) => !used.has(profile.normalizedName))
    .sort((a, b) => {
      const overlapDiff = countTagOverlap(b.tags, params.laneTags) - countTagOverlap(a.tags, params.laneTags);
      if (overlapDiff !== 0) return overlapDiff;
      return b.periodPlaycount - a.periodPlaycount;
    });

  const output = [...seedMembers];
  for (const candidate of rankedCandidates) {
    if (output.length >= targetCount) break;
    output.push(candidate.artistName);
    used.add(candidate.normalizedName);
  }

  return output;
}

function cleanBioSnippet(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/Read more on Last\.fm\.?/gi, "")
    .trim()
    .slice(0, 180);
}

async function buildLaneSimilarHints(params: {
  username: string;
  lane: Lane;
  perSeedLimit?: number;
  maxHints?: number;
}): Promise<SimilarArtistHint[]> {
  const perSeedLimit = params.perSeedLimit ?? 8;
  const maxHints = params.maxHints ?? 36;
  const seedArtists = uniqueNormalizedArtists([...(params.lane.memberArtists ?? []), ...params.lane.artists]).slice(0, 8);

  const hintsByArtist = new Map<string, SimilarArtistHint>();

  for (const seed of seedArtists) {
    const similar = await getSimilarArtistProfiles({
      artistName: seed,
      username: params.username,
      limit: perSeedLimit,
    });

    for (const match of similar) {
      const seedNormalized = normalizeArtist(seed);
      if (seedNormalized === match.normalizedName) continue;

      const existing = hintsByArtist.get(match.normalizedName);
      if (!existing) {
        hintsByArtist.set(match.normalizedName, {
          artistName: match.artistName,
          normalizedName: match.normalizedName,
          supportSeeds: [seed],
          aggregateMatch: match.match,
        });
        continue;
      }

      if (!existing.supportSeeds.some((seedArtist) => normalizeArtist(seedArtist) === seedNormalized)) {
        existing.supportSeeds.push(seed);
      }
      existing.aggregateMatch += match.match;
    }
  }

  return [...hintsByArtist.values()]
    .sort((a, b) => {
      if (b.supportSeeds.length !== a.supportSeeds.length) {
        return b.supportSeeds.length - a.supportSeeds.length;
      }
      return b.aggregateMatch - a.aggregateMatch;
    })
    .slice(0, maxHints);
}

export function laneToContext(lane: Lane): LaneContext {
  return {
    laneId: lane.id,
    label: lane.name,
    description: lane.description,
    representativeArtists: uniqueNormalizedArtists(lane.artists),
    memberArtists: uniqueNormalizedArtists(lane.memberArtists ?? lane.artists),
    tags: [...new Set((lane.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    sourceWindow: lane.sourceWindow ?? "Selected analysis window",
    similarHints: lane.similarHints ?? [],
  };
}

async function attachSimilarHintsToLanes(params: { username: string; lanes: Lane[] }): Promise<Lane[]> {
  return Promise.all(
    params.lanes.map(async (lane) => {
      const similarHints = await buildLaneSimilarHints({
        username: params.username,
        lane,
      });

      return {
        ...lane,
        artists: uniqueNormalizedArtists(lane.artists),
        memberArtists: uniqueNormalizedArtists(lane.memberArtists ?? lane.artists),
        similarHints,
      };
    }),
  );
}

export async function buildListeningSnapshot(params: {
  username: string;
  timeWindow: TimeWindow;
  weeklyArtistsOverride?: Array<{ artistName: string; normalizedName: string; playcount: number }>;
  knownArtistsOverride?: Array<{ artistName: string; normalizedName: string; playcount: number }>;
  includeRecentTail?: boolean;
}): Promise<ListeningSnapshot> {
  const [initialWeeklyArtists, initialKnownArtists, topTracks] = await Promise.all([
    params.weeklyArtistsOverride ??
      getAggregatedWeeklyArtists({
        username: params.username,
        from: params.timeWindow.from,
        to: params.timeWindow.to,
      }),
    params.knownArtistsOverride ?? getKnownArtists({ username: params.username }),
    getTopTrackSummary(params.username),
  ]);
  let weeklyArtists = initialWeeklyArtists;
  let knownArtists = initialKnownArtists;

  if (params.includeRecentTail !== false) {
    const effectiveEnd = Math.min(params.timeWindow.to, Math.floor(Date.now() / 1000));
    const latestWeeklyBoundary = await getLatestWeeklyChartBoundary({ username: params.username });
    const tailFrom = latestWeeklyBoundary ? Math.max(params.timeWindow.from, latestWeeklyBoundary + 1) : params.timeWindow.from;
    if (effectiveEnd >= tailFrom) {
      const recentTail = await getRecentArtistCounts({
        username: params.username,
        from: tailFrom,
        to: effectiveEnd,
      });
      if (recentTail.length > 0) {
        const byArtist = new Map(weeklyArtists.map((row) => [row.normalizedName, { ...row }]));
        for (const row of recentTail) {
          const existing = byArtist.get(row.normalizedName);
          if (existing) {
            existing.playcount += row.playcount;
          } else {
            byArtist.set(row.normalizedName, { ...row });
          }
        }
        weeklyArtists = [...byArtist.values()].sort((a, b) => b.playcount - a.playcount);
      }

      if (!params.knownArtistsOverride && recentTail.length > 0) {
        const knownByArtist = new Map(knownArtists.map((row) => [row.normalizedName, { ...row }]));
        for (const row of recentTail) {
          const existing = knownByArtist.get(row.normalizedName);
          if (existing) {
            existing.playcount += row.playcount;
          } else {
            knownByArtist.set(row.normalizedName, { ...row });
          }
        }
        knownArtists = [...knownByArtist.values()].sort((a, b) => b.playcount - a.playcount);
      }
    }
  }

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
      const representativeArtists = lane.artists.slice(0, 6);
      const expandedMembers = expandLaneMemberArtists({
        representativeArtists,
        memberArtists,
        laneTags: lane.tags,
        artistProfiles: snapshot.artistProfiles,
      });

      return {
        id: lane.id || `lane-${index + 1}`,
        label: lane.name,
        description: lane.description,
        representativeArtists,
        memberArtists: expandedMembers,
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
    summary: `Your listening in ${snapshot.timeWindow.label.toLowerCase()} splits into ${fallback.length} distinct taste lanes with clear artist anchors.`,
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
  timing: {
    llmLaneModelMs: number;
    similarHintsMs: number;
    totalMs: number;
    usedFallback: boolean;
    llmLaneModel: {
      promptBuildMs: number;
      llmRequestMs: number;
      parseValidateMs: number;
      llmTotalMs: number;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    };
  };
}> {
  const totalStart = Date.now();
  const client = getOpenAIClient();
  const model = getOpenAIModel();
  const reasoningEffort = getOpenAIReasoningEffort();
  let promptBuildMs = 0;
  let llmRequestMs = 0;
  let parseValidateMs = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;

  try {
    const promptBuildStart = Date.now();
    const artistInput = snapshot.artistProfiles.slice(0, 24).map((profile) => ({
      artist: profile.artistName,
      plays: profile.periodPlaycount,
      allTimePlaycount: profile.allTimePlaycount,
      tags: profile.tags.slice(0, 4),
      similarHints: profile.similarArtists.slice(0, 2),
    }));

    const userPayload = JSON.stringify({
      username: snapshot.username,
      sourceWindow: snapshot.timeWindow.label,
      summary: snapshot.summary,
      artists: artistInput,
    });
    promptBuildMs = Date.now() - promptBuildStart;

    const llmStart = Date.now();
    const completion = await client.chat.completions.parse({
      model,
      reasoning_effort: reasoningEffort,
      messages: [
        {
          role: "system",
          content:
            "You are a music taste analyst. Group artists into exactly 3 practical discovery lanes using only supplied evidence. Use vivid, listener-friendly language with musical texture and mood. Keep output concise: summary <= 220 chars, each notable pattern <= 140 chars, lane label <= 48 chars, lane description <= 180 chars, lane reasoning <= 180 chars. Avoid technical framing. Do not mention internal limitations or terms such as metadata quality, sparse data, deterministic logic, model behavior, schemas, or parsing.",
        },
        {
          role: "user",
          content: userPayload,
        },
      ],
      response_format: zodResponseFormat(laneModelSchema, "taste_lanes"),
    });
    llmRequestMs = Date.now() - llmStart;
    inputTokens = completion.usage?.prompt_tokens ?? null;
    outputTokens = completion.usage?.completion_tokens ?? null;
    totalTokens = completion.usage?.total_tokens ?? null;

    const parseStart = Date.now();
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

      const laneTagSeed = summarizeTags(
        snapshot.artistProfiles.filter((profile) =>
          new Set(uniqueNormalizedArtists([...memberArtists, ...representativeArtists]).map(normalizeArtist)).has(profile.normalizedName),
        ),
      ).slice(0, 6);
      const expandedMembers = expandLaneMemberArtists({
        representativeArtists,
        memberArtists,
        laneTags: laneTagSeed,
        artistProfiles: snapshot.artistProfiles,
      });

      const totalPlays = expandedMembers.reduce(
        (sum, name) => sum + (periodPlayMap.get(normalizeArtist(name)) ?? 0),
        0,
      );

      const tags = summarizeTags(
        snapshot.artistProfiles.filter((profile) =>
          new Set(expandedMembers.map(normalizeArtist)).has(profile.normalizedName),
        ),
      ).slice(0, 6);

      return {
        id: slugify(`${lane.label}-${idx + 1}`) || `lane-${idx + 1}`,
        label: lane.label,
        description: enrichLaneDescription({
          description: lane.description,
          representativeArtists,
          tags,
        }),
        representativeArtists,
        memberArtists: expandedMembers,
        confidence: Math.min(1, Math.max(0, lane.confidence)),
        sourceWindow: snapshot.timeWindow.label,
        context: {
          tags,
          totalPlays,
          evidence: [
            enrichLaneReasoning({
              reasoning: lane.reasoning,
              representativeArtists,
              tags,
            }),
          ],
        },
      };
    });
    parseValidateMs = Date.now() - parseStart;
    const llmLaneModelMs = promptBuildMs + llmRequestMs + parseValidateMs;

    const hintsStart = Date.now();
    const lanesWithHints = await attachSimilarHintsToLanes({
      username: snapshot.username,
      lanes: mapTasteLanesToUi(lanes),
    });
    const similarHintsMs = Date.now() - hintsStart;

    return {
      summary: parsed.summary,
      notablePatterns: parsed.notablePatterns,
      lanes: lanesWithHints,
      timing: {
        llmLaneModelMs,
        similarHintsMs,
        totalMs: Date.now() - totalStart,
        usedFallback: false,
        llmLaneModel: {
          promptBuildMs,
          llmRequestMs,
          parseValidateMs,
          llmTotalMs: llmLaneModelMs,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
        },
      },
    };
  } catch {
    const llmLaneModelMs = promptBuildMs + llmRequestMs + parseValidateMs;
    const fallback = buildFallbackLanes(snapshot);
    const hintsStart = Date.now();
    const lanesWithHints = await attachSimilarHintsToLanes({
      username: snapshot.username,
      lanes: mapTasteLanesToUi(fallback.lanes),
    });
    const similarHintsMs = Date.now() - hintsStart;

    return {
      summary: fallback.summary,
      notablePatterns: fallback.notablePatterns,
      lanes: lanesWithHints,
      timing: {
        llmLaneModelMs,
        similarHintsMs,
        totalMs: Date.now() - totalStart,
        usedFallback: true,
        llmLaneModel: {
          promptBuildMs,
          llmRequestMs,
          parseValidateMs,
          llmTotalMs: llmLaneModelMs,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
        },
      },
    };
  }
}

export function rankCandidate(params: {
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
  laneContext: LaneContext;
  candidates: Array<{
    artist: string;
    matchSource: string;
    tags: string[];
    bioSnippet: string;
    supportingSeedArtists: string[];
  }>;
}): Promise<{
  explanations: Map<string, string>;
  timing: {
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
}> {
  const client = getOpenAIClient();
  const model = getOpenAIModel();
  const reasoningEffort = getOpenAIReasoningEffort();
  let promptBuildMs = 0;
  let llmRequestMs = 0;
  let parseValidateMs = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;

  try {
    const promptBuildStart = Date.now();
    const candidatesPayload = params.candidates.map((candidate) => ({
      artist: candidate.artist,
      matchSource: candidate.matchSource,
      tags: candidate.tags,
      bioSnippet: candidate.bioSnippet,
      supportingSeedArtists: candidate.supportingSeedArtists.slice(0, 2),
    }));

    const userPayload = JSON.stringify({
      lane: {
        label: params.laneContext.label,
        description: params.laneContext.description,
        tags: params.laneContext.tags,
      },
      candidates: candidatesPayload,
    });
    promptBuildMs = Date.now() - promptBuildStart;

    const llmStart = Date.now();
    const completion = await client.chat.completions.parse({
      model,
      reasoning_effort: reasoningEffort,
      messages: [
        {
          role: "system",
          content:
            "You are a playlist editor writing short artist blurbs. Write 1-2 sentences that feel human, specific, and musical. Keep each blurb <= 220 characters. Describe the artist's sound and mood first, then optionally connect to the lane. Never mention internal ranking logic, algorithms, similarity scores, seeds, novelty, pipelines, metadata, LLMs, or system mechanics. Use only supplied facts; do not invent albums, tracks, or biography details.",
        },
        {
          role: "user",
          content: userPayload,
        },
      ],
      response_format: zodResponseFormat(explanationSchema, "recommendation_explanations"),
    });
    llmRequestMs = Date.now() - llmStart;
    inputTokens = completion.usage?.prompt_tokens ?? null;
    outputTokens = completion.usage?.completion_tokens ?? null;
    totalTokens = completion.usage?.total_tokens ?? null;

    const parseStart = Date.now();
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      throw new Error("Explanation output missing.");
    }

    const map = new Map<string, string>();
    for (const item of parsed.explanations) {
      map.set(normalizeArtist(item.artist), item.blurb.trim());
    }
    parseValidateMs = Date.now() - parseStart;
    return {
      explanations: map,
      timing: {
        promptBuildMs,
        llmRequestMs,
        parseValidateMs,
        llmTotalMs: promptBuildMs + llmRequestMs + parseValidateMs,
        model,
        candidateCount: params.candidates.length,
        inputTokens,
        outputTokens,
        totalTokens,
        usedFallback: false,
      },
    };
  } catch {
    return {
      explanations: new Map(),
      timing: {
        promptBuildMs,
        llmRequestMs,
        parseValidateMs,
        llmTotalMs: promptBuildMs + llmRequestMs + parseValidateMs,
        model,
        candidateCount: params.candidates.length,
        inputTokens,
        outputTokens,
        totalTokens,
        usedFallback: true,
      },
    };
  }
}

function buildEditorialFallbackBlurb(params: {
  artist: string;
  laneLabel: string;
  tags: string[];
  supportingSeedArtists: string[];
  bioSnippet: string;
}): string {
  const tagText = params.tags.slice(0, 2).join(" and ");
  const seed = params.supportingSeedArtists[0];

  if (params.bioSnippet.trim().length > 0) {
    return `${params.bioSnippet.trim()} This sits naturally in your ${params.laneLabel.toLowerCase()} lane${seed ? ` next to ${seed}` : ""}.`;
  }

  if (tagText) {
    return `${params.artist} leans into ${tagText} textures that suit the mood of your ${params.laneLabel.toLowerCase()} lane${seed ? ` alongside ${seed}` : ""}.`;
  }

  return `${params.artist} matches the tone and pacing of your ${params.laneLabel.toLowerCase()} lane${seed ? `, especially if you like ${seed}` : ""}.`;
}

export async function generateDeterministicRecommendations(params: {
  username: string;
  laneContext: LaneContext;
  knownArtists: Array<{ artistName: string; normalizedName: string; playcount: number }>;
  limit: number;
}): Promise<RecommendationResult> {
  const totalStart = Date.now();
  const limit = Math.max(1, Math.min(4, params.limit));
  const knownPlayMap = new Map(params.knownArtists.map((artist) => [artist.normalizedName, artist.playcount]));
  const seedArtists = uniqueNormalizedArtists([
    ...params.laneContext.memberArtists,
    ...params.laneContext.representativeArtists,
  ]).slice(0, 8);

  if (seedArtists.length === 0 && params.laneContext.similarHints.length === 0) {
    return {
      laneId: params.laneContext.laneId,
      laneLabel: params.laneContext.label,
      candidates: [],
      recommendations: [],
      strategyNote: "No recommendation seeds were available for this lane in the selected analysis window.",
    };
  }

  const laneTagSet = new Set(params.laneContext.tags.map((tag) => tag.toLowerCase()));
  const candidateMap = new Map<
    string,
    {
      artistName: string;
      supportSeeds: Set<string>;
      supportMatchTotal: number;
    }
  >();

  const upsertCandidate = (candidate: {
    normalizedName: string;
    artistName: string;
    seedArtist: string;
    matchScore: number;
  }) => {
    const existing = candidateMap.get(candidate.normalizedName);
    if (!existing) {
      candidateMap.set(candidate.normalizedName, {
        artistName: candidate.artistName,
        supportSeeds: new Set([candidate.seedArtist]),
        supportMatchTotal: candidate.matchScore,
      });
      return;
    }

    existing.supportSeeds.add(candidate.seedArtist);
    existing.supportMatchTotal += candidate.matchScore;
  };

  const seedMergeStart = Date.now();

  for (const hint of params.laneContext.similarHints) {
    for (const seedArtist of hint.supportSeeds) {
      upsertCandidate({
        normalizedName: hint.normalizedName,
        artistName: hint.artistName,
        seedArtist,
        matchScore: hint.aggregateMatch / Math.max(1, hint.supportSeeds.length),
      });
    }
  }
  const candidateSeedMergeMs = Date.now() - seedMergeStart;

  const similarExpansionStart = Date.now();
  for (const seed of seedArtists) {
    const similar = await getSimilarArtistProfiles({ artistName: seed, username: params.username, limit: 24 });
    for (const match of similar) {
      upsertCandidate({
        normalizedName: match.normalizedName,
        artistName: match.artistName,
        seedArtist: seed,
        matchScore: match.match,
      });
    }
  }
  const similarExpansionMs = Date.now() - similarExpansionStart;

  const rankingStart = Date.now();
  const rankedCandidates = [...candidateMap.entries()]
    .map(([normalizedName, value]) => ({ normalizedName, ...value }))
    .sort((a, b) => b.supportMatchTotal - a.supportMatchTotal)
    .slice(0, 30);

  const recommendationCandidates: RecommendationCandidate[] = [];

  const profileEnrichmentStart = Date.now();
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

    recommendationCandidates.push({
      artistName: candidate.artistName,
      normalizedName: candidate.normalizedName,
      supportingSeedArtists: [...candidate.supportSeeds],
      evidence: rank.evidence,
      status: excluded ? "excluded" : "included",
      finalScore: excluded ? rank.score - 30 : rank.score,
      metadata: {
        tags: profile.tags.slice(0, 6),
        bioSnippet: cleanBioSnippet(profile.bio),
        listeners: profile.listeners,
        knownPlaycount,
        supportMatchTotal: candidate.supportMatchTotal,
      },
    });
  }
  const profileEnrichmentMs = Date.now() - profileEnrichmentStart;

  const selected = recommendationCandidates
    .filter((candidate) => candidate.status === "included")
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
  const rankingMs = Date.now() - rankingStart;

  const baseRecommendations: Recommendation[] = selected.map((candidate) => {
    const tags = ((candidate.metadata.tags as string[] | undefined) ?? []).slice(0, 5);
    const bioSnippet = ((candidate.metadata.bioSnippet as string | undefined) ?? "").trim();
    const supportingSeedArtists = candidate.supportingSeedArtists;

    return {
      artist: candidate.artistName,
      score: Math.round(candidate.finalScore),
      reason: candidate.evidence[0] ?? "Supported by similar artists in this lane.",
      blurb: buildEditorialFallbackBlurb({
        artist: candidate.artistName,
        laneLabel: params.laneContext.label,
        tags,
        supportingSeedArtists,
        bioSnippet,
      }),
      recommendedAlbum: null,
      matchSource: candidate.supportingSeedArtists[0] ?? params.laneContext.representativeArtists[0] ?? "lane_seed",
      tags,
      evidence: candidate.evidence,
    };
  });

  if (selected.length === 0) {
    return {
      laneId: params.laneContext.laneId,
      laneLabel: params.laneContext.label,
      candidates: recommendationCandidates,
      recommendations: baseRecommendations,
      strategyNote:
        "No eligible new-to-you artists were found for this lane after known-history filtering. Try another lane or a broader time window.",
      timing: {
        candidateSeedMergeMs,
        similarExpansionMs,
        profileEnrichmentMs,
        rankingMs,
        explanationMs: 0,
        albumLookupMs: 0,
        totalMs: Date.now() - totalStart,
      },
    };
  }

  const explanationStart = Date.now();
  const explanationResult = await generateRecommendationExplanations({
    laneContext: params.laneContext,
    candidates: selected.map((candidate) => ({
      artist: candidate.artistName,
      matchSource: candidate.supportingSeedArtists[0] ?? params.laneContext.representativeArtists[0] ?? "lane_seed",
      tags: ((candidate.metadata.tags as string[] | undefined) ?? []).slice(0, 5),
      bioSnippet: ((candidate.metadata.bioSnippet as string | undefined) ?? "").trim(),
      supportingSeedArtists: candidate.supportingSeedArtists,
    })),
  });
  const explanationMap = explanationResult.explanations;
  const explanationMs = Date.now() - explanationStart;

  const albumLookupStart = Date.now();
  const albumByArtist = new Map<string, string | null>();
  await Promise.all(
    selected.map(async (candidate) => {
      const album = await getArtistTopAlbumSuggestion({ artistName: candidate.artistName });
      albumByArtist.set(normalizeArtist(candidate.artistName), album);
    }),
  );
  const albumLookupMs = Date.now() - albumLookupStart;

  const recommendations = baseRecommendations.map((recommendation) => ({
    ...recommendation,
    blurb:
      explanationMap.get(normalizeArtist(recommendation.artist)) ??
      recommendation.blurb,
    recommendedAlbum: albumByArtist.get(normalizeArtist(recommendation.artist)) ?? null,
  }));

  return {
    laneId: params.laneContext.laneId,
    laneLabel: params.laneContext.label,
    candidates: recommendationCandidates,
    recommendations,
    strategyNote:
      "Candidates are generated deterministically from lane seed neighborhoods, filtered against broad known history, ranked by support + overlap + novelty, then explained by the LLM.",
    timing: {
      candidateSeedMergeMs,
      similarExpansionMs,
      profileEnrichmentMs,
      rankingMs,
      explanationMs,
      llmExplanation: explanationResult.timing,
      albumLookupMs,
      totalMs: Date.now() - totalStart,
    },
  };
}
