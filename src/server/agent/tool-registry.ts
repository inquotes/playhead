import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { callLastfmTool, listLastfmTools } from "@/server/lastfm/mcp";

export const FINAL_ANALYZE_TOOL_NAME = "submit_final_analysis";
export const FINAL_RECOMMEND_TOOL_NAME = "submit_final_recommendations";

function sanitizeToolName(name: string): string {
  return `mcp_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export type MappedTool = {
  openAiName: string;
  mcpName: string;
  description: string;
  parameters: Record<string, unknown>;
};

export async function getMappedMcpTools(mcpSessionId: string): Promise<MappedTool[]> {
  const tools = await listLastfmTools(mcpSessionId);

  return tools.map((tool) => ({
    openAiName: sanitizeToolName(tool.name),
    mcpName: tool.name,
    description: tool.description ?? `Last.fm MCP tool: ${tool.name}`,
    parameters:
      (tool.inputSchema as Record<string, unknown> | undefined) ?? {
        type: "object",
        properties: {},
      },
  }));
}

export function buildOpenAiTools(params: {
  mappedTools: MappedTool[];
  finalTool: ChatCompletionTool;
}): ChatCompletionTool[] {
  const mcpTools: ChatCompletionTool[] = params.mappedTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.openAiName,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  return [...mcpTools, params.finalTool];
}

export async function executeMappedTool(params: {
  mcpSessionId: string;
  mappedTools: MappedTool[];
  openAiName: string;
  argumentsObject: Record<string, unknown>;
}) {
  const match = params.mappedTools.find((tool) => tool.openAiName === params.openAiName);
  if (!match) {
    throw new Error(`Unknown mapped MCP tool: ${params.openAiName}`);
  }

  return callLastfmTool(params.mcpSessionId, match.mcpName, params.argumentsObject);
}
