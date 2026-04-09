// ============================================================
// Kimi Web API — 复用浏览器登录态的免 Key 调用模块
// ============================================================

import type { ChatMessage, SummaryResult } from "../types";

// -------------------- 常量 --------------------

const KIMI_DOMAIN = "https://kimi.moonshot.cn";
const KIMI_API_BASE = `${KIMI_DOMAIN}/api`;

/** Kimi 网页版使用的模型 */
const KIMI_WEB_MODEL = "kimi";

// -------------------- 凭证管理 --------------------

export interface KimiCredential {
  /** 从 localStorage 读取的 refresh_token（长期有效） */
  refreshToken: string;
  /** 通过 refresh 接口换取的短期 access_token */
  accessToken?: string;
}

/**
 * 从 Kimi 网站的 localStorage 中获取 refresh_token（即登录凭证）
 *
 * Kimi 将 refresh_token 存储在 https://kimi.moonshot.cn 的 localStorage 中，
 * 而非 Cookie。因此需要通过 chrome.scripting.executeScript 注入脚本到
 * 已打开的 Kimi 标签页中读取，或在后台静默打开一个 Kimi 页面来读取。
 *
 * 读取到的 refresh_token 会同时缓存到 chrome.storage.local 中，
 * 这样 Options 页面等非 background 上下文也能快速获取。
 */
export async function getKimiCredential(): Promise<KimiCredential | null> {
  try {
    // 策略 1：先尝试从扩展缓存中读取（快速路径，适用于 Options 页面）
    const cached = await getTokenFromCache();
    if (cached) {
      console.log("[Kimi Web] 从缓存中获取到 refresh_token，长度:", cached.length);
      return { refreshToken: cached };
    }

    // 策略 2：通过注入脚本到 Kimi 标签页读取 localStorage
    const token = await getTokenFromKimiTab();
    if (token) {
      console.log("[Kimi Web] 从 Kimi 标签页 localStorage 中获取到 refresh_token，长度:", token.length);
      // 缓存到扩展存储中
      await cacheToken(token);
      return { refreshToken: token };
    }

    // 策略 3：尝试从 Cookie 中获取（兼容旧版 Kimi 或某些场景）
    const cookieToken = await getTokenFromCookies();
    if (cookieToken) {
      console.log("[Kimi Web] 从 Cookie 中获取到 token，长度:", cookieToken.length);
      await cacheToken(cookieToken);
      return { refreshToken: cookieToken };
    }

    console.warn("[Kimi Web] 所有策略均未找到 Kimi 登录凭证");
    return null;
  } catch (err) {
    console.warn("[Kimi Web] 获取凭证失败:", err);
    return null;
  }
}

/** 从扩展的 chrome.storage.local 缓存中读取 token */
async function getTokenFromCache(): Promise<string | null> {
  try {
    const data = await chrome.storage.local.get("kimiRefreshToken");
    const cached = data.kimiRefreshToken as { token: string; timestamp: number } | undefined;
    if (!cached?.token) return null;

    // 缓存有效期 24 小时
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > ONE_DAY) {
      console.log("[Kimi Web] 缓存已过期，需要重新获取");
      await chrome.storage.local.remove("kimiRefreshToken");
      return null;
    }

    return cached.token;
  } catch {
    return null;
  }
}

/** 缓存 token 到扩展存储 */
async function cacheToken(token: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      kimiRefreshToken: { token, timestamp: Date.now() },
    });
  } catch (err) {
    console.warn("[Kimi Web] 缓存 token 失败:", err);
  }
}

/** 清除缓存的 token */
export async function clearKimiTokenCache(): Promise<void> {
  await chrome.storage.local.remove("kimiRefreshToken");
}

/**
 * 通过注入脚本到已打开的 Kimi 标签页来读取 localStorage 中的 refresh_token。
 * 如果没有打开 Kimi 标签页，会静默打开一个来获取。
 */
async function getTokenFromKimiTab(): Promise<string | null> {
  try {
    // 查找已打开的 Kimi 标签页
    const tabs = await chrome.tabs.query({ url: "https://kimi.moonshot.cn/*" });
    let tabId: number | null = null;
    let needCleanup = false;

    if (tabs.length > 0 && tabs[0].id) {
      tabId = tabs[0].id;
      console.log("[Kimi Web] 找到已打开的 Kimi 标签页:", tabId);
    } else {
      // 没有打开的 Kimi 标签页，在后台静默创建一个
      console.log("[Kimi Web] 未找到 Kimi 标签页，在后台创建...");
      const newTab = await chrome.tabs.create({
        url: "https://kimi.moonshot.cn",
        active: false,
      });
      if (!newTab.id) return null;
      tabId = newTab.id;
      needCleanup = true;

      // 等待页面加载完成
      await waitForTabLoad(tabId, 10000);
    }

    // 注入脚本读取 localStorage
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 在 Kimi 页面上下文中执行
        const token = localStorage.getItem("refresh_token");
        // refresh_token 可能是数组格式（JSON 字符串），需要处理
        if (token) {
          try {
            const parsed = JSON.parse(token);
            if (Array.isArray(parsed)) {
              // 数组格式：用 . 拼接
              return parsed.join(".");
            }
            return String(parsed);
          } catch {
            // 本身就是字符串
            return token;
          }
        }
        return null;
      },
    });

    // 清理静默创建的标签页
    if (needCleanup && tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }

    if (results && results[0]?.result) {
      return results[0].result as string;
    }

    return null;
  } catch (err) {
    console.warn("[Kimi Web] 从 Kimi 标签页读取 token 失败:", err);
    return null;
  }
}

/** 等待标签页加载完成 */
function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // 超时也继续尝试
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // 额外等待一点时间让 JS 执行完毕
        setTimeout(resolve, 1000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** 从 Cookie 中获取 token（兼容方案） */
async function getTokenFromCookies(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ url: "https://kimi.moonshot.cn" });
    for (const cookie of cookies) {
      if (cookie.name === "access_token" || cookie.name === "refresh_token") {
        if (cookie.value) return cookie.value;
      }
    }

    // 尝试父域
    const parentCookies = await chrome.cookies.getAll({ domain: ".moonshot.cn" });
    for (const cookie of parentCookies) {
      if (cookie.name === "access_token" || cookie.name === "refresh_token") {
        if (cookie.value) return cookie.value;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 检查 Kimi 登录状态
 * @returns true = 已登录（能获取到 refresh_token），false = 未登录
 */
export async function checkKimiLoginStatus(): Promise<boolean> {
  try {
    const credential = await getKimiCredential();
    if (!credential) {
      console.log("[Kimi Web] checkKimiLoginStatus: 未找到凭证");
      return false;
    }
    console.log("[Kimi Web] checkKimiLoginStatus: 已找到凭证");
    return true;
  } catch (err) {
    console.warn("[Kimi Web] checkKimiLoginStatus 异常:", err);
    return false;
  }
}

// -------------------- 内部工具函数 --------------------

// --- access_token 缓存（短期，通过 refresh_token 换取） ---
let _cachedAccessToken: string | null = null;
let _accessTokenExpiresAt = 0;

/**
 * 使用 refresh_token 调用 Kimi 的 token 刷新接口，换取短期有效的 access_token。
 *
 * Kimi 网页版的认证流程：
 * 1. localStorage 中存储 refresh_token（长期有效）
 * 2. 需要通过 GET /api/auth/token/refresh 携带 Bearer refresh_token 换取 access_token
 * 3. access_token 有效期较短（几小时），用于调用实际的 API
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  console.log("[Kimi Web] 开始刷新 access_token...");

  const resp = await fetch(`${KIMI_API_BASE}/auth/token/refresh`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      "Content-Type": "application/json",
      Referer: `${KIMI_DOMAIN}/`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[Kimi Web] 刷新 access_token 失败:", resp.status, text);

    // 如果 refresh_token 也无效了，清除缓存
    if (resp.status === 401 || resp.status === 403) {
      await clearKimiTokenCache();
      throw new Error("Kimi refresh_token 已失效，请重新登录 kimi.moonshot.cn 后再试");
    }

    throw new Error(`Kimi token 刷新失败 (${resp.status}): ${text}`);
  }

  const data = await resp.json();

  // 响应格式可能是 { access_token: "...", refresh_token: "..." }
  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token;

  if (!newAccessToken) {
    // 某些版本可能直接返回 token 字符串
    throw new Error("Kimi token 刷新响应中没有 access_token");
  }

  // 如果返回了新的 refresh_token，更新缓存
  if (newRefreshToken && newRefreshToken !== refreshToken) {
    console.log("[Kimi Web] 获得新的 refresh_token，更新缓存");
    await cacheToken(newRefreshToken);
  }

  // 缓存 access_token（默认缓存 1 小时，实际可能更长）
  _cachedAccessToken = newAccessToken;
  _accessTokenExpiresAt = Date.now() + 60 * 60 * 1000; // 1 小时

  console.log("[Kimi Web] access_token 刷新成功，长度:", newAccessToken.length);
  return newAccessToken;
}

/**
 * 获取有效的 access_token，优先使用缓存，过期则自动刷新。
 * 这是所有 API 调用前都应该调用的函数。
 */
async function getValidAccessToken(): Promise<string> {
  const credential = await getKimiCredential();
  if (!credential) {
    throw new Error("Kimi 未登录，请先访问 kimi.moonshot.cn 登录账号");
  }

  // 1. 先尝试直接用 refresh_token 作为 access_token（kimi-free-api 的方式）
  //    如果 Kimi 更新了 API，这种方式可能返回 401，此时再尝试走 refresh 接口
  if (_cachedAccessToken && Date.now() < _accessTokenExpiresAt) {
    return _cachedAccessToken;
  }

  // 2. 尝试通过 refresh 接口获取 access_token
  try {
    return await refreshAccessToken(credential.refreshToken);
  } catch (refreshErr) {
    console.warn("[Kimi Web] refresh 接口调用失败，尝试直接使用 refresh_token:", refreshErr);

    // 3. Fallback：直接用 refresh_token 作为 access_token
    //    旧版 Kimi / kimi-free-api 方式：refresh_token 本身就可以当 Bearer Token 使用
    _cachedAccessToken = credential.refreshToken;
    _accessTokenExpiresAt = Date.now() + 30 * 60 * 1000; // 30 分钟后重试 refresh
    return credential.refreshToken;
  }
}

/** 构建 Kimi Web API 请求头 */
function buildHeaders(accessToken: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Origin: KIMI_DOMAIN,
    Referer: `${KIMI_DOMAIN}/`,
    "X-Traffic-Id": generateTrafficId(),
  };
}

/** 生成随机 traffic ID（模拟浏览器行为） */
function generateTrafficId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** 创建新对话 */
async function createChat(accessToken: string): Promise<string> {
  const resp = await fetch(`${KIMI_API_BASE}/chat`, {
    method: "POST",
    headers: buildHeaders(accessToken),
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

/** 解析 SSE 流中的文本内容 */
function parseSSEEvent(line: string): string | null {
  if (!line.startsWith("data: ")) return null;

  const jsonStr = line.slice(6).trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;

  try {
    const data = JSON.parse(jsonStr);
    // Kimi SSE 格式: {"event": "cmpl", "text": "..."} 或 {"event": "all_done"}
    if (data.event === "cmpl" && data.text) {
      return data.text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 调用 Kimi 网页版 completion 接口（SSE 流式）
 * @returns 完整的回复文本
 */
async function kimiStreamRequest(
  accessToken: string,
  chatId: string,
  content: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const resp = await fetch(`${KIMI_API_BASE}/chat/${chatId}/completion/stream`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content,
        },
      ],
      refs: [],
      use_search: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 401) {
      throw new Error("Kimi 登录态已过期，请重新登录 kimi.moonshot.cn");
    }
    throw new Error(`Kimi Web API 调用失败 (${resp.status}): ${text}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("Kimi Web API 未返回流式响应");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 按行解析 SSE
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 最后一个可能是不完整的行

    for (const line of lines) {
      const text = parseSSEEvent(line.trim());
      if (text) {
        fullText += text;
        onChunk?.(text);
      }
    }
  }

  // 处理 buffer 中剩余的内容
  if (buffer.trim()) {
    const text = parseSSEEvent(buffer.trim());
    if (text) {
      fullText += text;
      onChunk?.(text);
    }
  }

  return fullText;
}

// -------------------- 对外接口 --------------------

/**
 * 使用 Kimi 网页版（cookie 模式）进行总结
 * 兼容 providers.ts 中 callProvider 的返回格式
 */
export async function kimiWebSummarize(
  systemPrompt: string,
  truncatedContent: string,
): Promise<SummaryResult> {
  const accessToken = await getValidAccessToken();

  let chatId: string;
  try {
    chatId = await createChat(accessToken);
  } catch (err) {
    // 如果创建对话失败（可能是 access_token 过期），清除缓存并重试一次
    if (err instanceof Error && err.message.includes("401")) {
      console.log("[Kimi Web] access_token 可能已过期，清除缓存并重试...");
      _cachedAccessToken = null;
      _accessTokenExpiresAt = 0;
      const freshToken = await getValidAccessToken();
      chatId = await createChat(freshToken);
    } else {
      throw err;
    }
  }

  // 将 system prompt 和用户内容合并为一条消息
  const userMessage = `${systemPrompt}\n\n---\n\n${truncatedContent}`;

  const currentToken = _cachedAccessToken || accessToken;
  const raw = await kimiStreamRequest(
    currentToken,
    chatId,
    userMessage,
  );

  if (!raw.trim()) {
    throw new Error("Kimi 未返回有效内容");
  }

  return parseSummaryJSON(raw.trim());
}

/**
 * 使用 Kimi 网页版进行多轮对话（非流式，等待完整回复）
 */
export async function kimiWebChat(
  messages: ChatMessage[],
  pageContent: string,
): Promise<string> {
  const accessToken = await getValidAccessToken();

  let chatId: string;
  try {
    chatId = await createChat(accessToken);
  } catch (err) {
    if (err instanceof Error && err.message.includes("401")) {
      _cachedAccessToken = null;
      _accessTokenExpiresAt = 0;
      const freshToken = await getValidAccessToken();
      chatId = await createChat(freshToken);
    } else {
      throw err;
    }
  }

  // 构建消息：pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
  const historyParts = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
    .join("\n\n");

  const fullMessage = historyParts
    ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
    : pageContent;

  const currentToken = _cachedAccessToken || accessToken;
  const raw = await kimiStreamRequest(
    currentToken,
    chatId,
    fullMessage,
  );

  return stripThink(raw.trim());
}

/**
 * 使用 Kimi 网页版进行流式多轮对话
 */
export async function kimiWebChatStream(
  messages: ChatMessage[],
  pageContent: string,
  onChunk: (chunk: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): Promise<void> {
  try {
    const accessToken = await getValidAccessToken();

    let chatId: string;
    try {
      chatId = await createChat(accessToken);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        _cachedAccessToken = null;
        _accessTokenExpiresAt = 0;
        const freshToken = await getValidAccessToken();
        chatId = await createChat(freshToken);
      } else {
        throw err;
      }
    }

    // 构建消息：pageContent 已由 providers.ts 拼接好模板指令 + 网页内容，直接使用
    const historyParts = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `[${m.role === "user" ? "用户" : "助手"}]: ${m.content}`)
      .join("\n\n");

    const fullMessage = historyParts
      ? `${pageContent}\n\n---\n\n以下是之前的对话记录：\n${historyParts}`
      : pageContent;

    let inThinkBlock = false;
    const currentToken = _cachedAccessToken || accessToken;
    const fullText = await kimiStreamRequest(
      currentToken,
      chatId,
      fullMessage,
      (chunk) => {
        // 实时过滤 <think>...</think>
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

    onDone(stripThink(fullText));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(`Kimi 网页版调用失败: ${msg}`);
  }
}

// -------------------- 复用 providers.ts 中的解析逻辑 --------------------

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseSummaryJSON(raw: string): SummaryResult {
  let cleaned = stripThink(raw);
  const rawContent = cleaned;

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
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
