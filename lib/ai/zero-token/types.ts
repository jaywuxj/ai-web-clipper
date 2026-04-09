// ============================================================
// OpenClaw Zero Token — 类型定义
// 通过浏览器自动化实现免 Token 调用的核心类型
// ============================================================

import type { ChatMessage, SummaryResult } from "../../types";

// -------------------- 提供商适配器接口 --------------------

/**
 * Zero Token 提供商适配器接口
 *
 * 每个免费平台（DeepSeek、Kimi、豆包等）各实现一个适配器，
 * 统一处理：凭证提取 → Token 管理 → API 调用 → SSE 解析
 */
export interface ZeroTokenProvider {
  /** 提供商唯一标识（如 "deepseek-web", "kimi-web", "doubao-web"） */
  readonly id: string;
  /** 显示名称 */
  readonly displayName: string;
  /** 提供商网站域名（用于 host_permissions 和 Cookie 作用域） */
  readonly domain: string;
  /** 浏览器中该平台的登录 URL */
  readonly loginUrl: string;

  /**
   * 检查用户是否已在浏览器中登录该平台
   * @returns true = 已登录（能获取到有效凭证）
   */
  checkLoginStatus(): Promise<boolean>;

  /**
   * 从浏览器中自动提取凭证（Cookie、localStorage Token 等）
   * @returns 凭证对象，null 表示未登录
   */
  extractCredential(): Promise<ZeroTokenCredential | null>;

  /**
   * 获取有效的 access_token（如需要 refresh 会自动处理）
   * @returns 可直接用于 API 调用的 token
   */
  getValidToken(): Promise<string>;

  /**
   * 调用该平台的 AI 进行结构化总结
   */
  summarize(systemPrompt: string, content: string): Promise<SummaryResult>;

  /**
   * 调用该平台的 AI 进行多轮对话（非流式）
   */
  chat(messages: ChatMessage[], pageContent: string): Promise<string>;

  /**
   * 调用该平台的 AI 进行流式多轮对话
   */
  chatStream(
    messages: ChatMessage[],
    pageContent: string,
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): Promise<void>;

  /**
   * 清除该提供商的缓存凭证
   */
  clearCache(): Promise<void>;
}

// -------------------- 凭证类型 --------------------

/** 凭证来源类型 */
export type CredentialSource = "localStorage" | "cookie" | "sessionStorage";

/** Zero Token 凭证 */
export interface ZeroTokenCredential {
  /** 主凭证（token 值） */
  token: string;
  /** 凭证来源 */
  source: CredentialSource;
  /** 获取时间戳 */
  obtainedAt: number;
  /** 额外的凭证数据（如 Cookie 字符串、额外 headers 等） */
  extra?: Record<string, string>;
}

// -------------------- 提供商配置 --------------------

/** Zero Token 提供商注册信息 */
export interface ZeroTokenProviderInfo {
  /** 提供商 ID */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 域名 */
  domain: string;
  /** 登录 URL */
  loginUrl: string;
  /** 模型名称（展示用） */
  modelName: string;
  /** 模型描述 */
  description: string;
  /** 凭证来源类型 */
  credentialSource: CredentialSource;
  /** localStorage 中的 key 名（如果 source 是 localStorage） */
  storageKey?: string;
  /** Cookie 名（如果 source 是 cookie） */
  cookieName?: string;
}

// -------------------- SSE 解析 --------------------

/** SSE 事件 */
export interface SSEEvent {
  /** 事件类型 */
  event?: string;
  /** 数据内容 */
  data: string;
  /** 是否是结束标记 */
  done: boolean;
}

/** SSE 文本提取器：从 SSE data JSON 中提取文本增量 */
export type SSETextExtractor = (data: string) => string | null;
