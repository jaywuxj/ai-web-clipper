// ============================================================
// OpenClaw Zero Token — Kimi 网页版适配器
// kimi.moonshot.cn 免 Token 调用（重构自 kimi-web.ts）
// ============================================================

import type { ChatMessage, SummaryResult } from "../../types";
import type { ZeroTokenCredential, SSETextExtractor } from "./types";
import { BaseZeroTokenProvider, generateRandomId } from "./base";

const KIMI_DOMAIN = "https://kimi.moonshot.cn";
const KIMI_API_BASE = `${KIMI_DOMAIN}/api`;

/**
 * Kimi 网页版适配器
 *
 * 认证方式：
 * - 从 localStorage 中读取 "refresh_token" 字段
 * - 通过 GET /api/auth/token/refresh 换取短期 access_token
 * - Fallback: 直接用 refresh_token 作为 Bearer Token
 *
 * API 接口：
 * - 创建对话: POST /api/chat
 * - 流式补全: POST /api/chat/{chatId}/completion/stream (SSE)
 *
 * SSE 格式: {"event": "cmpl", "text": "..."} | {"event": "all_done"}
 */
export class KimiWebProvider extends BaseZeroTokenProvider {
  readonly id = "kimi-web";
  readonly displayName = "Kimi (免费)";
  readonly domain = "kimi.moonshot.cn";
  readonly loginUrl = "https://kimi.moonshot.cn";

  // ==================== 凭证提取 ====================

  async extractCredential(): Promise<ZeroTokenCredential | null> {
    // 策略 1: 从缓存读取
    const cached = await this.getCachedCredentialFromStorage();
    if (cached) {
      console.log("[Kimi Web] 从缓存获取到 refresh_token");
      return { token: cached, source: "localStorage", obtainedAt: Date.now() };
    }

    // 策略 2: 从 Kimi 标签页的 localStorage 读取 refresh_token
    const token = await this.readLocalStorageFromTab(
      "https://kimi.moonshot.cn/*",
      "refresh_token",
    );
    if (token) {
      console.log("[Kimi Web] 从标签页 localStorage 获取到 refresh_token");
      await this.cacheCredentialToStorage(token);
      return { token, source: "localStorage", obtainedAt: Date.now() };
    }

    // 策略 3: 从 Cookie 中获取
    for (const url of [
      "https://kimi.moonshot.cn",
    ]) {
      for (const name of ["access_token", "refresh_token"]) {
        const cookieToken = await this.readCookie(url, name);
        if (cookieToken) {
          console.log(`[Kimi Web] 从 Cookie (${name}) 获取到 token`);
          await this.cacheCredentialToStorage(cookieToken);
          return { token: cookieToken, source: "cookie", obtainedAt: Date.now() };
        }
      }
    }

    // 策略 4: 从 .moonshot.cn 父域读取
    try {
      const parentCookies = await chrome.cookies.getAll({
        domain: ".moonshot.cn",
      });
      for (const cookie of parentCookies) {
        if (
          (cookie.name === "access_token" ||
            cookie.name === "refresh_token") &&
          cookie.value
        ) {
          console.log(`[Kimi Web] 从父域 Cookie (${cookie.name}) 获取到 token`);
          await this.cacheCredentialToStorage(cookie.value);
          return {
            token: cookie.value,
            source: "cookie",
            obtainedAt: Date.now(),
          };
        }
      }
    } catch {}

    return null;
  }

  // ==================== Token 刷新 ====================

  /**
   * Kimi 的 refresh_token → access_token 刷新流程
   */
  protected async refreshToken(
    credential: ZeroTokenCredential,
  ): Promise<string> {
    console.log("[Kimi Web] 开始刷新 access_token...");

    try {
      const resp = await fetch(`${KIMI_API_BASE}/auth/token/refresh`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          Referer: `${KIMI_DOMAIN}/`,
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.warn("[Kimi Web] 刷新 access_token 失败:", resp.status, text);

        if (resp.status === 401 || resp.status === 403) {
          await this.clearCache();
          throw new Error(
            "Kimi refresh_token 已失效，请重新登录 kimi.moonshot.cn",
          );
        }

        // Fallback: 直接用 refresh_token
        console.log("[Kimi Web] 降级为直接使用 refresh_token");
        return credential.token;
      }

      const data = await resp.json();
      const newAccessToken = data.access_token;
      const newRefreshToken = data.refresh_token;

      if (newRefreshToken && newRefreshToken !== credential.token) {
        console.log("[Kimi Web] 获得新的 refresh_token，更新缓存");
        await this.cacheCredentialToStorage(newRefreshToken);
      }

      if (!newAccessToken) {
        console.warn("[Kimi Web] 响应中没有 access_token，使用 refresh_token");
        return credential.token;
      }

      console.log("[Kimi Web] access_token 刷新成功");
      return newAccessToken;
    } catch (err) {
      // 任何刷新失败都 fallback 到直接用 refresh_token
      console.warn("[Kimi Web] refresh 接口调用失败，降级使用 refresh_token:", err);
      return credential.token;
    }
  }

  // ==================== API 调用 ====================

  private buildHeaders(token: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: KIMI_DOMAIN,
      Referer: `${KIMI_DOMAIN}/`,
      "X-Traffic-Id": generateRandomId(20),
    };
  }

  /** 创建新对话 */
  private async createChat(token: string): Promise<string> {
    const resp = await fetch(`${KIMI_API_BASE}/chat`, {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        name: "AI Web Clipper",
        is_example: false,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`创建 Kimi 对话失败 (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    return data.id;
  }

  /**
   * Kimi 的 SSE 文本提取器
   * Kimi SSE 格式: {"event": "cmpl", "text": "..."} | {"event": "all_done"}
   */
  private createTextExtractor(): SSETextExtractor {
    return (data: string): string | null => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.event === "cmpl" && parsed.text) {
          return parsed.text;
        }
        return null;
      } catch {
        return null;
      }
    };
  }

  /** 执行带重试的请求 */
  private async withRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getValidToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        console.log("[Kimi Web] token 可能已过期，清除缓存重试...");
        await this.clearCache();
        const freshToken = await this.getValidToken();
        return await fn(freshToken);
      }
      throw err;
    }
  }

  // ==================== 对外接口 ====================

  async summarize(
    systemPrompt: string,
    content: string,
  ): Promise<SummaryResult> {
    return this.withRetry(async (token) => {
      const chatId = await this.createChat(token);
      const userMessage = `${systemPrompt}\n\n---\n\n${content}`;

      const raw = await this.sseStreamRequest(
        `${KIMI_API_BASE}/chat/${chatId}/completion/stream`,
        this.buildHeaders(token),
        {
          messages: [{ role: "user", content: userMessage }],
          refs: [],
          use_search: false,
        },
        this.createTextExtractor(),
      );

      if (!raw.trim()) {
        throw new Error("Kimi 未返回有效内容");
      }
      return this.parseSummaryJSON(raw.trim());
    });
  }

  async chat(
    messages: ChatMessage[],
    pageContent: string,
  ): Promise<string> {
    return this.withRetry(async (token) => {
      const chatId = await this.createChat(token);

      // pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
      const historyParts = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
        .join("\n\n");

      const fullMessage = historyParts
        ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
        : pageContent;

      const raw = await this.sseStreamRequest(
        `${KIMI_API_BASE}/chat/${chatId}/completion/stream`,
        this.buildHeaders(token),
        {
          messages: [{ role: "user", content: fullMessage }],
          refs: [],
          use_search: false,
        },
        this.createTextExtractor(),
      );

      return this.stripThink(raw.trim());
    });
  }

  async chatStream(
    messages: ChatMessage[],
    pageContent: string,
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): Promise<void> {
    try {
      const token = await this.getValidToken();
      const chatId = await this.createChat(token);

      // pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
      const historyParts = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
        .join("\n\n");

      const fullMessage = historyParts
        ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
        : pageContent;

      let inThinkBlock = false;
      const fullText = await this.sseStreamRequest(
        `${KIMI_API_BASE}/chat/${chatId}/completion/stream`,
        this.buildHeaders(token),
        {
          messages: [{ role: "user", content: fullMessage }],
          refs: [],
          use_search: false,
        },
        this.createTextExtractor(),
        (chunk) => {
          let text = chunk;
          if (text.includes("<think>")) {
            inThinkBlock = true;
            text = text.replace(/<think>/gi, "");
          }
          if (text.includes("</think>")) {
            inThinkBlock = false;
            text = text.replace(/<\/think>/gi, "");
          }
          if (!inThinkBlock && text) {
            onChunk(text);
          }
        },
      );

      onDone(this.stripThink(fullText));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError(`Kimi 网页版调用失败: ${msg}`);
    }
  }
}
