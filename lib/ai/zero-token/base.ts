// ============================================================
// OpenClaw Zero Token — 基础适配器（抽象类）
// 提供凭证管理、SSE 解析等公共逻辑
// ============================================================

import type { ChatMessage, SummaryResult } from "../../types";
import type {
  ZeroTokenProvider,
  ZeroTokenCredential,
  SSETextExtractor,
} from "./types";

/** 缓存的 token 信息 */
interface CachedToken {
  value: string;
  expiresAt: number;
}

/**
 * Zero Token 提供商基础类
 *
 * 子类只需要实现：
 * - extractCredential()：从浏览器提取凭证
 * - refreshToken()：用凭证换取/刷新 access_token（如不需要可返回凭证本身）
 * - createChat()：创建对话会话
 * - streamComplete()：发起流式补全请求
 * - buildHeaders()：构建 API 请求头
 * - parseSSEText()：从 SSE data 中提取文本增量
 */
export abstract class BaseZeroTokenProvider implements ZeroTokenProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly domain: string;
  abstract readonly loginUrl: string;

  /** 缓存的 token */
  private _cachedToken: CachedToken | null = null;

  /** 缓存的凭证 */
  private _cachedCredential: ZeroTokenCredential | null = null;

  /** Token 有效期（毫秒），子类可覆写 */
  protected tokenTTL = 60 * 60 * 1000; // 默认 1 小时

  /** 缓存 key 前缀（用于 chrome.storage.local） */
  protected get cacheKey(): string {
    return `zeroToken_${this.id}`;
  }

  // ==================== 凭证管理 ====================

  abstract extractCredential(): Promise<ZeroTokenCredential | null>;

  /**
   * 用凭证换取可用于 API 调用的 token。
   * 默认实现直接返回凭证的 token（某些平台如 DeepSeek 直接用 userToken）。
   * 如果平台需要 refresh 步骤（如 Kimi），子类应覆写此方法。
   */
  protected async refreshToken(credential: ZeroTokenCredential): Promise<string> {
    return credential.token;
  }

  async checkLoginStatus(): Promise<boolean> {
    try {
      const credential = await this.extractCredential();
      return credential !== null;
    } catch {
      return false;
    }
  }

  async getValidToken(): Promise<string> {
    // 1. 检查缓存是否还有效
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt) {
      return this._cachedToken.value;
    }

    // 2. 获取凭证
    const credential = await this.extractCredential();
    if (!credential) {
      throw new Error(
        `${this.displayName} 未登录，请先访问 ${this.loginUrl} 登录账号`,
      );
    }
    this._cachedCredential = credential;

    // 3. 刷新/获取 token
    try {
      const token = await this.refreshToken(credential);
      this._cachedToken = {
        value: token,
        expiresAt: Date.now() + this.tokenTTL,
      };
      return token;
    } catch (err) {
      // 刷新失败，清除缓存
      this._cachedToken = null;
      throw err;
    }
  }

  async clearCache(): Promise<void> {
    this._cachedToken = null;
    this._cachedCredential = null;
    try {
      await chrome.storage.local.remove(this.cacheKey);
    } catch {}
  }

  // ==================== 缓存到 chrome.storage ====================

  protected async getCachedCredentialFromStorage(): Promise<string | null> {
    try {
      const data = await chrome.storage.local.get(this.cacheKey);
      const cached = data[this.cacheKey] as
        | { token: string; timestamp: number }
        | undefined;
      if (!cached?.token) return null;

      // 缓存有效期 24 小时
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - cached.timestamp > ONE_DAY) {
        await chrome.storage.local.remove(this.cacheKey);
        return null;
      }
      return cached.token;
    } catch {
      return null;
    }
  }

  protected async cacheCredentialToStorage(token: string): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.cacheKey]: { token, timestamp: Date.now() },
      });
    } catch (err) {
      console.warn(`[${this.id}] 缓存凭证失败:`, err);
    }
  }

  // ==================== 浏览器交互工具方法 ====================

  /**
   * 通过注入脚本到指定网站的标签页来读取 localStorage 中的值
   */
  protected async readLocalStorageFromTab(
    urlPattern: string,
    key: string,
  ): Promise<string | null> {
    try {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      let tabId: number | null = null;
      let needCleanup = false;

      if (tabs.length > 0 && tabs[0].id) {
        tabId = tabs[0].id;
      } else {
        // 静默创建标签页
        const newTab = await chrome.tabs.create({
          url: this.loginUrl,
          active: false,
        });
        if (!newTab.id) return null;
        tabId = newTab.id;
        needCleanup = true;

        await this.waitForTabLoad(tabId, 10000);
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (storageKey: string) => {
          const val = localStorage.getItem(storageKey);
          if (!val) return null;
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed.join(".");
            return String(parsed);
          } catch {
            return val;
          }
        },
        args: [key],
      });

      if (needCleanup && tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {}
      }

      return results?.[0]?.result as string | null;
    } catch (err) {
      console.warn(`[${this.id}] 从标签页读取 localStorage 失败:`, err);
      return null;
    }
  }

  /**
   * 从 Cookie 中获取指定名称的值
   */
  protected async readCookie(
    url: string,
    cookieName: string,
  ): Promise<string | null> {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      for (const cookie of cookies) {
        if (cookie.name === cookieName && cookie.value) {
          return cookie.value;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 等待标签页加载完成 */
  private waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
      ) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 1000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  // ==================== SSE 解析工具 ====================

  /**
   * 通用 SSE 流式请求与解析
   */
  protected async sseStreamRequest(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    textExtractor: SSETextExtractor,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        await this.clearCache();
        throw new Error(
          `${this.displayName} 登录态已过期，请重新登录 ${this.loginUrl}`,
        );
      }
      throw new Error(
        `${this.displayName} API 调用失败 (${resp.status}): ${text}`,
      );
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      throw new Error(`${this.displayName} API 未返回流式响应`);
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        const text = textExtractor(data);
        if (text) {
          fullText += text;
          onChunk?.(text);
        }
      }
    }

    // 处理 buffer 中剩余的内容
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6).trim();
        if (data && data !== "[DONE]") {
          const text = textExtractor(data);
          if (text) {
            fullText += text;
            onChunk?.(text);
          }
        }
      }
    }

    return fullText;
  }

  // ==================== 响应解析 ====================

  /** 过滤 <think>...</think> 标签 */
  protected stripThink(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }

  /** 将原始文本解析为 SummaryResult */
  protected parseSummaryJSON(raw: string): SummaryResult {
    let cleaned = this.stripThink(raw);
    const rawContent = cleaned;

    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    try {
      const parsed = JSON.parse(cleaned);
      const summary = this.stripThink(String(parsed.detailedSummary || ""));
      const oneLiner = this.stripThink(String(parsed.oneLiner || ""));
      return {
        oneLiner,
        keyPoints: Array.isArray(parsed.keyPoints)
          ? parsed.keyPoints.map((p: unknown) => this.stripThink(String(p)))
          : [],
        detailedSummary: summary,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        rawContent: oneLiner + "\n\n" + summary,
      };
    } catch {
      return this.fallbackParse(cleaned, rawContent);
    }
  }

  private fallbackParse(text: string, rawContent: string): SummaryResult {
    const lines = text.split("\n").filter((l) => l.trim());
    return {
      oneLiner: lines[0] || "总结生成失败，请重试",
      keyPoints: lines.slice(1, 4).map((l) => l.replace(/^[-*•]\s*/, "")),
      detailedSummary: lines.slice(4).join("\n") || text,
      tags: [],
      rawContent,
    };
  }

  // ==================== 对外接口（子类实现核心请求逻辑） ====================

  abstract summarize(
    systemPrompt: string,
    content: string,
  ): Promise<SummaryResult>;
  abstract chat(
    messages: ChatMessage[],
    pageContent: string,
  ): Promise<string>;
  abstract chatStream(
    messages: ChatMessage[],
    pageContent: string,
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): Promise<void>;
}

/** 生成随机 ID */
export function generateRandomId(length = 20): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
