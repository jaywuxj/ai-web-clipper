// ============================================================
// OpenClaw Zero Token — 智谱 GLM 网页版适配器
// chatglm.cn 免 Token 调用
//
// 核心策略：通过 chrome.scripting 向智谱清言标签页注入脚本，
// 在页面上下文中执行 fetch，浏览器自动携带 Cookie。
//
// Token 刷新: POST https://chatglm.cn/chatglm/backend-api/v1/user/refresh
// 对话 API:   POST https://chatglm.cn/chatglm/backend-api/assistant/stream (SSE)
// 认证: Cookie 中的 chatglm_refresh_token → 换取 access_token
// ============================================================

import type { ChatMessage, SummaryResult } from "../../types";
import type { ZeroTokenCredential } from "./types";
import { BaseZeroTokenProvider } from "./base";

/**
 * 智谱 GLM 网页版适配器
 *
 * 认证方式：
 * - 从 Cookie 读取 chatglm_refresh_token
 * - 通过注入脚本在 chatglm.cn 页面上下文中执行 refresh → 获取 access_token
 * - 用 access_token 调用 /assistant/stream 接口
 *
 * API 接口：
 * - Token 刷新: POST /chatglm/backend-api/v1/user/refresh
 * - 流式对话:   POST /chatglm/backend-api/assistant/stream (SSE)
 * - 删除会话:   POST /chatglm/backend-api/assistant/conversation/delete
 */
export class GlmWebProvider extends BaseZeroTokenProvider {
  readonly id = "glm-web";
  readonly displayName = "智谱 GLM (免费)";
  readonly domain = "chatglm.cn";
  readonly loginUrl = "https://chatglm.cn";

  // ==================== 凭证提取 ====================

  async extractCredential(): Promise<ZeroTokenCredential | null> {
    // 策略 1: 从缓存读取
    const cached = await this.getCachedCredentialFromStorage();
    if (cached) {
      console.log("[GLM Web] 从缓存获取到 refresh_token");
      return { token: cached, source: "cookie", obtainedAt: Date.now() };
    }

    // 策略 2: 从 Cookie 中读取 chatglm_refresh_token
    const refreshToken = await this.readCookie(
      "https://chatglm.cn",
      "chatglm_refresh_token",
    );
    if (refreshToken) {
      console.log("[GLM Web] 从 Cookie 获取到 chatglm_refresh_token");
      await this.cacheCredentialToStorage(refreshToken);
      return {
        token: refreshToken,
        source: "cookie",
        obtainedAt: Date.now(),
      };
    }

    // 策略 3: 从 .chatglm.cn 父域读取
    try {
      const parentCookies = await chrome.cookies.getAll({
        domain: ".chatglm.cn",
      });
      for (const cookie of parentCookies) {
        if (
          cookie.name === "chatglm_refresh_token" &&
          cookie.value
        ) {
          console.log("[GLM Web] 从父域 Cookie 获取到 refresh_token");
          await this.cacheCredentialToStorage(cookie.value);
          return {
            token: cookie.value,
            source: "cookie",
            obtainedAt: Date.now(),
          };
        }
      }
    } catch {}

    // 策略 4: 通过注入脚本从标签页读取
    const injectedToken = await this.readTokenFromTab();
    if (injectedToken) {
      console.log("[GLM Web] 通过注入脚本获取到 refresh_token");
      await this.cacheCredentialToStorage(injectedToken);
      return {
        token: injectedToken,
        source: "cookie",
        obtainedAt: Date.now(),
      };
    }

    return null;
  }

  /** 通过注入脚本到智谱清言标签页读取 token */
  private async readTokenFromTab(): Promise<string | null> {
    try {
      const tabs = await chrome.tabs.query({
        url: "https://chatglm.cn/*",
      });
      if (!tabs.length || !tabs[0].id) return null;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const cookies = document.cookie.split(";");
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (name === "chatglm_refresh_token" && value) {
              return value;
            }
          }
          // 也尝试从 localStorage 读取
          const stored = localStorage.getItem("chatglm_refresh_token");
          if (stored) return stored;
          return null;
        },
      });

      return results?.[0]?.result as string | null;
    } catch (err) {
      console.warn("[GLM Web] 注入脚本读取 token 失败:", err);
      return null;
    }
  }

  // ==================== 标签页管理 ====================

  private async getGlmTabId(): Promise<number> {
    const tabs = await chrome.tabs.query({
      url: "https://chatglm.cn/*",
    });

    if (tabs.length > 0 && tabs[0].id) {
      return tabs[0].id;
    }

    // 没有智谱清言标签页，静默创建一个
    const newTab = await chrome.tabs.create({
      url: "https://chatglm.cn/main/alltoolsdetail",
      active: false,
    });

    if (!newTab.id) {
      throw new Error("无法创建智谱清言标签页");
    }

    // 等待标签页加载完成
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
      ) => {
        if (updatedTabId === newTab.id && changeInfo.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 3000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });

    return newTab.id;
  }

  // ==================== 核心：通过注入脚本在智谱清言页面中执行 API 调用 ====================

  private async sendChatInTab(message: string): Promise<string> {
    const tabId = await this.getGlmTabId();

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (userMessage: string) => {
        try {
          // 生成 UUID
          const uuid = () =>
            "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
              /[xy]/g,
              (c) => {
                const r = (Math.random() * 16) | 0;
                return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
              },
            );

          const API_BASE = "/chatglm/backend-api";

          // ===== 步骤 1: 获取 access token =====
          // 从 Cookie 中读取 refresh_token
          let refreshToken = "";
          const cookies = document.cookie.split(";");
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (name === "chatglm_refresh_token" && value) {
              refreshToken = value;
              break;
            }
          }

          // 也检查 chatglm_token
          let existingToken = "";
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (name === "chatglm_token" && value) {
              existingToken = value;
              break;
            }
          }

          let accessToken = existingToken;

          if (refreshToken) {
            try {
              const refreshResp = await fetch(
                `${API_BASE}/v1/user/refresh`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${refreshToken}`,
                    "App-Name": "chatglm",
                    Platform: "pc",
                  },
                  body: JSON.stringify({}),
                },
              );

              if (refreshResp.ok) {
                const refreshData = await refreshResp.json();
                if (refreshData?.result?.accessToken) {
                  accessToken = refreshData.result.accessToken;
                  console.log("[GLM Inject] 成功刷新 access token");
                }
              } else {
                console.warn(
                  "[GLM Inject] Token 刷新失败:",
                  refreshResp.status,
                );
              }
            } catch (e) {
              console.warn("[GLM Inject] Token 刷新异常:", e);
            }
          }

          if (!accessToken) {
            return {
              error:
                "未找到智谱清言的登录凭证，请确保已在 chatglm.cn 登录",
            };
          }

          // ===== 步骤 2: 动态获取默认 assistant_id =====
          // 首先尝试获取当前用户可用的 assistant 列表来找到正确的 ID
          let assistantId = "";

          try {
            // 尝试从页面的全局状态中获取默认 assistant ID
            const pageState = (window as any).__NEXT_DATA__
              || (window as any).__NUXT__
              || null;
            if (pageState) {
              console.log("[GLM Inject] 检测到页面状态数据");
            }
          } catch {}

          // 如果无法从页面获取，尝试通过 API 获取
          if (!assistantId) {
            try {
              const listResp = await fetch(
                `${API_BASE}/assistant/list?page=1&page_size=1&type=my`,
                {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "App-Name": "chatglm",
                    Platform: "pc",
                  },
                },
              );
              if (listResp.ok) {
                const listData = await listResp.json();
                console.log("[GLM Inject] assistant list 响应:", JSON.stringify(listData).slice(0, 200));
              }
            } catch {}
          }

          // ===== 步骤 3: 发送对话请求 =====
          // 方案 A: 使用 /backend-api/v1/chat/completions (类 OpenAI 格式)
          // 这是更稳定的接口，不依赖 assistant_id
          console.log("[GLM Inject] 尝试使用 chat/completions 接口");

          const chatBody = {
            model: "glm-4-plus",
            messages: [
              {
                role: "user",
                content: userMessage,
              },
            ],
            stream: true,
          };

          // 尝试多个可能的 API 端点
          const endpoints = [
            `${API_BASE}/v1/chat/completions`,
            `${API_BASE}/chat/completions`,
          ];

          let resp: Response | null = null;
          let usedEndpoint = "";

          for (const endpoint of endpoints) {
            try {
              console.log("[GLM Inject] 尝试端点:", endpoint);
              const r = await fetch(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "text/event-stream",
                  Authorization: `Bearer ${accessToken}`,
                  "App-Name": "chatglm",
                  Platform: "pc",
                  "X-Device-Id": uuid(),
                  "X-Request-Id": uuid(),
                },
                body: JSON.stringify(chatBody),
              });
              if (r.ok || r.status !== 404) {
                resp = r;
                usedEndpoint = endpoint;
                break;
              }
            } catch (e) {
              console.warn("[GLM Inject] 端点调用失败:", endpoint, e);
            }
          }

          // 方案 B: 如果上述端点都不行，回退到 /assistant/stream
          if (!resp || !resp.ok) {
            console.log("[GLM Inject] chat/completions 失败，回退到 assistant/stream");
            
            // 使用更通用的 assistant_id 格式
            const assistantBody = {
              assistant_id: "65940acff94777010aa6b796",
              conversation_id: "",
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: userMessage,
                    },
                  ],
                },
              ],
              meta_data: {
                channel: "",
                draft_id: "",
                if_plus_model: true,
                input_question_type: "xxxx",
                is_test: false,
                platform: "pc",
                quote_log_id: "",
              },
            };

            resp = await fetch(`${API_BASE}/assistant/stream`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                Authorization: `Bearer ${accessToken}`,
                "App-Name": "chatglm",
                Platform: "pc",
                "X-Device-Id": uuid(),
                "X-Request-Id": uuid(),
              },
              body: JSON.stringify(assistantBody),
            });
            usedEndpoint = `${API_BASE}/assistant/stream`;
          }

          console.log(
            "[GLM Inject] 响应状态:",
            resp.status,
            resp.statusText,
            "端点:",
            usedEndpoint,
          );

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            if (errText.startsWith("<!") || errText.startsWith("<html")) {
              return {
                error: `智谱清言返回了 HTML 错误页面 (${resp.status})，可能未登录或 Token 已过期`,
              };
            }
            return {
              error: `智谱清言 API 请求失败 (${resp.status}): ${errText.slice(0, 300)}`,
            };
          }

          // 读取 SSE 流式响应
          const reader = resp.body?.getReader();
          if (!reader) {
            return { error: "智谱清言未返回流式响应" };
          }

          const decoder = new TextDecoder();
          let fullText = "";
          let conversationId = "";
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              let dataStr = "";
              if (trimmed.startsWith("data: ")) {
                dataStr = trimmed.slice(6).trim();
              } else if (trimmed.startsWith("data:")) {
                dataStr = trimmed.slice(5).trim();
              } else {
                continue;
              }

              if (!dataStr || dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);

                // 记录会话 ID 用于清理
                if (parsed.conversation_id) {
                  conversationId = parsed.conversation_id;
                }

                // OpenAI 兼容格式 (chat/completions)
                if (parsed.choices?.[0]?.delta?.content) {
                  fullText += parsed.choices[0].delta.content;
                  continue;
                }
                if (parsed.choices?.[0]?.message?.content) {
                  fullText += parsed.choices[0].message.content;
                  continue;
                }

                // 智谱清言 SSE 格式: parts 数组 (assistant/stream)
                if (parsed.parts && Array.isArray(parsed.parts)) {
                  for (const part of parsed.parts) {
                    if (part.content && Array.isArray(part.content)) {
                      for (const item of part.content) {
                        if (item.type === "text" && typeof item.text === "string") {
                          // 全量更新模式
                          fullText = item.text;
                        }
                      }
                    }
                  }
                  continue;
                }

                // 顶层 content
                if (typeof parsed.content === "string") {
                  fullText += parsed.content;
                  continue;
                }
              } catch {
                // 跳过无法解析的行
              }
            }
          }

          // 清理会话（异步，不阻塞）
          if (conversationId) {
            fetch(`${API_BASE}/assistant/conversation/delete`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
                "App-Name": "chatglm",
              },
              body: JSON.stringify({
                conversation_id: conversationId,
              }),
            }).catch(() => {});
          }

          if (!fullText) {
            return {
              error:
                "智谱清言未返回有效内容，可能需要重新登录 chatglm.cn",
            };
          }

          return { text: fullText };
        } catch (err) {
          return {
            error: `智谱清言内部错误: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
      args: [message],
    });

    if (!results || !results[0]) {
      throw new Error("智谱清言标签页脚本执行失败");
    }

    const result = results[0].result as
      | { text?: string; error?: string }
      | null;
    if (!result) {
      throw new Error("智谱清言标签页脚本无返回值");
    }
    if (result.error) {
      throw new Error(result.error);
    }
    return result.text || "";
  }

  // ==================== 对外接口 ====================

  async summarize(
    systemPrompt: string,
    content: string,
  ): Promise<SummaryResult> {
    const userMessage = `${systemPrompt}\n\n---\n\n${content}`;

    try {
      const raw = await this.sendChatInTab(userMessage);
      if (!raw.trim()) {
        throw new Error("智谱清言未返回有效内容");
      }
      return this.parseSummaryJSON(raw.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`智谱清言网页版调用失败: ${msg}`);
    }
  }

  async chat(
    messages: ChatMessage[],
    pageContent: string,
  ): Promise<string> {
    // pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
    const historyParts = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
      .join("\n\n");

    const fullMessage = historyParts
      ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
      : pageContent;

    const raw = await this.sendChatInTab(fullMessage);
    return this.stripThink(raw.trim());
  }

  async chatStream(
    messages: ChatMessage[],
    pageContent: string,
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): Promise<void> {
    try {
      // pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
      const historyParts = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
        .join("\n\n");

      const fullMessage = historyParts
        ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
        : pageContent;

      const raw = await this.sendChatInTab(fullMessage);
      const cleaned = this.stripThink(raw.trim());

      // 模拟流式输出：逐字发送
      const chars = cleaned.split("");
      for (let i = 0; i < chars.length; i += 3) {
        const chunk = chars.slice(i, i + 3).join("");
        onChunk(chunk);
      }

      onDone(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError(`智谱清言网页版调用失败: ${msg}`);
    }
  }
}
