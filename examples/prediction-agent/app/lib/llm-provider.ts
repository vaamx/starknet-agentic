import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

export type LlmTask = "forecast" | "debate" | "resolution" | "triage";
export type LlmProvider = "anthropic" | "xai" | "local";

interface CompleteTextParams {
  task: LlmTask;
  userMessage: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  enableXaiResearchTools?: boolean;
}

export function getLlmProviderForTask(task: LlmTask): LlmProvider {
  if (task === "forecast") return config.llmForecastProvider as LlmProvider;
  if (task === "debate") return config.llmDebateProvider as LlmProvider;
  if (task === "resolution") return config.llmResolutionProvider as LlmProvider;
  return config.llmTriageProvider as LlmProvider;
}

function defaultModelForTask(provider: LlmProvider, task: LlmTask): string {
  if (provider === "xai") {
    const fromTask =
      task === "forecast"
        ? config.llmForecastModel
        : task === "debate"
          ? config.llmDebateModel
          : task === "resolution"
            ? config.llmResolutionModel
            : config.llmTriageModel;
    return fromTask || config.llmModel || "grok-4-latest";
  }

  if (provider === "anthropic") {
    const fromTask =
      task === "forecast"
        ? config.llmForecastModel
        : task === "debate"
          ? config.llmDebateModel
          : task === "resolution"
            ? config.llmResolutionModel
            : config.llmTriageModel;
    return fromTask || config.llmModel || "claude-sonnet-4-6";
  }

  const fromTask =
    task === "forecast"
      ? config.ollamaForecastModel
      : task === "debate"
        ? config.ollamaDebateModel
        : task === "resolution"
          ? config.ollamaResolutionModel
          : config.ollamaTriageModel;
  return fromTask || config.ollamaModel || "qwen2.5:7b-instruct";
}

function modelMatchesProvider(model: string, provider: LlmProvider): boolean {
  const normalized = model.toLowerCase();
  if (provider === "xai") return normalized.startsWith("grok");
  if (provider === "anthropic") return normalized.includes("claude");
  return !normalized.includes("claude") && !normalized.startsWith("grok");
}

export function resolveLlmModel(task: LlmTask, modelOverride?: string): string {
  const provider = getLlmProviderForTask(task);
  if (modelOverride && modelMatchesProvider(modelOverride, provider)) {
    return modelOverride;
  }
  return defaultModelForTask(provider, task);
}

export function getLlmProviderLabel(task: LlmTask = "forecast"): string {
  const provider = getLlmProviderForTask(task);
  if (provider === "xai") return "xAI (Grok)";
  if (provider === "local") return "Local (Ollama)";
  return "Anthropic";
}

export function getLlmConfigurationError(task: LlmTask = "forecast"): string {
  const provider = getLlmProviderForTask(task);
  if (provider === "xai") {
    return `xAI provider selected for ${task} but XAI_API_KEY is not configured`;
  }
  if (provider === "local") {
    return (
      `Local provider selected for ${task} but Ollama is not configured. ` +
      "Set OLLAMA_BASE_URL and OLLAMA_MODEL."
    );
  }
  return `Anthropic provider selected for ${task} but ANTHROPIC_API_KEY is not configured`;
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

function extractOllamaText(payload: any): string {
  const fromChat = payload?.message?.content;
  if (typeof fromChat === "string") return fromChat.trim();
  const fromGenerate = payload?.response;
  if (typeof fromGenerate === "string") return fromGenerate.trim();
  const fromOutput = payload?.output?.text;
  if (typeof fromOutput === "string") return fromOutput.trim();
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
    throw new Error(getLlmConfigurationError(params.task));
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

async function completeWithLocal(params: CompleteTextParams): Promise<string> {
  const model = resolveLlmModel(params.task, params.model);
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  messages.push({ role: "user", content: params.userMessage });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.ollamaApiKey) {
    headers.Authorization = `Bearer ${config.ollamaApiKey}`;
  }

  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.2,
        num_predict: params.maxTokens ?? 1024,
      },
    }),
    cache: "no-store",
  });

  const payload = await response
    .json()
    .catch(() => ({ error: `Ollama HTTP ${response.status}` }));
  if (!response.ok) {
    const message =
      payload?.error || payload?.message || `Ollama request failed: HTTP ${response.status}`;
    throw new Error(String(message));
  }

  const text = extractOllamaText(payload);
  if (!text) {
    throw new Error("Ollama response missing content");
  }
  return text;
}

async function completeWithAnthropic(params: CompleteTextParams): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(getLlmConfigurationError(params.task));
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
  const provider = getLlmProviderForTask(params.task);
  if (provider === "xai") {
    if (!process.env.XAI_API_KEY) {
      throw new Error(getLlmConfigurationError(params.task));
    }
    return completeWithXai(params);
  }
  if (provider === "local") {
    if (!config.ollamaBaseUrl || !config.ollamaModel) {
      throw new Error(getLlmConfigurationError(params.task));
    }
    return completeWithLocal(params);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(getLlmConfigurationError(params.task));
  }
  return completeWithAnthropic(params);
}
