const LASTFM_MCP_BASE_URL =
  process.env.LASTFM_MCP_BASE_URL ?? "https://lastfm-mcp.com/mcp";

type ToolCallResult = {
  text: string;
  raw: unknown;
};

export type LastfmMcpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type SseEnvelope = {
  result?: {
    tools?: LastfmMcpTool[];
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: {
    message?: string;
  };
};

function buildMcpUrl(mcpSessionId: string): string {
  const url = new URL(LASTFM_MCP_BASE_URL);
  url.searchParams.set("session_id", mcpSessionId);
  return url.toString();
}

function extractJsonFromSse(responseText: string): SseEnvelope {
  const dataLines = responseText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""));

  const joined = dataLines[dataLines.length - 1];
  if (!joined) {
    throw new Error("Could not parse MCP SSE response.");
  }

  return JSON.parse(joined) as SseEnvelope;
}

function extractToolText(payload: SseEnvelope): string {
  const chunks = payload.result?.content ?? [];
  return chunks
    .map((item) => (item.type === "text" ? item.text ?? "" : ""))
    .join("\n")
    .trim();
}

async function callMcpMethod(
  mcpSessionId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<SseEnvelope> {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };

  const response = await fetch(buildMcpUrl(mcpSessionId), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`MCP call failed (${response.status}): ${responseText}`);
  }

  if (responseText.trim().startsWith("{")) {
    const json = JSON.parse(responseText) as Record<string, unknown>;
    if ("error" in json) {
      throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
    }
  }

  const payload = extractJsonFromSse(responseText);
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  return payload;
}

export async function callLastfmTool(
  mcpSessionId: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const payload = await callMcpMethod(mcpSessionId, "tools/call", {
    name: toolName,
    arguments: args,
  });

  return {
    text: extractToolText(payload),
    raw: payload,
  };
}

export async function listLastfmTools(mcpSessionId: string): Promise<LastfmMcpTool[]> {
  const payload = await callMcpMethod(mcpSessionId, "tools/list", {});
  return payload.result?.tools ?? [];
}

export function buildLastfmLoginUrl(mcpSessionId: string): string {
  const loginBase = process.env.LASTFM_MCP_LOGIN_URL ?? "https://lastfm-mcp.com/login";
  const url = new URL(loginBase);
  url.searchParams.set("session_id", mcpSessionId);
  return url.toString();
}

export function createMcpSessionId(): string {
  const random = crypto.randomUUID().replace(/-/g, "");
  return `music-discovery-${Date.now()}-${random.slice(0, 16)}`;
}
