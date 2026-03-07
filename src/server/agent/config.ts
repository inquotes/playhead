const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_MAX_TOOL_CALLS = 10;

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getAgentMaxToolCalls(mode: "analyze" | "recommend"): number {
  const globalCap = readInt(process.env.AGENT_MAX_TOOL_CALLS, DEFAULT_MAX_TOOL_CALLS);

  if (mode === "analyze") {
    return readInt(process.env.AGENT_ANALYZE_MAX_TOOL_CALLS, globalCap);
  }

  return readInt(process.env.AGENT_RECOMMEND_MAX_TOOL_CALLS, globalCap);
}

export function getAgentTimeoutMs(mode: "analyze" | "recommend"): number {
  const globalTimeout = readInt(process.env.AGENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (mode === "analyze") {
    return readInt(process.env.AGENT_ANALYZE_TIMEOUT_MS, globalTimeout);
  }

  return readInt(process.env.AGENT_RECOMMEND_TIMEOUT_MS, globalTimeout);
}
