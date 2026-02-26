import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

export type LlmTask = "forecast" | "debate" | "resolution";
export type LlmProvider = "anthropic" | "xai";

interface CompleteTextParams {
  task: LlmTask;
  userMessage: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  enableXaiResearchTools?: boolean;
}

function defaultModelForTask(provider: LlmProvider, task: LlmTask): string {
  if (provider === "xai") {
    const fromTask =
      task === "forecast"
        ? config.llmForecastModel
        : task === "debate"
          ? config.llmDebateModel
          : config.llmResolutionModel;
    return fromTask || config.llmModel || "grok-4-latest";
  }

  const fromTask =
    task === "forecast"
      ? config.llmForecastModel
      : task === "debate"
        ? config.llmDebateModel
        : config.llmResolutionModel;
  return fromTask || config.llmModel || "claude-sonnet-4-6";
}

function modelMatchesProvider(model: string, provider: LlmProvider): boolean {
  const normalized = model.toLowerCase();
  if (provider === "xai") return normalized.startsWith("grok");
  return normalized.includes("claude");
}

export function resolveLlmModel(task: LlmTask, modelOverride?: string): string {
  const provider = config.llmProvider as LlmProvider;
  if (modelOverride && modelMatchesProvider(modelOverride, provider)) {
    return modelOverride;
  }
  return defaultModelForTask(provider, task);
}

export function getLlmProviderLabel(): string {
  return (config.llmProvider as LlmProvider) === "xai"
    ? "xAI (Grok)"
    : "Anthropic";
}

export function getLlmConfigurationError(): string {
  const provider = config.llmProvider as LlmProvider;
  if (provider === "xai") {
    return "xAI provider selected but XAI_API_KEY is not configured";
  }
  return "Anthropic provider selected but ANTHROPIC_API_KEY is not configured";
}

function extractAnthropicText(response: Anthropic.Message): string {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

function extractXaiText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function buildXaiNativeTools(): Array<Record<string, unknown>> {
  if (!config.xaiNativeToolsEnabled) return [];

  const tools: Array<Record<string, unknown>> = [];
  if (config.xaiWebSearchEnabled) tools.push({ type: "web_search" });
  if (config.xaiXSearchEnabled) tools.push({ type: "x_search" });
  if (config.xaiCodeExecutionEnabled) {
    tools.push({ type: config.xaiCodeToolType });
  }
  if (config.xaiCollectionsSearchEnabled) {
    const collectionsTool: Record<string, unknown> = { type: "collections_search" };
    if (config.xaiCollectionIds.length > 0) {
      collectionsTool.collection_ids = config.xaiCollectionIds;
    }
    tools.push(collectionsTool);
  }
  return tools;
}

async function completeWithXai(params: CompleteTextParams): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(getLlmConfigurationError());
  }

  const model = resolveLlmModel(params.task, params.model);
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  messages.push({ role: "user", content: params.userMessage });

  const tools =
    params.enableXaiResearchTools !== false ? buildXaiNativeTools() : [];

  const baseBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 1024,
  };
  if (tools.length > 0) {
    baseBody.tools = tools;
  }

  async function request(body: Record<string, unknown>) {
    const response = await fetch(`${config.xaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response
      .json()
      .catch(() => ({ error: { message: `xAI HTTP ${response.status}` } }));
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        `xAI request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  try {
    const payload = await request(baseBody);
    const text = extractXaiText(payload);
    if (text) return text;
  } catch (err) {
    if (!("tools" in baseBody)) {
      throw err;
    }
  }

  // Retry without native tools when tool schema differs across xAI releases.
  const fallbackBody = { ...baseBody };
  delete (fallbackBody as any).tools;
  const fallbackPayload = await request(fallbackBody);
  const fallbackText = extractXaiText(fallbackPayload);
  if (!fallbackText) {
    throw new Error("xAI response missing content");
  }
  return fallbackText;
}

async function completeWithAnthropic(params: CompleteTextParams): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(getLlmConfigurationError());
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: resolveLlmModel(params.task, params.model),
    max_tokens: params.maxTokens ?? 1024,
    temperature: params.temperature ?? 0.2,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userMessage }],
  });

  const text = extractAnthropicText(response);
  if (!text) throw new Error("Anthropic response missing content");
  return text;
}

export async function completeText(params: CompleteTextParams): Promise<string> {
  if (!config.llmConfigured) {
    throw new Error(getLlmConfigurationError());
  }

  if ((config.llmProvider as LlmProvider) === "xai") {
    return completeWithXai(params);
  }
  return completeWithAnthropic(params);
}
