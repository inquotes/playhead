import OpenAI from "openai";

type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const globalForOpenAI = globalThis as unknown as {
  openaiClientGlobal: OpenAI | undefined;
};

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (globalForOpenAI.openaiClientGlobal) {
    return globalForOpenAI.openaiClientGlobal;
  }

  const client = new OpenAI({ apiKey });
  if (process.env.NODE_ENV !== "production") {
    globalForOpenAI.openaiClientGlobal = client;
  }

  return client;
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export function getOpenAIReasoningEffort(): OpenAIReasoningEffort {
  const value = (process.env.OPENAI_REASONING_EFFORT ?? "low").trim().toLowerCase();
  if (value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "low";
}
