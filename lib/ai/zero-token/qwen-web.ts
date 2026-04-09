// ============================================================
// OpenClaw Zero Token — 通义千问网页版适配器
// tongyi.aliyun.com 免 Token 调用
//
// 核心策略：通过 chrome.scripting 向通义千问标签页注入脚本，
// 在页面上下文中执行 fetch，浏览器自动携带 Cookie。
//
// 真实 API: POST https://qianwen.biz.aliyun.com/dialog/conversation
// 认证: Cookie 中的 tongyi_sso_ticket / login_aliyunid_ticket（浏览器自动携带）
// ============================================================

import type { ChatMessage, SummaryResult } from "../../types";
import type { ZeroTokenCredential } from "./types";
import { BaseZeroTokenProvider } from "./base";

/**
 * 通义千问网页版适配器
 *
 * 认证方式：
 * - 所有请求通过注入脚本在 tongyi.aliyun.com 页面上下文中执行
 * - 浏览器自动携带 Cookie（tongyi_sso_ticket 等）
 *
 * API 接口：
 * - 对话: POST https://qianwen.biz.aliyun.com/dialog/conversation (SSE)
 */
export class QwenWebProvider extends BaseZeroTokenProvider {
  readonly id = "qwen-web";
  readonly displayName = "通义千问 (免费)";
  readonly domain = "tongyi.aliyun.com";
  readonly loginUrl = "https://tongyi.aliyun.com/qianwen";

  // 通义千问可能的域名列表（通义千问已更名为"千问"，域名经历了多次变更）
  private static readonly QWEN_URLS = [
    "https://tongyi.aliyun.com",
    "https://qianwen.com",
    "https://www.qianwen.com",
    "https://chat.qwen.ai",
    "https://tongyi.com",
  ];

  // 通义千问可能的 Cookie 名列表
  private static readonly QWEN_COOKIE_NAMES = [
    "tongyi_sso_ticket",
    "login_aliyunid_ticket",
    "cna",
    "ajs_anonymous_id",
    "token",
    "session_id",
    "_samesite_flag_",
    "t",
    "cookie2",
  ];

  // 通义千问可能的父域
  private static readonly QWEN_PARENT_DOMAINS = [
    ".aliyun.com",
    ".qianwen.com",
    ".qwen.ai",
    ".tongyi.com",
  ];

  // ==================== 凭证提取 ====================

  async extractCredential(): Promise<ZeroTokenCredential | null> {
    // 策略 1: 从缓存读取
    const cached = await this.getCachedCredentialFromStorage();
    if (cached) {
      console.log("[Qwen Web] 从缓存获取到 ticket");
      return { token: cached, source: "cookie", obtainedAt: Date.now() };
    }

    // 策略 2: 从多个可能的 URL 和 Cookie 名组合中尝试读取
    for (const url of QwenWebProvider.QWEN_URLS) {
      for (const cookieName of ["tongyi_sso_ticket", "login_aliyunid_ticket"]) {
        const ticket = await this.readCookie(url, cookieName);
        if (ticket) {
          console.log(`[Qwen Web] 从 ${url} Cookie (${cookieName}) 获取到 ticket`);
          await this.cacheCredentialToStorage(ticket);
          return { token: ticket, source: "cookie", obtainedAt: Date.now() };
        }
      }
    }

    // 策略 3: 从各个父域读取
    for (const domain of QwenWebProvider.QWEN_PARENT_DOMAINS) {
      try {
        const parentCookies = await chrome.cookies.getAll({ domain });
        for (const cookie of parentCookies) {
          if (
            (cookie.name === "tongyi_sso_ticket" ||
              cookie.name === "login_aliyunid_ticket" ||
              cookie.name === "token") &&
            cookie.value
          ) {
            console.log(
              `[Qwen Web] 从父域 ${domain} Cookie (${cookie.name}) 获取到 ticket`,
            );
            await this.cacheCredentialToStorage(cookie.value);
            return {
              token: cookie.value,
              source: "cookie",
              obtainedAt: Date.now(),
            };
          }
        }
      } catch {}
    }

    // 策略 4: 检查是否有任何千问相关域名的标签页已打开，通过注入脚本读取
    const injectedTicket = await this.readTicketFromTab();
    if (injectedTicket) {
      console.log("[Qwen Web] 通过注入脚本获取到 ticket");
      await this.cacheCredentialToStorage(injectedTicket);
      return {
        token: injectedTicket,
        source: "cookie",
        obtainedAt: Date.now(),
      };
    }

    // 策略 5: 最后尝试检查所有千问相关域名的所有 Cookie，看是否有任何看起来像 token 的值
    for (const domain of QwenWebProvider.QWEN_PARENT_DOMAINS) {
      try {
        const allCookies = await chrome.cookies.getAll({ domain });
        console.log(`[Qwen Web] ${domain} 域下共有 ${allCookies.length} 个 Cookie:`,
          allCookies.map(c => c.name).join(", "));
        // 寻找任何看起来像认证 token 的 Cookie
        for (const cookie of allCookies) {
          if (
            cookie.value &&
            cookie.value.length > 20 &&
            (cookie.name.toLowerCase().includes("token") ||
              cookie.name.toLowerCase().includes("ticket") ||
              cookie.name.toLowerCase().includes("session") ||
              cookie.name.toLowerCase().includes("sso"))
          ) {
            console.log(`[Qwen Web] 发现可能的认证 Cookie: ${cookie.name} (长度: ${cookie.value.length})`);
            await this.cacheCredentialToStorage(cookie.value);
            return {
              token: cookie.value,
              source: "cookie",
              obtainedAt: Date.now(),
            };
          }
        }
      } catch {}
    }

    return null;
  }

  /** 通过注入脚本到通义千问标签页读取 ticket */
  private async readTicketFromTab(): Promise<string | null> {
    // 尝试多个 URL 模式
    const urlPatterns = [
      "https://tongyi.aliyun.com/*",
      "https://qianwen.com/*",
      "https://www.qianwen.com/*",
      "https://chat.qwen.ai/*",
      "https://tongyi.com/*",
    ];

    for (const pattern of urlPatterns) {
      try {
        const tabs = await chrome.tabs.query({ url: pattern });
        if (!tabs.length || !tabs[0].id) continue;

        console.log(`[Qwen Web] 找到千问标签页: ${pattern}`);

        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            const cookies = document.cookie.split(";");
            // 检查所有 Cookie，寻找认证相关的
            const tokenCookieNames = [
              "tongyi_sso_ticket",
              "login_aliyunid_ticket",
              "token",
              "session_id",
            ];
            for (const cookie of cookies) {
              const eqIdx = cookie.indexOf("=");
              if (eqIdx === -1) continue;
              const name = cookie.slice(0, eqIdx).trim();
              const value = cookie.slice(eqIdx + 1).trim();
              if (tokenCookieNames.includes(name) && value) {
                return value;
              }
            }
            // 也尝试从 localStorage 读取
            for (const key of ["token", "access_token", "user_token", "session"]) {
              const val = localStorage.getItem(key);
              if (val) return val;
            }
            // 打印所有 Cookie 名用于调试
            console.log("[Qwen Inject] 所有 Cookie:", cookies.map(c => c.trim().split("=")[0]).join(", "));
            return null;
          },
        });

        const result = results?.[0]?.result as string | null;
        if (result) return result;
      } catch (err) {
        console.warn(`[Qwen Web] 注入脚本读取 ticket 失败 (${pattern}):`, err);
      }
    }

    return null;
  }

  // ==================== 标签页管理 ====================

  private async getQwenTabId(): Promise<number> {
    // 尝试多个 URL 模式查找已有标签页
    const urlPatterns = [
      "https://tongyi.aliyun.com/*",
      "https://qianwen.com/*",
      "https://www.qianwen.com/*",
      "https://chat.qwen.ai/*",
      "https://tongyi.com/*",
    ];

    for (const pattern of urlPatterns) {
      try {
        const tabs = await chrome.tabs.query({ url: pattern });
        if (tabs.length > 0 && tabs[0].id) {
          console.log(`[Qwen Web] 找到已有标签页: ${pattern}`);
          return tabs[0].id;
        }
      } catch {}
    }

    // 没有通义千问标签页，静默创建一个（优先使用新域名）
    const newTab = await chrome.tabs.create({
      url: "https://tongyi.aliyun.com/qianwen",
      active: false,
    });

    if (!newTab.id) {
      throw new Error("无法创建通义千问标签页");
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

  // ==================== 核心：通过注入脚本在通义千问页面中执行 API 调用 ====================

  private async sendChatInTab(message: string): Promise<string> {
    const tabId = await this.getQwenTabId();

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

          const requestId = uuid();

          // 获取 XSRF-TOKEN
          const xsrfToken =
            document.cookie
              .split(";")
              .find((c) => c.trim().startsWith("XSRF-TOKEN="))
              ?.split("=")
              .slice(1)
              .join("=") || "";

          // 构建请求体
          const body = {
            mode: "chat",
            model: "",
            action: "next",
            userAction: "chat",
            requestId: requestId,
            sessionId: "",
            sessionType: "text_chat",
            parentMsgId: "0",
            params: {
              fileUploadBatchId: uuid(),
            },
            contents: [
              {
                content: userMessage,
                contentType: "text",
                role: "user",
              },
            ],
          };

          // 尝试多个可能的 API 端点
          const apiEndpoints = [
            "https://qianwen.biz.aliyun.com/dialog/conversation",
            "/api/chat/conversation",
            "/dialog/conversation",
          ];

          let resp: Response | null = null;
          let usedEndpoint = "";

          for (const endpoint of apiEndpoints) {
            try {
              console.log("[Qwen Inject] 尝试端点:", endpoint);
              const r = await fetch(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "text/event-stream",
                  "X-Platform": "pc_tongyi",
                  ...(xsrfToken ? { "X-Xsrf-Token": xsrfToken } : {}),
                },
                body: JSON.stringify(body),
              });

              console.log(`[Qwen Inject] ${endpoint} 响应状态:`, r.status, r.statusText);

              if (r.ok) {
                resp = r;
                usedEndpoint = endpoint;
                break;
              }

              // 如果是认证错误或服务端错误，记录但继续尝试下一个端点
              if (r.status === 401 || r.status === 403) {
                const errText = await r.text().catch(() => "");
                console.warn(`[Qwen Inject] ${endpoint} 认证失败:`, errText.slice(0, 200));
                continue;
              }

              // 如果不是 404，可能是其他错误，保存响应
              if (r.status !== 404) {
                resp = r;
                usedEndpoint = endpoint;
                break;
              }
            } catch (e) {
              console.warn("[Qwen Inject] 端点调用异常:", endpoint, e);
            }
          }

          if (!resp) {
            // 打印诊断信息
            const allCookies = document.cookie.split(";").map(c => c.trim().split("=")[0]);
            return {
              error: `通义千问所有 API 端点均不可用。当前域名: ${location.hostname}，Cookie names: ${allCookies.join(", ")}`,
            };
          }

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            if (errText.startsWith("<!") || errText.startsWith("<html")) {
              return {
                error: `通义千问返回了 HTML 错误页面 (${resp.status})，可能未登录或 Cookie 已过期`,
              };
            }
            return {
              error: `通义千问 API 请求失败 (${resp.status}): ${errText.slice(0, 300)}`,
            };
          }

          console.log("[Qwen Inject] 使用端点:", usedEndpoint);

          // 读取 SSE 流式响应
          const reader = resp.body?.getReader();
          if (!reader) {
            return { error: "通义千问未返回流式响应" };
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
              if (!trimmed) continue;

              let dataStr = "";
              if (trimmed.startsWith("data:")) {
                dataStr = trimmed.slice(5).trim();
              } else {
                continue;
              }

              if (!dataStr || dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);

                // 通义千问 SSE 格式: contents 数组中的 text content
                if (parsed.contents && Array.isArray(parsed.contents)) {
                  for (const part of parsed.contents) {
                    if (
                      part.contentType === "text" &&
                      part.role === "assistant" &&
                      typeof part.content === "string"
                    ) {
                      // 通义千问是全量更新模式，每次返回完整文本
                      fullText = part.content;
                    }
                  }
                  continue;
                }

                // 兼容 OpenAI 格式
                if (parsed.choices?.[0]?.delta?.content) {
                  fullText += parsed.choices[0].delta.content;
                  continue;
                }
                if (parsed.choices?.[0]?.message?.content) {
                  fullText += parsed.choices[0].message.content;
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

          if (!fullText) {
            return {
              error:
                "通义千问未返回有效内容，可能需要重新登录 tongyi.aliyun.com 或 qianwen.com",
            };
          }

          return { text: fullText };
        } catch (err) {
          return {
            error: `通义千问内部错误: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
      args: [message],
    });

    if (!results || !results[0]) {
      throw new Error("通义千问标签页脚本执行失败");
    }

    const result = results[0].result as
      | { text?: string; error?: string }
      | null;
    if (!result) {
      throw new Error("通义千问标签页脚本无返回值");
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
        throw new Error("通义千问未返回有效内容");
      }
      return this.parseSummaryJSON(raw.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`通义千问网页版调用失败: ${msg}`);
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
      onError(`通义千问网页版调用失败: ${msg}`);
    }
  }
}
