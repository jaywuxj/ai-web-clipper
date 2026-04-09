// ============================================================
// AI Provider — 统一接口 + 多 Provider Fallback
// ============================================================

import OpenAI from "openai";
import { DEFAULT_SYSTEM_PROMPT } from "./prompts";
import { getActiveTemplate } from "../storage/prompts";
import type { AIProvider, ChatMessage, ProviderConfig, SummaryResult, UserSettings } from "../types";
import { kimiWebSummarize, kimiWebChat, kimiWebChatStream } from "./kimi-web";
import { isZeroTokenProvider, getZeroTokenProvider, ZERO_TOKEN_PROVIDERS } from "./zero-token";

const MAX_INPUT_CHARS = 280_000;

// -------------------- 内置 Provider 预设配置 --------------------

/** 内置的 Provider 默认配置（不可删除的预设） */
export const BUILTIN_PROVIDER_DEFAULTS: Record<string, ProviderConfig> = {
  minimax: {
    apiKey: "",
    apiBaseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-M2.5",
    displayName: "MiniMax",
    isCustom: false,
  },
  kimi: {
    apiKey: "",
    apiBaseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    displayName: "Kimi (Moonshot)",
    isCustom: false,
  },
};

/** 内置 Provider ID 列表 */
export const BUILTIN_PROVIDER_IDS = Object.keys(BUILTIN_PROVIDER_DEFAULTS);

/** 可快速添加的预设模型模板（用户点击后一键添加） */
export const PRESET_TEMPLATES: Array<{
  id: string;
  displayName: string;
  desc: string;
  apiBaseUrl: string;
  model: string;
  keyUrl: string;
}> = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    desc: "DeepSeek V3/R1 · 高性价比推理模型",
    apiBaseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    desc: "GPT-4o / GPT-4.1 · 全球领先大模型",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "claude",
    displayName: "Claude",
    desc: "Claude 4 Sonnet · Anthropic 旗舰模型",
    apiBaseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "glm",
    displayName: "智谱 GLM",
    desc: "GLM-4-Plus · 智谱 AI 旗舰模型",
    apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-plus",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "qwen",
    displayName: "通义千问",
    desc: "Qwen-Plus · 阿里云大模型",
    apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
  {
    id: "doubao",
    displayName: "豆包",
    desc: "Doubao · 字节跳动大模型",
    apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-1.5-pro-256k",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  },
];

// -------------------- 模型参数配置 --------------------

/**
 * 各模型/Provider 的推荐参数配置
 * - temperature: 推荐温度，默认 0.6
 * - maxTokens: 不设置则让 API 使用模型默认最大值（即不传 max_tokens）
 *              设置数值则显式传入（部分 API 不传会用较小默认值）
 */
interface ModelParamConfig {
  temperature: number;
  /** undefined = 不传 max_tokens，让 API 自动使用最大值 */
  maxTokens?: number;
}

/**
 * 根据 provider ID 或 model 名称匹配参数配置
 * - OpenAI: 不传 max_tokens 默认无上限（受模型本身限制），temperature 0.6
 * - Claude: 必须传 max_tokens，最大 8192（Sonnet 输出上限）
 * - DeepSeek: 不传 max_tokens 默认 4096 太小，显式设 8192
 * - Kimi: 不传 max_tokens 默认最大，temperature 0.6
 * - 智谱 GLM: 不传 max_tokens 默认最大，temperature 0.6
 * - 通义千问: 不传 max_tokens 默认最大，temperature 0.6
 * - 豆包: 不传 max_tokens 默认 4096 太小，显式设 4096 以上
 * - MiniMax: 不传 max_tokens 默认最大，temperature 0.6
 */
function getModelParams(provider: string, model: string): ModelParamConfig {
  const lowerModel = model.toLowerCase();
  const lowerProvider = provider.toLowerCase();

  // Claude — 必须显式传 max_tokens
  if (lowerProvider === "claude" || lowerModel.includes("claude")) {
    return { temperature: 0.6, maxTokens: 8192 };
  }

  // DeepSeek — 不传默认 4096，显式设大
  if (lowerProvider === "deepseek" || lowerModel.includes("deepseek")) {
    return { temperature: 0.6, maxTokens: 8192 };
  }

  // 豆包 Doubao — 不传默认较小，显式设大
  if (lowerProvider === "doubao" || lowerModel.includes("doubao")) {
    return { temperature: 0.6, maxTokens: 16384 };
  }

  // Kimi — 不传即用模型最大值
  if (lowerProvider === "kimi" || lowerModel.includes("kimi") || lowerModel.includes("moonshot")) {
    return { temperature: 0.6 };
  }

  // OpenAI — 不传即用模型最大值
  if (lowerProvider === "openai" || lowerModel.includes("gpt")) {
    return { temperature: 0.6 };
  }

  // 智谱 GLM — 不传即用模型最大值
  if (lowerProvider === "glm" || lowerModel.includes("glm")) {
    return { temperature: 0.6 };
  }

  // 通义千问 — 不传即用模型最大值
  if (lowerProvider === "qwen" || lowerModel.includes("qwen")) {
    return { temperature: 0.6 };
  }

  // MiniMax — 不传即用模型最大值
  if (lowerProvider === "minimax" || lowerModel.includes("minimax")) {
    return { temperature: 0.6 };
  }

  // 未知模型：默认 temperature 0.6，不传 max_tokens
  return { temperature: 0.6 };
}

// -------------------- 获取用户设置 --------------------

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get({
    aiProvider: "minimax",
    apiKey: "",
    apiBaseUrl: "",
    model: "",
    saveAs: false,
    savePath: "",
    activePromptId: "default",
    providerConfigs: null,
    providerPriority: null,
    knowledgeSettings: null,
  });

  // 兼容旧版：如果没有 providerConfigs，从旧字段迁移
  let providerConfigs = result.providerConfigs as Record<string, ProviderConfig> | null;
  if (!providerConfigs) {
    const oldProvider = (result.aiProvider as string) || "minimax";
    providerConfigs = {
      minimax: { ...BUILTIN_PROVIDER_DEFAULTS.minimax },
      kimi: { ...BUILTIN_PROVIDER_DEFAULTS.kimi },
    };
    // 将旧的 apiKey 放入对应 provider
    if (result.apiKey && BUILTIN_PROVIDER_DEFAULTS[oldProvider]) {
      providerConfigs[oldProvider] = {
        ...BUILTIN_PROVIDER_DEFAULTS[oldProvider],
        apiKey: result.apiKey as string,
        apiBaseUrl: (result.apiBaseUrl as string) || BUILTIN_PROVIDER_DEFAULTS[oldProvider].apiBaseUrl,
        model: (result.model as string) || BUILTIN_PROVIDER_DEFAULTS[oldProvider].model,
      };
    }
  }

  const providerPriority = (result.providerPriority as string[] | null) || ["minimax", "kimi"];
  const primaryProvider = providerPriority[0] || "minimax";
  const primaryConfig = providerConfigs[primaryProvider] || BUILTIN_PROVIDER_DEFAULTS[primaryProvider] || { apiKey: "", apiBaseUrl: "", model: "" };

  return {
    aiProvider: primaryProvider,
    apiKey: primaryConfig.apiKey,
    apiBaseUrl: primaryConfig.apiBaseUrl,
    model: primaryConfig.model,
    saveAs: result.saveAs as boolean,
    savePath: (result.savePath as string) || "",
    activePromptId: (result.activePromptId as string) || "default",
    providerConfigs,
    providerPriority,
    knowledgeSettings: (result.knowledgeSettings as UserSettings["knowledgeSettings"]) || { enabled: true, maxDepth: 2, updateMode: "auto" },
  };
}

export async function saveSettings(
  settings: Partial<UserSettings>
): Promise<void> {
  await chrome.storage.sync.set(settings);
}

// -------------------- 核心：调用 AI 总结（带 Fallback） --------------------

/**
 * 调用 AI 对页面内容进行结构化总结
 * 按优先级尝试各 provider，优先 provider 失败自动切换到下一个
 */
export async function summarize(
  textContent: string,
  promptId?: string,
  customPrompt?: string
): Promise<SummaryResult> {
  const settings = await getSettings();

  // 获取 Prompt 模板
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  if (promptId) {
    const { getTemplateById } = await import("../storage/prompts");
    const template = await getTemplateById(promptId);
    if (template) {
      systemPrompt = template.prompt;
    }
  } else {
    const activeTemplate = await getActiveTemplate();
    systemPrompt = activeTemplate.prompt;
  }

  // 如果有用户自定义指令，将其作为核心指令放入 system prompt
  if (customPrompt) {
    systemPrompt = `## 用户指令（最高优先级）\n${customPrompt}\n\n---\n\n${systemPrompt}`;
  }

  // 截断过长的输入
  const truncated =
    textContent.length > MAX_INPUT_CHARS
      ? textContent.slice(0, MAX_INPUT_CHARS) + "\n\n[内容已截断]"
      : textContent;

  // 按优先级顺序收集可用的 provider（有 apiKey、使用 cookie 模式、或使用 zeroToken 模式的）
  const availableProviders = settings.providerPriority.filter(
    (p) => {
      const cfg = settings.providerConfigs[p];
      if (!cfg) return false;
      return cfg.apiKey || cfg.authMode === "cookie" || cfg.authMode === "zeroToken";
    }
  );

  if (availableProviders.length === 0) {
    throw new Error(
      "请先在插件设置中至少为一个 AI 服务填写 API Key，或启用免费模式。"
    );
  }

  let lastError: Error | null = null;

  for (const provider of availableProviders) {
    const config = settings.providerConfigs[provider];
    try {
      const displayName = config.displayName || provider;
      console.log(`[AI Web Clipper] 尝试使用 ${displayName} 进行总结...`);

      let result: SummaryResult;

      // Zero Token 模式：使用 OpenClaw Zero Token 框架
      if (config.authMode === "zeroToken" && config.zeroTokenProviderId) {
        const ztProvider = getZeroTokenProvider(config.zeroTokenProviderId);
        if (!ztProvider) {
          throw new Error(`Zero Token 提供商 "${config.zeroTokenProviderId}" 不存在`);
        }
        result = await ztProvider.summarize(systemPrompt, truncated);
      }
      // Cookie 模式：使用 Kimi Web API（向后兼容）
      else if (config.authMode === "cookie" && provider === "kimi") {
        result = await kimiWebSummarize(systemPrompt, truncated);
      }
      // API Key 模式：使用 OpenAI 兼容接口
      else {
        result = await callProvider(provider, config, systemPrompt, truncated);
      }

      console.log(`[AI Web Clipper] ${displayName} 总结成功`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[AI Web Clipper] ${config.displayName || provider} 调用失败: ${lastError.message}，尝试下一个...`
      );
    }
  }

  throw new Error(
    `所有 AI 服务均调用失败。最后一个错误: ${lastError?.message || "未知错误"}`
  );
}

/** 调用单个 provider（统一使用 OpenAI 兼容接口） */
async function callProvider(
  provider: AIProvider,
  config: ProviderConfig,
  systemPrompt: string,
  truncatedContent: string
): Promise<SummaryResult> {
  const displayName = config.displayName || provider;

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.apiBaseUrl,
    dangerouslyAllowBrowser: true,
    timeout: 180_000, // 3 分钟超时，长文论文需要更多处理时间
  });

  // 根据模型自动获取推荐的 temperature 和 max_tokens
  const modelParams = getModelParams(provider, config.model);

  const requestParams: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `\n\n${truncatedContent}`,
      },
    ],
    temperature: modelParams.temperature,
  };

  // 仅在需要显式指定时传 max_tokens，否则让 API 使用模型默认最大值
  if (modelParams.maxTokens !== undefined) {
    requestParams.max_tokens = modelParams.maxTokens;
  }

  // Kimi 的特殊参数处理（保留向后兼容）
  if (provider === "kimi") {
    requestParams.thinking = { type: "disabled" };
  }

  let response;
  try {
    response = await client.chat.completions.create(requestParams as any);
  } catch (apiErr: any) {
    const status = apiErr?.status || apiErr?.response?.status;
    const msg = apiErr?.message || String(apiErr);
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      throw new Error(`${displayName} API 请求超时，内容可能过长，请缩短内容后重试`);
    }
    if (status === 401) {
      throw new Error(`${displayName} API Key 无效或已过期，请检查设置`);
    }
    if (status === 429) {
      throw new Error(`${displayName} API 调用频率超限，请稍后重试`);
    }
    throw new Error(`${displayName} API 调用失败 (${status || "未知"}): ${msg}`);
  }

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error(`${displayName} AI 未返回有效内容（choices 为空）`);
  }

  return parseSummaryJSON(raw);
}

// -------------------- JSON 解析 --------------------

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseSummaryJSON(raw: string): SummaryResult {
  let cleaned = stripThink(raw);
  // 保存去除 think 标签后的原始文本，用于 md 文件直接输出
  const rawContent = cleaned;

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    // JSON 解析成功时，用 detailedSummary 作为 rawContent（它是结构化总结的正文）
    const summary = stripThink(String(parsed.detailedSummary || ""));
    const oneLiner = stripThink(String(parsed.oneLiner || ""));
    return {
      oneLiner,
      keyPoints: Array.isArray(parsed.keyPoints)
        ? parsed.keyPoints.map((p: unknown) => stripThink(String(p)))
        : [],
      detailedSummary: summary,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      rawContent: oneLiner + "\n\n" + summary,
    };
  } catch {
    return fallbackParse(cleaned, rawContent);
  }
}

function fallbackParse(text: string, rawContent: string): SummaryResult {
  const lines = text.split("\n").filter((l) => l.trim());
  return {
    oneLiner: lines[0] || "总结生成失败，请重试",
    keyPoints: lines.slice(1, 4).map((l) => l.replace(/^[-*•]\s*/, "")),
    detailedSummary: lines.slice(4).join("\n") || text,
    tags: [],
    rawContent,
  };
}

// -------------------- 多轮对话接口 --------------------

/** 获取当前用户选择的模板 system prompt */
async function getActiveSystemPrompt(): Promise<string> {
  const activeTemplate = await getActiveTemplate();
  return activeTemplate.prompt || DEFAULT_SYSTEM_PROMPT;
}

/**
 * 构建对话 messages 数组的公共逻辑
 *
 * 侧边栏纯对话场景，不含模板指令（模板指令仅用于前端快速生成用户问题）
 * 最终送入大模型的结构（只有一条 user 消息）：
 *   user: 基于下面材料回答用户问题：\n用户问题：{最新问题}\n材料：{页面内容}\n历史对话：\n用户问题1...\n回答1...\n...
 */
async function buildChatMessages(
  messages: ChatMessage[],
  pageContent: string
): Promise<Array<{ role: string; content: string }>> {
  const truncated =
    pageContent.length > MAX_INPUT_CHARS
      ? pageContent.slice(0, MAX_INPUT_CHARS) + "\n\n[内容已截断]"
      : pageContent;

  // --- 构建结构化 user prompt ---

  // 提取最新的用户问题（messages 数组中最后一条 user 消息）
  let latestUserQuestion = "";
  const historyMessages: ChatMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && !latestUserQuestion) {
      latestUserQuestion = messages[i].content;
    } else if (latestUserQuestion) {
      // 最新问题之前的所有消息都算历史对话
      historyMessages.unshift(messages[i]);
    }
  }

  // 如果没有找到 user 消息（不应发生），回退到旧逻辑
  if (!latestUserQuestion && messages.length > 0) {
    latestUserQuestion = messages[messages.length - 1].content;
  }

  // 组装最终的 user prompt：用户问题 + 材料 + 历史对话（无模板指令）
  const parts: string[] = [];

  parts.push("基于下面材料回答用户问题：");
  parts.push(`用户问题：${latestUserQuestion}`);

  if (truncated) {
    parts.push(`材料：${truncated}`);
  }

  // 有历史对话时追加
  if (historyMessages.length > 0) {
    parts.push("历史对话：");
    let roundIndex = 1;
    for (let i = 0; i < historyMessages.length; i++) {
      const msg = historyMessages[i];
      if (msg.role === "user") {
        parts.push(`用户问题${roundIndex}：${msg.content}`);
      } else if (msg.role === "assistant") {
        parts.push(`回答${roundIndex}：${msg.content}`);
        roundIndex++;
      }
    }
  }

  const structuredUserPrompt = parts.join("\n");

  // 只返回一条 user 消息，不含 system
  return [
    { role: "user", content: structuredUserPrompt },
  ];
}

/**
 * 构建结构化的富文本内容（供 Zero Token / Cookie 模式使用）
 * 这些模式不支持标准的 messages 数组，需要将全部信息拼成一段文本
 * 不含模板指令，与 buildChatMessages 保持一致
 */
function buildEnrichedContent(
  messages: ChatMessage[],
  pageContent: string
): string {
  // 提取最新的用户问题和历史对话
  let latestUserQuestion = "";
  const historyMessages: ChatMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && !latestUserQuestion) {
      latestUserQuestion = messages[i].content;
    } else if (latestUserQuestion) {
      historyMessages.unshift(messages[i]);
    }
  }

  if (!latestUserQuestion && messages.length > 0) {
    latestUserQuestion = messages[messages.length - 1].content;
  }

  const parts: string[] = [];

  parts.push("基于下面材料回答用户问题：");
  parts.push(`用户问题：${latestUserQuestion}`);

  if (pageContent) {
    const truncated =
      pageContent.length > MAX_INPUT_CHARS
        ? pageContent.slice(0, MAX_INPUT_CHARS) + "\n\n[内容已截断]"
        : pageContent;
    parts.push(`材料：${truncated}`);
  }

  if (historyMessages.length > 0) {
    parts.push("历史对话：");
    let roundIndex = 1;
    for (const msg of historyMessages) {
      if (msg.role === "user") {
        parts.push(`用户问题${roundIndex}：${msg.content}`);
      } else if (msg.role === "assistant") {
        parts.push(`回答${roundIndex}：${msg.content}`);
        roundIndex++;
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * 多轮对话：接收完整的对话历史 + 网页上下文，返回 AI 回复文本
 * system prompt 为简洁的对话引导，不强制 JSON 格式
 */
export async function chatWithContext(
  messages: ChatMessage[],
  pageContent: string,
  _promptId?: string
): Promise<string> {
  const settings = await getSettings();
  const fullMessages = await buildChatMessages(messages, pageContent);

  // 构建结构化 prompt，供 Zero Token / Cookie 模式使用
  const enrichedPageContent = buildEnrichedContent(messages, pageContent);

  const availableProviders = settings.providerPriority.filter(
    (p) => {
      const cfg = settings.providerConfigs[p];
      if (!cfg) return false;
      return cfg.apiKey || cfg.authMode === "cookie" || cfg.authMode === "zeroToken";
    }
  );

  if (availableProviders.length === 0) {
    throw new Error("请先在插件设置中至少为一个 AI 服务填写 API Key，或启用免费模式。");
  }

  let lastError: Error | null = null;

  for (const provider of availableProviders) {
    const config = settings.providerConfigs[provider];
    try {
      const displayName = config.displayName || provider;
      console.log(`[AI Web Clipper] Chat: 尝试使用 ${displayName}...`);

      // Zero Token 模式：传入结构化 prompt
      if (config.authMode === "zeroToken" && config.zeroTokenProviderId) {
        const ztProvider = getZeroTokenProvider(config.zeroTokenProviderId);
        if (!ztProvider) {
          throw new Error(`Zero Token 提供商 "${config.zeroTokenProviderId}" 不存在`);
        }
        const result = await ztProvider.chat(messages, enrichedPageContent);
        console.log(`[AI Web Clipper] Chat: ${displayName} 回复成功`);
        return result;
      }

      // Cookie 模式：使用 Kimi Web API（向后兼容）
      if (config.authMode === "cookie" && provider === "kimi") {
        const result = await kimiWebChat(messages, enrichedPageContent);
        console.log(`[AI Web Clipper] Chat: ${displayName} 回复成功`);
        return result;
      }

      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl,
        dangerouslyAllowBrowser: true,
        timeout: 180_000,
      });

      const modelParams = getModelParams(provider, config.model);

      const requestParams: Record<string, unknown> = {
        model: config.model,
        messages: fullMessages,
        temperature: modelParams.temperature,
      };

      if (modelParams.maxTokens !== undefined) {
        requestParams.max_tokens = modelParams.maxTokens;
      }

      if (provider === "kimi") {
        requestParams.thinking = { type: "disabled" };
      }

      const response = await client.chat.completions.create(requestParams as any);
      const raw = response.choices[0]?.message?.content?.trim();

      if (!raw) {
        throw new Error(`${displayName} AI 未返回有效内容`);
      }

      const cleaned = stripThink(raw);
      console.log(`[AI Web Clipper] Chat: ${displayName} 回复成功`);
      return cleaned;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Web Clipper] Chat: ${config.displayName || provider} 失败: ${lastError.message}`);
    }
  }

  throw new Error(
    `所有 AI 服务均调用失败。最后一个错误: ${lastError?.message || "未知错误"}`
  );
}

/**
 * 流式多轮对话：通过回调逐步返回文本 chunk
 * @param onChunk  每接收到一个文本片段时调用
 * @param onDone   流结束时调用（传入完整文本）
 * @param onError  出错时调用
 * @param signal   可选的 AbortSignal，用于中止流式请求
 */
export async function chatWithContextStream(
  messages: ChatMessage[],
  pageContent: string,
  onChunk: (chunk: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const settings = await getSettings();
  const fullMessages = await buildChatMessages(messages, pageContent);

  // 构建结构化 prompt，供 Zero Token / Cookie 模式使用
  const enrichedPageContent = buildEnrichedContent(messages, pageContent);

  const availableProviders = settings.providerPriority.filter(
    (p) => {
      const cfg = settings.providerConfigs[p];
      if (!cfg) return false;
      return cfg.apiKey || cfg.authMode === "cookie" || cfg.authMode === "zeroToken";
    }
  );

  if (availableProviders.length === 0) {
    onError("请先在插件设置中至少为一个 AI 服务填写 API Key，或启用免费模式。");
    return;
  }

  let lastError: Error | null = null;

  for (const provider of availableProviders) {
    const config = settings.providerConfigs[provider];
    let fullText = "";
    let inThinkBlock = false;
    try {
      const displayName = config.displayName || provider;
      console.log(`[AI Web Clipper] StreamChat: 尝试使用 ${displayName}...`);

      // Zero Token 模式：传入结构化 prompt
      if (config.authMode === "zeroToken" && config.zeroTokenProviderId) {
        const ztProvider = getZeroTokenProvider(config.zeroTokenProviderId);
        if (!ztProvider) {
          throw new Error(`Zero Token 提供商 "${config.zeroTokenProviderId}" 不存在`);
        }
        await ztProvider.chatStream(messages, enrichedPageContent, onChunk, onDone, onError);
        return;
      }

      // Cookie 模式：使用 Kimi Web API 的流式接口（向后兼容）
      if (config.authMode === "cookie" && provider === "kimi") {
        await kimiWebChatStream(messages, enrichedPageContent, onChunk, onDone, onError);
        return;
      }

      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl,
        dangerouslyAllowBrowser: true,
        timeout: 180_000,
      });

      const modelParams = getModelParams(provider, config.model);

      const requestParams: Record<string, unknown> = {
        model: config.model,
        messages: fullMessages,
        temperature: modelParams.temperature,
        stream: true,
      };

      if (modelParams.maxTokens !== undefined) {
        requestParams.max_tokens = modelParams.maxTokens;
      }

      if (provider === "kimi") {
        requestParams.thinking = { type: "disabled" };
      }

      // 通过 SDK 选项传入 AbortSignal，确保底层 fetch 可被真正中止
      const stream = await client.chat.completions.create(
        requestParams as any,
        signal ? { signal } : undefined,
      );

      for await (const chunk of stream as any) {
        // 检查是否被用户中止
        if (signal?.aborted) {
          console.log(`[AI Web Clipper] StreamChat: ${displayName} 被用户中止`);
          onDone(fullText);
          return;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          // 实时过滤 <think>...</think> 标签
          let text = delta as string;

          // 处理 think 标签的开始
          if (text.includes("<think>")) {
            inThinkBlock = true;
            text = text.replace(/<think>/gi, "");
          }
          // 处理 think 标签的结束
          if (text.includes("</think>")) {
            inThinkBlock = false;
            text = text.replace(/<\/think>/gi, "");
          }

          // 如果在 think 块内，跳过内容
          if (inThinkBlock) continue;

          if (text) {
            fullText += text;
            onChunk(text);
          }
        }
      }

      console.log(`[AI Web Clipper] StreamChat: ${displayName} 流式回复完成`);
      onDone(fullText);
      return;
    } catch (err) {
      // 用户中止不算错误，但需要保留已生成的内容
      if (signal?.aborted) {
        console.log(`[AI Web Clipper] StreamChat: 用户中止了请求`);
        if (fullText) {
          onDone(fullText);
        }
        return;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Web Clipper] StreamChat: ${config.displayName || provider} 失败: ${lastError.message}`);
    }
  }

  onError(`所有 AI 服务均调用失败。最后一个错误: ${lastError?.message || "未知错误"}`);
}

// -------------------- Prompt 优化接口 --------------------

/**
 * 使用已配置的 AI 模型优化 Prompt 模板
 * @param currentPrompt  当前的 System Prompt 内容
 * @param requirement    用户对优化的要求（如"更简洁"、"增加对代码的处理"等）
 * @returns 优化后的 Prompt 文本
 */
export async function optimizePrompt(
  currentPrompt: string,
  requirement: string,
): Promise<string> {
  const settings = await getSettings();

  const systemPrompt = `你是一个专业的 AI Prompt 工程师。你的任务是根据用户的优化要求，改进给定的 System Prompt。

要求：
1. 直接输出优化后的完整 Prompt，不要包含任何解释、说明或前言
2. 保持 Prompt 的核心意图不变，在此基础上进行优化
3. 优化后的 Prompt 应当清晰、结构化、易于 AI 模型理解和执行
4. 如果用户有具体的优化方向，严格按照该方向优化
5. 输出语言与原 Prompt 保持一致`;

  const userMessage = `## 当前 Prompt

${currentPrompt}

## 优化要求

${requirement}

请直接输出优化后的完整 Prompt：`;

  const availableProviders = settings.providerPriority.filter((p) => {
    const cfg = settings.providerConfigs[p];
    if (!cfg) return false;
    return cfg.apiKey || cfg.authMode === "cookie" || cfg.authMode === "zeroToken";
  });

  if (availableProviders.length === 0) {
    throw new Error("请先在插件设置中至少为一个 AI 服务填写 API Key，或启用免费模式。");
  }

  let lastError: Error | null = null;

  for (const provider of availableProviders) {
    const config = settings.providerConfigs[provider];
    try {
      const displayName = config.displayName || provider;
      console.log(`[AI Web Clipper] OptimizePrompt: 尝试使用 ${displayName}...`);

      // Zero Token 模式
      if (config.authMode === "zeroToken" && config.zeroTokenProviderId) {
        const ztProvider = getZeroTokenProvider(config.zeroTokenProviderId);
        if (!ztProvider) {
          throw new Error(`Zero Token 提供商 "${config.zeroTokenProviderId}" 不存在`);
        }
        const chatMessages: ChatMessage[] = [{ role: "user", content: userMessage }];
        const result = await ztProvider.chat(chatMessages, "");
        console.log(`[AI Web Clipper] OptimizePrompt: ${displayName} 成功`);
        return result;
      }

      // Cookie 模式
      if (config.authMode === "cookie" && provider === "kimi") {
        const chatMessages: ChatMessage[] = [{ role: "user", content: userMessage }];
        const result = await kimiWebChat(chatMessages, "");
        console.log(`[AI Web Clipper] OptimizePrompt: ${displayName} 成功`);
        return result;
      }

      // API Key 模式
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl,
        dangerouslyAllowBrowser: true,
        timeout: 60_000,
      });

      const modelParams = getModelParams(provider, config.model);
      const requestParams: Record<string, unknown> = {
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
      };

      if (modelParams.maxTokens !== undefined) {
        requestParams.max_tokens = modelParams.maxTokens;
      }

      if (provider === "kimi") {
        requestParams.thinking = { type: "disabled" };
      }

      const response = await client.chat.completions.create(requestParams as any);
      const raw = response.choices[0]?.message?.content?.trim();

      if (!raw) {
        throw new Error(`${displayName} AI 未返回有效内容`);
      }

      const cleaned = stripThink(raw);
      console.log(`[AI Web Clipper] OptimizePrompt: ${displayName} 成功`);
      return cleaned;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Web Clipper] OptimizePrompt: ${config.displayName || provider} 失败: ${lastError.message}`);
    }
  }

  throw new Error(`所有 AI 服务均调用失败。最后一个错误: ${lastError?.message || "未知错误"}`);
}
