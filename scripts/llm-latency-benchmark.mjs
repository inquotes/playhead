import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

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

const syntheticLaneInput = {
  username: "benchmark-listener",
  sourceWindow: "Last 6 months",
  summary: {
    artistCount: 24,
    totalPlays: 2865,
    topTags: ["indie", "dream pop", "post-punk", "shoegaze", "electronica", "alt rock"],
  },
  artists: [
    { artist: "Fontaines D.C.", plays: 241, allTimePlaycount: 612, tags: ["post-punk", "indie", "irish"], similarHints: ["Shame", "The Murder Capital"] },
    { artist: "Alvvays", plays: 209, allTimePlaycount: 842, tags: ["indie pop", "dream pop", "jangle pop"], similarHints: ["Snail Mail", "Soccer Mommy"] },
    { artist: "Caroline Polachek", plays: 187, allTimePlaycount: 499, tags: ["art pop", "synthpop", "experimental"], similarHints: ["FKA twigs", "Rina Sawayama"] },
    { artist: "Sufjan Stevens", plays: 176, allTimePlaycount: 921, tags: ["indie", "folk", "chamber pop"], similarHints: ["Bon Iver", "Phoebe Bridgers"] },
    { artist: "Japanese Breakfast", plays: 169, allTimePlaycount: 455, tags: ["indie rock", "dream pop", "electronic"], similarHints: ["Mitski", "Beach House"] },
    { artist: "IDLES", plays: 161, allTimePlaycount: 381, tags: ["post-punk", "punk", "noise rock"], similarHints: ["Viagra Boys", "Gilla Band"] },
    { artist: "Beach House", plays: 154, allTimePlaycount: 1032, tags: ["dream pop", "shoegaze", "indie"], similarHints: ["Cocteau Twins", "Slowdive"] },
    { artist: "Big Thief", plays: 147, allTimePlaycount: 577, tags: ["indie folk", "indie rock", "americana"], similarHints: ["Angel Olsen", "Adrianne Lenker"] },
    { artist: "The National", plays: 141, allTimePlaycount: 1102, tags: ["indie rock", "baroque pop", "alternative"], similarHints: ["Interpol", "The War on Drugs"] },
    { artist: "Yves Tumor", plays: 133, allTimePlaycount: 218, tags: ["experimental", "art rock", "electronic"], similarHints: ["Arca", "Dean Blunt"] },
    { artist: "Slowdive", plays: 128, allTimePlaycount: 648, tags: ["shoegaze", "dream pop", "ambient"], similarHints: ["Lush", "Ride"] },
    { artist: "Arca", plays: 121, allTimePlaycount: 173, tags: ["electronic", "experimental", "deconstructed club"], similarHints: ["SOPHIE", "Eartheater"] },
    { artist: "The Smile", plays: 115, allTimePlaycount: 229, tags: ["art rock", "alternative", "experimental"], similarHints: ["Radiohead", "Atoms for Peace"] },
    { artist: "Phoebe Bridgers", plays: 110, allTimePlaycount: 731, tags: ["indie folk", "singer-songwriter", "indie"], similarHints: ["Lucy Dacus", "Julien Baker"] },
    { artist: "Kelela", plays: 104, allTimePlaycount: 266, tags: ["r&b", "electronic", "alternative r&b"], similarHints: ["FKA twigs", "Sevdaliza"] },
    { artist: "Magdalena Bay", plays: 99, allTimePlaycount: 307, tags: ["synthpop", "indie pop", "electropop"], similarHints: ["CHVRCHES", "MUNA"] },
    { artist: "Parannoul", plays: 93, allTimePlaycount: 122, tags: ["shoegaze", "emo", "post-rock"], similarHints: ["Asian Glow", "Weatherday"] },
    { artist: "Bicep", plays: 88, allTimePlaycount: 344, tags: ["electronic", "breakbeat", "house"], similarHints: ["Overmono", "Four Tet"] },
    { artist: "King Krule", plays: 84, allTimePlaycount: 289, tags: ["post-punk", "jazz", "indie"], similarHints: ["Black Country, New Road", "Mount Kimbie"] },
    { artist: "Ethel Cain", plays: 80, allTimePlaycount: 205, tags: ["ambient", "americana", "art pop"], similarHints: ["Weyes Blood", "Chelsea Wolfe"] },
    { artist: "Dry Cleaning", plays: 75, allTimePlaycount: 141, tags: ["post-punk", "spoken word", "indie"], similarHints: ["Sleaford Mods", "Squid"] },
    { artist: "Overmono", plays: 71, allTimePlaycount: 188, tags: ["electronic", "uk garage", "breakbeat"], similarHints: ["Joy Orbison", "Bicep"] },
    { artist: "Weyes Blood", plays: 67, allTimePlaycount: 358, tags: ["baroque pop", "art pop", "singer-songwriter"], similarHints: ["Julia Holter", "Angel Olsen"] },
    { artist: "Angel Olsen", plays: 63, allTimePlaycount: 493, tags: ["indie rock", "folk", "americana"], similarHints: ["Sharon Van Etten", "Big Thief"] },
  ],
};

const syntheticExplanationInput = {
  lane: {
    label: "Nocturnal art-pop and electronic",
    description: "Night-drive textures, left-field pop hooks, and cinematic detail.",
    tags: ["art pop", "electronic", "dream pop", "experimental"],
  },
  candidates: [
    {
      artist: "Fever Ray",
      matchSource: "Arca",
      tags: ["electronic", "art pop", "darkwave", "experimental"],
      bioSnippet: "Swedish project with eerie synth design, ritual percussion, and theatrical vocal character.",
      supportingSeedArtists: ["Arca", "Kelela"],
    },
    {
      artist: "Julia Holter",
      matchSource: "Weyes Blood",
      tags: ["art pop", "chamber pop", "ambient", "experimental"],
      bioSnippet: "Layered compositions that balance intimate songwriting with avant-pop architecture.",
      supportingSeedArtists: ["Weyes Blood", "Sufjan Stevens"],
    },
    {
      artist: "Sevdaliza",
      matchSource: "Kelela",
      tags: ["alternative r&b", "electronic", "trip hop", "art pop"],
      bioSnippet: "Brooding low-end and sculpted vocals, moving between minimal beats and cinematic atmosphere.",
      supportingSeedArtists: ["Kelela", "FKA twigs"],
    },
    {
      artist: "ionnalee",
      matchSource: "Caroline Polachek",
      tags: ["electropop", "art pop", "ambient pop", "synthpop"],
      bioSnippet: "Expansive synth-pop with emotional melodies and futuristic production detail.",
      supportingSeedArtists: ["Caroline Polachek", "Magdalena Bay"],
    },
  ],
};

function parseList(value, fallback) {
  if (!value) return fallback;
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

function mean(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function summarize(rows) {
  const requestMs = rows.map((row) => row.requestMs);
  const totalTokens = rows.map((row) => row.totalTokens).filter((value) => typeof value === "number");
  const finishReasonCounts = rows.reduce((acc, row) => {
    const key = row.finishReason ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    runs: rows.length,
    finishReasons: finishReasonCounts,
    requestMs: {
      avg: mean(requestMs),
      min: Math.min(...requestMs),
      max: Math.max(...requestMs),
    },
    totalTokens:
      totalTokens.length > 0
        ? {
            avg: mean(totalTokens),
            min: Math.min(...totalTokens),
            max: Math.max(...totalTokens),
          }
        : null,
  };
}

async function benchmarkCase(client, { model, reasoningEffort, iterations }) {
  const { laneInput, explanationInput, source } = await loadBenchmarkInputs();
  const laneRuns = [];
  const explanationRuns = [];
  const maxCompletionTokens = Math.max(512, Number(process.env.BENCH_MAX_COMPLETION_TOKENS ?? 8000));
  const requestTimeoutMs = Math.max(5000, Number(process.env.BENCH_REQUEST_TIMEOUT_MS ?? 120000));

  console.error(`[bench] start model=${model} effort=${reasoningEffort} iterations=${iterations}`);

  for (let index = 0; index < iterations; index += 1) {
    const iterationLabel = `${index + 1}/${iterations}`;
    const laneStart = Date.now();
    const laneCompletion = await withTimeout(
      client.chat.completions.create({
        model,
        reasoning_effort: reasoningEffort,
        max_completion_tokens: maxCompletionTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a music taste analyst. Group artists into exactly 3 practical discovery lanes using only supplied evidence. Use vivid, listener-friendly language with musical texture and mood. Keep output concise: summary <= 220 chars, each notable pattern <= 140 chars, lane label <= 48 chars, lane description <= 180 chars, lane reasoning <= 180 chars.",
          },
          { role: "user", content: JSON.stringify(laneInput) },
        ],
        response_format: zodResponseFormat(laneModelSchema, "taste_lanes"),
      }),
      requestTimeoutMs,
      `lane ${model} ${reasoningEffort} ${iterationLabel}`,
    );
    console.error(
      `[bench] lane done model=${model} effort=${reasoningEffort} iter=${iterationLabel} ms=${Date.now() - laneStart}`,
    );
    laneRuns.push({
      requestMs: Date.now() - laneStart,
      finishReason: laneCompletion.choices?.[0]?.finish_reason ?? null,
      inputTokens: laneCompletion.usage?.prompt_tokens ?? null,
      outputTokens: laneCompletion.usage?.completion_tokens ?? null,
      totalTokens: laneCompletion.usage?.total_tokens ?? null,
    });

    const explanationStart = Date.now();
    const explanationCompletion = await withTimeout(
      client.chat.completions.create({
        model,
        reasoning_effort: reasoningEffort,
        max_completion_tokens: maxCompletionTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a playlist editor writing short artist blurbs. Write 1-2 sentences that feel human, specific, and musical. Keep each blurb <= 220 characters. Use only supplied facts.",
          },
          { role: "user", content: JSON.stringify(explanationInput) },
        ],
        response_format: zodResponseFormat(explanationSchema, "recommendation_explanations"),
      }),
      requestTimeoutMs,
      `explanation ${model} ${reasoningEffort} ${iterationLabel}`,
    );
    console.error(
      `[bench] explanation done model=${model} effort=${reasoningEffort} iter=${iterationLabel} ms=${Date.now() - explanationStart}`,
    );
    explanationRuns.push({
      requestMs: Date.now() - explanationStart,
      finishReason: explanationCompletion.choices?.[0]?.finish_reason ?? null,
      inputTokens: explanationCompletion.usage?.prompt_tokens ?? null,
      outputTokens: explanationCompletion.usage?.completion_tokens ?? null,
      totalTokens: explanationCompletion.usage?.total_tokens ?? null,
    });
  }

  return {
    model,
    reasoningEffort,
    source,
    requestTimeoutMs,
    maxCompletionTokens,
    lane: summarize(laneRuns),
    explanation: summarize(explanationRuns),
  };
}

async function loadBenchmarkInputs() {
  const sourceMode = (process.env.BENCH_SOURCE ?? "real").trim().toLowerCase();
  if (sourceMode === "synthetic") {
    return {
      source: "synthetic",
      laneInput: syntheticLaneInput,
      explanationInput: syntheticExplanationInput,
    };
  }

  const prisma = new PrismaClient();
  try {
    const analyzeAgentRun = await prisma.agentRun.findFirst({
      where: { mode: "analyze", status: "completed", resultJson: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, resultJson: true },
    });

    const recommendAgentRun = await prisma.agentRun.findFirst({
      where: { mode: "recommend", status: "completed", resultJson: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, resultJson: true },
    });

    if (!analyzeAgentRun || !recommendAgentRun) {
      return {
        source: "synthetic_fallback_missing_runs",
        laneInput: syntheticLaneInput,
        explanationInput: syntheticExplanationInput,
      };
    }

    const analyzeResult = analyzeAgentRun.resultJson;
    const recommendResult = recommendAgentRun.resultJson;
    const topArtists = Array.isArray(analyzeResult?.topArtists) ? analyzeResult.topArtists : [];
    const lane = recommendResult?.lane ?? null;
    const recommendations = Array.isArray(recommendResult?.recommendations) ? recommendResult.recommendations : [];
    const recommendationRunId = typeof recommendResult?.recommendationRunId === "string" ? recommendResult.recommendationRunId : null;

    let candidateMetadataByArtist = new Map();
    if (recommendationRunId) {
      const recommendationRun = await prisma.recommendationRun.findUnique({
        where: { id: recommendationRunId },
        select: { resultsJson: true },
      });
      const candidates = Array.isArray(recommendationRun?.resultsJson?.candidates)
        ? recommendationRun.resultsJson.candidates
        : [];
      candidateMetadataByArtist = new Map(
        candidates.map((candidate) => [
          String(candidate.artistName ?? "").toLowerCase(),
          {
            tags: Array.isArray(candidate?.metadata?.tags) ? candidate.metadata.tags : [],
            bioSnippet: typeof candidate?.metadata?.bioSnippet === "string" ? candidate.metadata.bioSnippet : "",
            supportingSeedArtists: Array.isArray(candidate?.supportingSeedArtists) ? candidate.supportingSeedArtists : [],
          },
        ]),
      );
    }

    const laneInput = {
      username: analyzeResult?.targetUsername ?? "benchmark-listener",
      sourceWindow: analyzeResult?.range?.label ?? "Recent period",
      summary: analyzeResult?.summary ?? {
        artistCount: topArtists.length,
        totalPlays: topArtists.reduce((sum, artist) => sum + Number(artist?.periodPlaycount ?? 0), 0),
      },
      artists: topArtists.slice(0, 24).map((artist) => ({
        artist: artist?.artistName ?? "Unknown Artist",
        plays: Number(artist?.periodPlaycount ?? 0),
        allTimePlaycount: Number(artist?.periodPlaycount ?? 0),
        tags: [],
        similarHints: [],
      })),
    };

    const mappedCandidates = recommendations.slice(0, 4).map((recommendation) => {
      const artist = String(recommendation?.artist ?? "Unknown Artist");
      const candidate = candidateMetadataByArtist.get(artist.toLowerCase()) ?? {
        tags: [],
        bioSnippet: "",
        supportingSeedArtists: [],
      };
      const recommendationTags = Array.isArray(recommendation?.tags) ? recommendation.tags : [];
      return {
        artist,
        matchSource: recommendation?.matchSource ?? "lane_seed",
        tags: recommendationTags.length > 0 ? recommendationTags : candidate.tags,
        bioSnippet: candidate.bioSnippet,
        supportingSeedArtists: candidate.supportingSeedArtists,
      };
    });

    const explanationInput = {
      lane: {
        label: lane?.name ?? "Discovery lane",
        description: lane?.description ?? "",
        tags: Array.isArray(lane?.tags) ? lane.tags : [],
      },
      candidates: mappedCandidates.length > 0 ? mappedCandidates : syntheticExplanationInput.candidates,
    };

    if (laneInput.artists.length === 0) {
      return {
        source: "synthetic_fallback_empty_artists",
        laneInput: syntheticLaneInput,
        explanationInput,
      };
    }

    return {
      source: `real_db:${analyzeAgentRun.id}:${recommendAgentRun.id}`,
      laneInput,
      explanationInput,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const models = parseList(process.env.BENCH_MODELS, [process.env.OPENAI_MODEL ?? "gpt-5-nano"]);
  const reasoningEfforts = parseList(process.env.BENCH_REASONING_EFFORTS, [process.env.OPENAI_REASONING_EFFORT ?? "low"]);
  const iterations = Math.max(1, Number(process.env.BENCH_ITERATIONS ?? 3));

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const results = [];
  const failures = [];

  for (const model of models) {
    for (const reasoningEffort of reasoningEfforts) {
      try {
        const result = await benchmarkCase(client, { model, reasoningEffort, iterations });
        results.push(result);
      } catch (error) {
        failures.push({
          model,
          reasoningEffort,
          message: error instanceof Error ? error.message : String(error),
        });
        console.error(`[bench] failed model=${model} effort=${reasoningEffort} error=${failures[failures.length - 1].message}`);
      }
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    iterations,
    failures,
    results,
  }, null, 2));
}

await main();
