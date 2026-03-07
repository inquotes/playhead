import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { getOpenAIClient, getOpenAIModel } from "@/server/ai/client";
import { AGENT_POLICY_PROMPT, ANALYZE_AGENT_TASK, RECOMMEND_AGENT_TASK } from "@/server/agent/prompts";
import {
  analyzeFinalSchema,
  recommendFinalSchema,
  type AgentTraceStep,
  type AnalyzeFinal,
  type RecommendFinal,
} from "@/server/agent/schemas";
import {
  buildOpenAiTools,
  executeMappedTool,
  FINAL_ANALYZE_TOOL_NAME,
  FINAL_RECOMMEND_TOOL_NAME,
  getMappedMcpTools,
} from "@/server/agent/tool-registry";
import { parseMcpToolResult } from "@/server/agent/tool-parsers";

type AgentMode = "analyze" | "recommend";

type AgentTerminationReason = "final" | "budget_exhausted" | "timeout" | "error";

type AgentEvent = {
  type: string;
  payload: Record<string, unknown>;
};

type AgentTrace = {
  toolCallsUsed: number;
  maxToolCalls: number;
  terminationReason: AgentTerminationReason;
  steps: AgentTraceStep[];
};

type AnalyzeAgentResult = {
  mode: "analyze";
  output: AnalyzeFinal;
  trace: AgentTrace;
};

type RecommendAgentResult = {
  mode: "recommend";
  output: RecommendFinal;
  trace: AgentTrace;
};

function finalToolSchema(mode: AgentMode): Record<string, unknown> {
  if (mode === "analyze") {
    return {
      type: "object",
      properties: {
        summary: { type: "string" },
        notablePatterns: { type: "array", items: { type: "string" } },
        heardArtists: { type: "array", items: { type: "string" } },
        lanes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              whyThisLane: { type: "string" },
              confidence: { type: "number" },
              artists: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
              totalPlays: { type: "number" },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: [
              "id",
              "name",
              "description",
              "whyThisLane",
              "confidence",
              "artists",
              "tags",
              "totalPlays",
              "evidence",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "notablePatterns", "heardArtists", "lanes"],
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties: {
      strategyNote: { type: "string" },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            artist: { type: "string" },
            score: { type: "number" },
            reason: { type: "string" },
            matchSource: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            firstKnownYear: { type: ["number", "null"] },
            isLikelyNewEra: { type: "boolean" },
            evidence: { type: "array", items: { type: "string" } },
          },
          required: [
            "artist",
            "score",
            "reason",
            "matchSource",
            "tags",
            "firstKnownYear",
            "isLikelyNewEra",
            "evidence",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["strategyNote", "recommendations"],
    additionalProperties: false,
  };
}

function parseToolArgs(argsRaw: string | null | undefined): Record<string, unknown> {
  if (!argsRaw) return {};
  try {
    return JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildFinalTool(mode: AgentMode): ChatCompletionTool {
  const name = mode === "analyze" ? FINAL_ANALYZE_TOOL_NAME : FINAL_RECOMMEND_TOOL_NAME;
  return {
    type: "function",
    function: {
      name,
      description:
        mode === "analyze"
          ? "Submit final lane analysis output as structured JSON."
          : "Submit final recommendation output as structured JSON.",
      parameters: finalToolSchema(mode),
    },
  };
}

function validateFinal(mode: AgentMode, payload: Record<string, unknown>) {
  return mode === "analyze"
    ? analyzeFinalSchema.parse(coerceAnalyzePayload(payload))
    : recommendFinalSchema.parse(coerceRecommendPayload(payload));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceAnalyzePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const lanesRaw = Array.isArray(payload.lanes) ? payload.lanes : [];

  const lanes = lanesRaw.map((laneRaw, idx) => {
    const lane = (laneRaw ?? {}) as Record<string, unknown>;
    const artists = toStringArray(lane.artists ?? lane.seedArtists);
    const tags = toStringArray(lane.tags ?? lane.seedTags);
    const confidence = toNumberOrNull(lane.confidence) ?? 0.5;
    const totalPlays = toNumberOrNull(lane.totalPlays) ?? 0;

    return {
      id: String(lane.id ?? lane.name ?? `lane-${idx + 1}`).trim() || `lane-${idx + 1}`,
      name: String(lane.name ?? `Lane ${idx + 1}`),
      description: String(lane.description ?? "Coherent listening cluster for discovery."),
      whyThisLane: String(lane.whyThisLane ?? lane.description ?? "Grouped by repeated listening patterns."),
      confidence: Math.min(1, Math.max(0, confidence)),
      artists: artists.length > 0 ? artists : ["Unknown Artist", "Unknown Artist 2", "Unknown Artist 3"],
      tags: tags.length > 0 ? tags : ["discovery"],
      totalPlays: Math.max(0, Math.round(totalPlays)),
      evidence: toStringArray(lane.evidence).length > 0 ? toStringArray(lane.evidence) : ["Tool evidence gathered during analysis"],
    };
  });

  return {
    summary: String(payload.summary ?? "AI-generated lane analysis."),
    notablePatterns:
      toStringArray(payload.notablePatterns).length > 0
        ? toStringArray(payload.notablePatterns)
        : ["Distinct genre clusters found", "Sufficient signal for lane-based discovery"],
    heardArtists:
      toStringArray(payload.heardArtists).length > 0
        ? toStringArray(payload.heardArtists)
        : ["Unknown Artist"],
    lanes,
  };
}

function coerceRecommendPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const recsRaw = Array.isArray(payload.recommendations) ? payload.recommendations : [];

  const recommendations = recsRaw.map((recRaw, idx) => {
    const rec = (recRaw ?? {}) as Record<string, unknown>;
    const artist = String(rec.artist ?? rec.name ?? `Recommendation ${idx + 1}`).trim() || `Recommendation ${idx + 1}`;
    const score = toNumberOrNull(rec.score ?? rec.fitScore) ?? 65;
    const firstKnownYear = toNumberOrNull(rec.firstKnownYear);
    const matchSource = String(rec.matchSource ?? rec.source ?? "Lane similarity").trim() || "Lane similarity";
    const tags = toStringArray(rec.tags);
    const evidence = toStringArray(rec.evidence);

    return {
      artist,
      score: Math.min(100, Math.max(0, score)),
      reason: String(rec.reason ?? rec.why ?? rec.explanation ?? `Strong fit for this lane based on similarity and tags.`),
      matchSource,
      tags,
      firstKnownYear,
      isLikelyNewEra:
        typeof rec.isLikelyNewEra === "boolean"
          ? rec.isLikelyNewEra
          : Boolean(firstKnownYear && firstKnownYear >= 2019),
      evidence: evidence.length > 0 ? evidence : [matchSource],
    };
  });

  return {
    strategyNote: String(payload.strategyNote ?? payload.note ?? "Balanced recommendations using lane fit and novelty preference."),
    recommendations,
  };
}

async function fallbackSynthesis(params: {
  mode: AgentMode;
  messages: ChatCompletionMessageParam[];
  contextJson: string;
}) {
  const client = getOpenAIClient();
  const task =
    params.mode === "analyze"
      ? "Produce final valid analysis JSON now from gathered evidence."
      : "Produce final valid recommendation JSON now from gathered evidence.";

  const completion = await client.chat.completions.create({
    model: getOpenAIModel(),
    messages: [
      ...params.messages,
      {
        role: "system",
        content: `${AGENT_POLICY_PROMPT} ${task} Return JSON only.`,
      },
      { role: "user", content: params.contextJson },
    ],
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  return validateFinal(params.mode, parsed);
}

type RunAnalyzeParams = {
  mcpSessionId: string;
  rangeLabel: string;
  rangeStart: number;
  rangeEnd: number;
  heardArtistsSeed: string[];
  maxToolCalls?: number;
  timeoutMs?: number;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
};

type RunRecommendParams = {
  mcpSessionId: string;
  lane: {
    id: string;
    name: string;
    description: string;
    whyThisLane: string;
    artists: string[];
    tags: string[];
  };
  heardArtists: string[];
  newPreferred: boolean;
  limit: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
};

export async function runAnalyzeAgent(params: RunAnalyzeParams): Promise<AnalyzeAgentResult> {
  return runAgent({
    mode: "analyze",
    mcpSessionId: params.mcpSessionId,
    contextJson: JSON.stringify({
      task: ANALYZE_AGENT_TASK,
      timeframe: {
        label: params.rangeLabel,
        from: params.rangeStart,
        to: params.rangeEnd,
      },
      heardArtistsSeed: params.heardArtistsSeed,
      outputConstraints: {
        lanesMin: 3,
        lanesMax: 6,
      },
    }),
    maxToolCalls: params.maxToolCalls ?? 10,
    timeoutMs: params.timeoutMs ?? 240_000,
    onEvent: params.onEvent,
  }) as Promise<AnalyzeAgentResult>;
}

export async function runRecommendAgent(params: RunRecommendParams): Promise<RecommendAgentResult> {
  return runAgent({
    mode: "recommend",
    mcpSessionId: params.mcpSessionId,
    contextJson: JSON.stringify({
      task: RECOMMEND_AGENT_TASK,
      lane: params.lane,
      heardArtists: params.heardArtists,
      constraints: {
        newPreferred: params.newPreferred,
        limit: params.limit,
      },
    }),
    maxToolCalls: params.maxToolCalls ?? 10,
    timeoutMs: params.timeoutMs ?? 240_000,
    onEvent: params.onEvent,
  }) as Promise<RecommendAgentResult>;
}

async function runAgent(params: {
  mode: AgentMode;
  mcpSessionId: string;
  contextJson: string;
  maxToolCalls: number;
  timeoutMs: number;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
}): Promise<AnalyzeAgentResult | RecommendAgentResult> {
  const client = getOpenAIClient();
  const mappedTools = await getMappedMcpTools(params.mcpSessionId);
  const tools = buildOpenAiTools({
    mappedTools,
    finalTool: buildFinalTool(params.mode),
  });

  const traceSteps: AgentTraceStep[] = [];
  let toolCallsUsed = 0;
  const startedAt = Date.now();

  const emit = async (type: string, payload: Record<string, unknown>) => {
    if (!params.onEvent) return;
    await params.onEvent({ type, payload });
  };

  await emit("run_started", {
    mode: params.mode,
    maxToolCalls: params.maxToolCalls,
    timeoutMs: params.timeoutMs,
    message: `Run started (${params.mode}) with max ${params.maxToolCalls} tool calls and ${Math.round(params.timeoutMs / 1000)}s timeout.`,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_POLICY_PROMPT },
    { role: "user", content: params.contextJson },
  ];

  for (let iteration = 0; iteration < 20; iteration += 1) {
    if (Date.now() - startedAt > params.timeoutMs) {
      await emit("run_timeout", {
        mode: params.mode,
        elapsedMs: Date.now() - startedAt,
        toolCallsUsed,
        message: `Run timed out after ${Math.round((Date.now() - startedAt) / 1000)}s.`,
      });

      const fallback = await fallbackSynthesis({
        mode: params.mode,
        messages,
        contextJson: params.contextJson,
      });

      return {
        mode: params.mode,
        output: fallback as AnalyzeFinal & RecommendFinal,
        trace: {
          toolCallsUsed,
          maxToolCalls: params.maxToolCalls,
          terminationReason: "timeout",
          steps: traceSteps,
        },
      } as AnalyzeAgentResult | RecommendAgentResult;
    }

    await emit("model_turn_started", {
      mode: params.mode,
      iteration: iteration + 1,
      toolCallsUsed,
      message: `Model turn ${iteration + 1} started.`,
    });

    const completion = await client.chat.completions.create({
      model: getOpenAIModel(),
      tools,
      tool_choice: "auto",
      messages,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      break;
    }

    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    });

    const toolCalls = message.tool_calls ?? [];
    await emit("model_turn_completed", {
      mode: params.mode,
      iteration: iteration + 1,
      requestedToolCalls: toolCalls.length,
      message: `Model turn ${iteration + 1} planned ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}.`,
    });

    if (toolCalls.length === 0) {
      continue;
    }

    for (let idx = 0; idx < toolCalls.length; idx += 1) {
      const call = toolCalls[idx];

      if (call.type !== "function") {
        traceSteps.push({
          index: traceSteps.length + 1,
          toolName: "unsupported_tool_type",
          arguments: {},
          status: "error",
          durationMs: 0,
          preview: `Unsupported tool call type: ${call.type}`,
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: `Unsupported tool call type: ${call.type}`,
          }),
        });
        continue;
      }

      const args = parseToolArgs(call.function.arguments);
        await emit("tool_call_started", {
          mode: params.mode,
          toolName: call.function.name,
          arguments: args,
          toolCallIndexInTurn: idx + 1,
          plannedToolCallsInTurn: toolCalls.length,
          message: `Tool call ${idx + 1}/${toolCalls.length} started: ${call.function.name.replace(/^mcp_/, "")}.`,
        });

      const isFinal =
        call.function.name === FINAL_ANALYZE_TOOL_NAME ||
        call.function.name === FINAL_RECOMMEND_TOOL_NAME;

      if (isFinal) {
        let validated: AnalyzeFinal | RecommendFinal;
        try {
          validated = validateFinal(params.mode, args);
        } catch {
          const repaired = await fallbackSynthesis({
            mode: params.mode,
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  "Your previous final submission did not match the required schema. Produce a corrected final JSON payload now.",
              },
            ],
            contextJson: params.contextJson,
          });
          validated = repaired;
        }

        return {
          mode: params.mode,
          output: validated as AnalyzeFinal & RecommendFinal,
          trace: {
            toolCallsUsed,
            maxToolCalls: params.maxToolCalls,
            terminationReason: "final",
            steps: traceSteps,
          },
        } as AnalyzeAgentResult | RecommendAgentResult;
      }

      if (toolCallsUsed >= params.maxToolCalls) {
        traceSteps.push({
          index: traceSteps.length + 1,
          toolName: call.function.name,
          arguments: args,
          status: "budget_skipped",
          durationMs: 0,
          preview: "Skipped because tool-call budget was exhausted.",
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            skipped: true,
            reason: "tool_call_budget_exhausted",
          }),
        });

        await emit("tool_call_skipped", {
          mode: params.mode,
          toolName: call.function.name,
          reason: "budget_exhausted",
          toolCallsUsed,
          maxToolCalls: params.maxToolCalls,
          message: `Skipped ${call.function.name.replace(/^mcp_/, "")}: global tool budget exhausted (${toolCallsUsed}/${params.maxToolCalls}).`,
        });
        continue;
      }

      const toolStart = Date.now();
      try {
        const mappedTool = mappedTools.find((tool) => tool.openAiName === call.function.name);
        if (!mappedTool) {
          throw new Error(`Unknown mapped MCP tool: ${call.function.name}`);
        }

        const result = await executeMappedTool({
          mcpSessionId: params.mcpSessionId,
          mappedTools,
          openAiName: call.function.name,
          argumentsObject: args,
        });

        toolCallsUsed += 1;
        traceSteps.push({
          index: traceSteps.length + 1,
          toolName: call.function.name,
          arguments: args,
          status: "success",
          durationMs: Date.now() - toolStart,
          preview: result.text.slice(0, 220),
        });

        const parsed = parseMcpToolResult({
          mcpToolName: mappedTool.mcpName,
          text: result.text,
          args,
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            mcpTool: mappedTool.mcpName,
            text: result.text.slice(0, 8000),
            parsed,
          }),
        });

        await emit("tool_call_completed", {
          mode: params.mode,
          toolName: call.function.name,
          status: "success",
          durationMs: Date.now() - toolStart,
          toolCallsUsed,
          maxToolCalls: params.maxToolCalls,
          toolCallIndexInTurn: idx + 1,
          plannedToolCallsInTurn: toolCalls.length,
          message: `Tool call ${idx + 1}/${toolCalls.length} completed: ${call.function.name.replace(/^mcp_/, "")} (${Date.now() - toolStart}ms).`,
        });
      } catch (error) {
        traceSteps.push({
          index: traceSteps.length + 1,
          toolName: call.function.name,
          arguments: args,
          status: "error",
          durationMs: Date.now() - toolStart,
          preview: error instanceof Error ? error.message.slice(0, 220) : "Unknown tool error",
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        });

        await emit("tool_call_completed", {
          mode: params.mode,
          toolName: call.function.name,
          status: "error",
          durationMs: Date.now() - toolStart,
          error: error instanceof Error ? error.message : "Unknown tool error",
          toolCallsUsed,
          maxToolCalls: params.maxToolCalls,
          toolCallIndexInTurn: idx + 1,
          plannedToolCallsInTurn: toolCalls.length,
          message: `Tool call ${idx + 1}/${toolCalls.length} failed: ${call.function.name.replace(/^mcp_/, "")}.`,
        });
      }
    }

    if (toolCallsUsed >= params.maxToolCalls) {
      await emit("run_budget_exhausted", {
        mode: params.mode,
        toolCallsUsed,
        maxToolCalls: params.maxToolCalls,
        message: `Run reached tool budget (${toolCallsUsed}/${params.maxToolCalls}).`,
      });

      const fallback = await fallbackSynthesis({
        mode: params.mode,
        messages,
        contextJson: params.contextJson,
      });

      return {
        mode: params.mode,
        output: fallback as AnalyzeFinal & RecommendFinal,
        trace: {
          toolCallsUsed,
          maxToolCalls: params.maxToolCalls,
          terminationReason: "budget_exhausted",
          steps: traceSteps,
        },
      } as AnalyzeAgentResult | RecommendAgentResult;
    }
  }

  const fallback = await fallbackSynthesis({
    mode: params.mode,
    messages,
    contextJson: params.contextJson,
  });

  return {
    mode: params.mode,
    output: fallback as AnalyzeFinal & RecommendFinal,
    trace: {
      toolCallsUsed,
      maxToolCalls: params.maxToolCalls,
      terminationReason: "error",
      steps: traceSteps,
    },
  } as AnalyzeAgentResult | RecommendAgentResult;
}

export function coerceLaneIds(lanes: AnalyzeFinal["lanes"]): AnalyzeFinal["lanes"] {
  return lanes.map((lane) => {
    const normalizedId = lane.id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 40);
    return {
      ...lane,
      id: normalizedId || lane.name.toLowerCase().replace(/\s+/g, "-"),
    };
  });
}

export function sanitizeRecommendations(
  recommendations: RecommendFinal["recommendations"],
  heardArtists: string[],
  limit: number,
  newPreferred: boolean,
): RecommendFinal["recommendations"] {
  const heardSet = new Set(heardArtists.map((artist) => artist.trim().toLowerCase()));

  const filtered = recommendations.filter((item) => !heardSet.has(item.artist.trim().toLowerCase()));
  if (!newPreferred) {
    return filtered.slice(0, limit);
  }

  const newer = filtered.filter((item) => item.isLikelyNewEra || ((item.firstKnownYear ?? 0) >= 2019));
  const older = filtered.filter((item) => !newer.includes(item));

  const minTargetNewer = Math.ceil(limit * 0.6);
  const newerCount = Math.min(newer.length, minTargetNewer);

  const selected = [...newer.slice(0, newerCount), ...older.slice(0, Math.max(0, limit - newerCount))];

  if (selected.length < limit) {
    const used = new Set(selected.map((item) => item.artist.toLowerCase()));
    for (const item of filtered) {
      if (selected.length >= limit) break;
      if (used.has(item.artist.toLowerCase())) continue;
      selected.push(item);
    }
  }

  return selected.slice(0, limit);
}

export const RECOMMENDATION_LIMIT_BOUNDS = z.number().int().min(1).max(20);
