// ============================================================
// Side Panel — 对话式 AI 总结体验
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import {
  MessageType,
  type SummaryResult,
  type PageContent,
  type MessageResponse,
  type PromptTemplate,
  type ChatMessage,
} from "@/lib/types";
import { generateMarkdown } from "@/lib/markdown/generator";
import { getEnabledTemplates, setActiveTemplate } from "@/lib/storage/prompts";
import { chatWithContextStream } from "@/lib/ai/providers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 前端展示用的聊天消息 */
interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** 如果是 AI 回复且成功解析为结构化结果，保存在这里 */
  summary?: SummaryResult;
}

async function sendMsg<T = unknown>(message: Record<string, unknown>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return (await browser.runtime.sendMessage(message)) as T;
    } catch (err) {
      lastError = err;
      if (i < 2) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastError;
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 将 URL 规范化为存储 key（去掉 hash，保留 origin + pathname + search） */
function urlToStorageKey(url: string): string {
  try {
    const u = new URL(url);
    return `chat_history_${u.origin}${u.pathname}${u.search}`;
  } catch {
    return `chat_history_${url}`;
  }
}

/** 持久化对话到 chrome.storage.local */
async function saveHistory(url: string, msgs: DisplayMessage[], pageText: string) {
  if (!url || msgs.length === 0) return;
  const key = urlToStorageKey(url);
  try {
    await chrome.storage.local.set({
      [key]: { messages: msgs, pageTextCache: pageText, savedAt: Date.now() },
    });
  } catch (err) {
    console.warn("[SidePanel] 保存对话历史失败:", err);
  }
}

/** 从 chrome.storage.local 加载对话历史 */
async function loadHistory(url: string): Promise<{ messages: DisplayMessage[]; pageTextCache: string } | null> {
  if (!url) return null;
  const key = urlToStorageKey(url);
  try {
    const result = await chrome.storage.local.get(key);
    const data = result[key] as { messages: DisplayMessage[]; pageTextCache: string; savedAt: number } | undefined;
    if (!data || !data.messages?.length) return null;
    // 7 天过期
    if (Date.now() - data.savedAt > 7 * 24 * 60 * 60 * 1000) {
      await chrome.storage.local.remove(key);
      return null;
    }
    return { messages: data.messages, pageTextCache: data.pageTextCache };
  } catch {
    return null;
  }
}

/** 清除指定 URL 的对话历史 */
async function clearHistory(url: string) {
  if (!url) return;
  const key = urlToStorageKey(url);
  try {
    await chrome.storage.local.remove(key);
  } catch {}
}

/** 获取当前活动标签页的 URL */
async function getCurrentTabUrl(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || "";
  } catch {
    return "";
  }
}

export default function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [pageTextCache, setPageTextCache] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [userInput, setUserInput] = useState("");
  /** 正在流式生成中的 AI 消息 ID，null 表示没有流式生成中 */
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  /** 正在流式生成的文本内容（独立 state，避免高频更新 messages 数组） */
  const [streamingText, setStreamingText] = useState("");
  /** 粘贴模式：当在线文档页面无法自动提取内容时启用 */
  const [pasteMode, setPasteMode] = useState(false);
  /** 当前活动标签页的 URL（用于 UI 显示） */
  const [currentUrl, setCurrentUrl] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templateScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 用于中止流式请求 */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 用 ref 追踪当前 URL，确保闭包中始终是最新值 */
  const currentUrlRef = useRef("");
  /** 用 ref 追踪当前 messages，确保保存时拿到最新值 */
  const messagesRef = useRef<DisplayMessage[]>([]);
  /** 用 ref 追踪 pageTextCache */
  const pageTextCacheRef = useRef("");
  /** 用 ref 追踪流式生成的消息 ID 和文本，供 tab 切换时保留内容 */
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef("");

  // 加载模板
  useEffect(() => {
    (async () => {
      const all = await getEnabledTemplates();
      setTemplates(all);
    })();
  }, []);

  // 同步 ref 以追踪最新值（在闭包/异步回调中使用）
  useEffect(() => { currentUrlRef.current = currentUrl; }, [currentUrl]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { pageTextCacheRef.current = pageTextCache; }, [pageTextCache]);
  useEffect(() => { streamingMsgIdRef.current = streamingMsgId; }, [streamingMsgId]);
  useEffect(() => { streamingTextRef.current = streamingText; }, [streamingText]);

  // 初始化时获取当前标签页 URL 并加载历史对话
  useEffect(() => {
    (async () => {
      const url = await getCurrentTabUrl();
      setCurrentUrl(url);
      currentUrlRef.current = url;
      if (url) {
        const history = await loadHistory(url);
        if (history) {
          setMessages(history.messages);
          setPageTextCache(history.pageTextCache);
          messagesRef.current = history.messages;
          pageTextCacheRef.current = history.pageTextCache;
        }
      }
    })();
  }, []);

  // 监听 tab 切换：保存当前对话，加载新页面的历史
  useEffect(() => {
    const handler = async () => {
      // 1. 先保存旧页面的对话（用 ref 获取最新值，避免闭包捕获旧值）
      const oldUrl = currentUrlRef.current;
      const oldMessages = messagesRef.current;
      const oldPageText = pageTextCacheRef.current;
      if (oldUrl && oldMessages.length > 0) {
        await saveHistory(oldUrl, oldMessages, oldPageText);
      }

      // 2. 如果正在流式生成，保留已生成的内容到 messages 后再中止
      if (abortControllerRef.current) {
        // 先把已生成的流式内容保存到 messages（确保不丢内容）
        const streamId = streamingMsgIdRef.current;
        const streamText = streamingTextRef.current;
        if (streamId && streamText) {
          const partialMsg: DisplayMessage = {
            id: streamId,
            role: "assistant" as const,
            content: streamText,
            timestamp: Date.now(),
          };
          // 同步更新 messagesRef 和 state，这样后面保存旧页面对话时包含这条
          const updatedMsgs = [...messagesRef.current, partialMsg];
          messagesRef.current = updatedMsgs;
          setMessages(updatedMsgs);
          // 同步保存到旧页面
          if (oldUrl) {
            await saveHistory(oldUrl, updatedMsgs, oldPageText);
          }
        }
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setStreamingMsgId(null);
      setStreamingText("");
      streamingMsgIdRef.current = null;
      streamingTextRef.current = "";
      setIsLoading(false);

      // 3. 获取新的 tab URL
      const newUrl = await getCurrentTabUrl();

      // 4. 如果是同一页面，无需切换
      if (newUrl === oldUrl) return;

      // 5. 更新 URL 状态
      setCurrentUrl(newUrl);
      currentUrlRef.current = newUrl;
      setPageContent(null);
      setErrorMsg("");
      setPasteMode(false);

      // 6. 加载新页面的历史对话
      if (newUrl) {
        const history = await loadHistory(newUrl);
        if (history) {
          setMessages(history.messages);
          setPageTextCache(history.pageTextCache);
          messagesRef.current = history.messages;
          pageTextCacheRef.current = history.pageTextCache;
        } else {
          setMessages([]);
          setPageTextCache("");
          messagesRef.current = [];
          pageTextCacheRef.current = "";
        }
      } else {
        setMessages([]);
        setPageTextCache("");
        messagesRef.current = [];
        pageTextCacheRef.current = "";
      }
    };
    browser.tabs.onActivated.addListener(handler);
    return () => browser.tabs.onActivated.removeListener(handler);
  }, []);

  // 监听同一 tab 内的页面导航（URL 变化），避免不同页面对话串内容
  useEffect(() => {
    const handler = async (tabId: number, changeInfo: browser.Tabs.OnUpdatedChangeInfoType) => {
      // 只关心 URL 变化且页面加载完成
      if (!changeInfo.url) return;

      // 确认是当前活动 tab
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || activeTab.id !== tabId) return;
      } catch { return; }

      const oldUrl = currentUrlRef.current;
      const newUrl = changeInfo.url;

      // URL 没变则忽略
      if (urlToStorageKey(newUrl) === urlToStorageKey(oldUrl)) return;

      // 保存旧页面对话
      const oldMessages = messagesRef.current;
      const oldPageText = pageTextCacheRef.current;

      // 如果正在流式生成，保留已生成的内容
      if (abortControllerRef.current) {
        const streamId = streamingMsgIdRef.current;
        const streamText = streamingTextRef.current;
        if (streamId && streamText) {
          const partialMsg: DisplayMessage = {
            id: streamId,
            role: "assistant" as const,
            content: streamText,
            timestamp: Date.now(),
          };
          const updatedMsgs = [...oldMessages, partialMsg];
          if (oldUrl) {
            await saveHistory(oldUrl, updatedMsgs, oldPageText);
          }
        } else if (oldUrl && oldMessages.length > 0) {
          await saveHistory(oldUrl, oldMessages, oldPageText);
        }
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      } else if (oldUrl && oldMessages.length > 0) {
        await saveHistory(oldUrl, oldMessages, oldPageText);
      }

      // 中止流式状态
      setStreamingMsgId(null);
      setStreamingText("");
      streamingMsgIdRef.current = null;
      streamingTextRef.current = "";
      setIsLoading(false);

      // 更新 URL
      setCurrentUrl(newUrl);
      currentUrlRef.current = newUrl;
      setPageContent(null);
      setErrorMsg("");
      setPasteMode(false);

      // 加载新页面的历史
      const history = await loadHistory(newUrl);
      if (history) {
        setMessages(history.messages);
        setPageTextCache(history.pageTextCache);
        messagesRef.current = history.messages;
        pageTextCacheRef.current = history.pageTextCache;
      } else {
        setMessages([]);
        setPageTextCache("");
        messagesRef.current = [];
        pageTextCacheRef.current = "";
      }
    };
    browser.tabs.onUpdated.addListener(handler);
    return () => browser.tabs.onUpdated.removeListener(handler);
  }, []);

  // 用户是否手动向上滚动（用于在流式输出时暂停自动滚动）
  const userScrolledUpRef = useRef(false);

  // 监听滚动事件，判断用户是否主动向上滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      // 距离底部超过 80px 视为用户主动上滑
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUpRef.current = !atBottom;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 自动滚动到底部（仅在用户没有手动上滑时）
  useEffect(() => {
    if (scrollRef.current && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, streamingText]);

  // 新消息发送时重置滚动标记（用户主动发消息后应回到底部）
  useEffect(() => {
    if (isLoading) {
      userScrolledUpRef.current = false;
    }
  }, [isLoading]);

  // 对话消息变化时自动持久化到 chrome.storage.local
  useEffect(() => {
    const url = currentUrlRef.current;
    if (url && messages.length > 0) {
      saveHistory(url, messages, pageTextCache);
    }
  }, [messages, pageTextCache]);

  // textarea 自动调整高度：跟随输入内容，最多不超过容器 1/3 高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;
    // 先重置为最小高度，以便缩小
    textarea.style.height = "auto";
    const maxH = Math.floor(container.clientHeight / 3);
    const minH = 36; // 单行最小高度
    const scrollH = textarea.scrollHeight;
    textarea.style.height = `${Math.max(minH, Math.min(scrollH, maxH))}px`;
  }, []);

  useLayoutEffect(() => {
    adjustTextareaHeight();
  }, [userInput, adjustTextareaHeight]);

  /** 点击模板快捷标签：将模板的 prompt 填入输入框，同时更新选中高亮 */
  const handleTemplateQuickSelect = useCallback((tmpl: PromptTemplate) => {
    setActiveTemplateId(tmpl.id);
    setActiveTemplate(tmpl.id); // 持久化选中状态
    setUserInput(tmpl.prompt);
    // 下一帧聚焦输入框
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  /** 直接在 sidepanel 调用 AI 流式接口，绕过 MV3 Service Worker 的流式限制 */
  const streamChat = useCallback(async (chatHistory: ChatMessage[], pageText: string) => {
    const aiMsgId = genId();
    let accumulated = "";
    /** 标记是否已经把 AI 消息写入 messages，防止重复保存 */
    let saved = false;

    // 创建 AbortController 用于中止
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 开启流式模式：设置 streamingMsgId + 清空 streamingText
    setStreamingMsgId(aiMsgId);
    setStreamingText("");
    setIsLoading(false);

    /** 将已积累的内容写入 messages（仅执行一次） */
    const saveAccumulated = (text?: string) => {
      if (saved) return;
      saved = true;
      const content = text || accumulated;
      if (!content) return;
      setMessages(prev => [...prev, {
        id: aiMsgId,
        role: "assistant" as const,
        content,
        timestamp: Date.now(),
      }]);
    };

    /** 清理流式状态 */
    const cleanupStreaming = () => {
      setStreamingMsgId(null);
      setStreamingText("");
      abortControllerRef.current = null;
    };

    try {
      await chatWithContextStream(
        chatHistory,
        pageText,
        // onChunk：只更新轻量的 streamingText，不触发 messages 数组更新
        (chunk) => {
          accumulated += chunk;
          setStreamingText(accumulated);
        },
        // onDone：流结束，将完整文本写入 messages，关闭流式模式
        (fullText) => {
          saveAccumulated(fullText || accumulated);
          cleanupStreaming();
        },
        // onError：出错
        (error) => {
          saveAccumulated(accumulated || `抱歉，处理失败：${error}`);
          cleanupStreaming();
          setErrorMsg(error);
        },
        // signal：传入 AbortSignal
        controller.signal,
      );

      // chatWithContextStream 正常返回但可能没有调用 onDone（abort 路径）
      // 确保已积累的内容被保存
      if (!saved && accumulated) {
        saveAccumulated();
        cleanupStreaming();
      }
    } catch (err) {
      // 兜底：确保已积累的内容不丢失
      if (!saved) {
        if (controller.signal.aborted) {
          saveAccumulated();
        } else {
          saveAccumulated(accumulated || `抱歉，处理失败：${err instanceof Error ? err.message : "未知错误"}`);
        }
      }
      cleanupStreaming();
    }
  }, []);

  /** 发送第一轮消息：先提取页面内容，再走流式对话 */
  const handleFirstMessage = useCallback(async (_templateId: string, customPrompt?: string) => {
    // UI 展示的文本：如果是模板 prompt 则显示完整内容让用户知道发了什么
    const displayText = customPrompt || "请总结这个页面的内容";

    // 添加用户消息到列表（UI 展示用）
    const userMsg: DisplayMessage = {
      id: genId(),
      role: "user",
      content: displayText,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setErrorMsg("");

    try {
      // 1. 提取页面内容（不调用 AI）
      const extractResponse = await sendMsg<MessageResponse<PageContent>>({
        type: MessageType.EXTRACT_CONTENT,
      });

      if (!extractResponse.success || !extractResponse.data) {
        const errMsg = extractResponse.error || "页面内容提取失败";

        // 检测是否是在线文档平台导致的提取失败
        if (errMsg.includes("Canvas 渲染") || errMsg.includes("粘贴")) {
          setPasteMode(true);
          setIsLoading(false);
          const hintMsg: DisplayMessage = {
            id: genId(),
            role: "assistant",
            content:
              "检测到当前页面为**在线文档平台**（如腾讯文档、企业微信文档等），文档内容采用 Canvas 渲染，无法自动提取。\n\n" +
              "请按以下步骤操作：\n" +
              "1. 在文档页面中按 **Ctrl+A**（Mac: Cmd+A）全选内容\n" +
              "2. 按 **Ctrl+C**（Mac: Cmd+C）复制\n" +
              "3. 回到这里，在输入框中按 **Ctrl+V** 粘贴内容\n" +
              "4. 发送即可让 AI 帮你总结分析\n\n" +
              "💡 *你也可以直接输入想让 AI 分析的文本内容。*",
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, hintMsg]);
          return;
        }

        throw new Error(errMsg);
      }

      const pc = extractResponse.data;
      const pageText = pc.textContent;
      setPageContent(pc);
      setPageTextCache(pageText);

      // 2. 流式对话
      // 发给 AI 的 user message：直接使用用户选择的模板 prompt 或默认指令
      const aiUserText = customPrompt || "请总结这个页面的内容";

      const chatHistory: ChatMessage[] = [
        { role: "user" as const, content: aiUserText },
      ];

      await streamChat(chatHistory, pageText);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "未知错误";
      setErrorMsg(errText);
      const errMsg: DisplayMessage = {
        id: genId(),
        role: "assistant",
        content: `抱歉，处理失败：${errText}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [streamChat]);

  /** 发送后续多轮对话消息（流式） */
  const handleFollowUp = useCallback(async (text: string) => {
    // 添加用户消息
    const userMsg: DisplayMessage = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setErrorMsg("");

    try {
      // 构建对话历史
      const chatHistory: ChatMessage[] = [
        ...messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      await streamChat(chatHistory, pageTextCache);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "未知错误";
      const errMsg: DisplayMessage = {
        id: genId(),
        role: "assistant",
        content: `抱歉，处理失败：${errText}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, pageTextCache, streamChat]);

  /** 重新生成某条 AI 消息 — 删除该条 AI 回复并用相同上下文重新请求 */
  const handleRegenerate = useCallback(async (msgId: string) => {
    if (isLoading || streamingMsgId) return;

    // 找到该 AI 消息在数组中的位置
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;

    // 保留该 AI 消息之前的所有消息
    const prevMessages = messages.slice(0, idx);
    setMessages(prevMessages);
    setIsLoading(true);
    setErrorMsg("");

    try {
      // 用剩余的对话历史重新请求
      const chatHistory: ChatMessage[] = prevMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      await streamChat(chatHistory, pageTextCache);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "未知错误";
      const errMsg: DisplayMessage = {
        id: genId(),
        role: "assistant",
        content: `抱歉，重新生成失败：${errText}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, streamingMsgId, pageTextCache, streamChat]);

  /** 处理用户输入发送 */
  const isBusy = isLoading || streamingMsgId !== null;
  /** 是否正在流式生成中（用于切换按钮样式） */
  const isStreaming = streamingMsgId !== null;

  /** 停止 AI 生成 */
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 立即清理流式状态，停止 UI 更新
    setStreamingMsgId(null);
    setStreamingText("");
  }, []);

  const handleSend = useCallback(() => {
    // 如果正在流式生成，按发送按钮等同于停止
    if (isStreaming) {
      handleStop();
      return;
    }

    const text = userInput.trim();
    if (!text || isBusy) return;
    setUserInput("");

    if (pasteMode && !pageTextCache) {
      // 粘贴模式：第一次收到用户输入时，将其作为"文档内容"
      // 判断：如果输入文本较长（>100字），视为粘贴的文档内容；否则视为直接提问
      if (text.length > 100) {
        // 用户粘贴了文档内容，存为 pageTextCache，然后自动触发总结
        setPageTextCache(text);
        setPageContent({
          title: document.title || "在线文档内容",
          content: text,
          textContent: text,
          excerpt: text.slice(0, 200),
          byline: "",
          siteName: "用户粘贴",
          url: window.location.href,
          faviconUrl: "",
          publishedTime: "",
          savedAt: new Date().toISOString(),
        } as PageContent);

        // 添加一条用户消息（显示前 100 字 + 省略）
        const displayText = text.length > 150
          ? `[已粘贴文档内容，共 ${text.length} 字]\n${text.slice(0, 100)}...`
          : text;
        const userMsg: DisplayMessage = {
          id: genId(),
          role: "user",
          content: displayText,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        // 直接发起流式对话，让 AI 总结粘贴的内容
        const chatHistory: ChatMessage[] = [
          { role: "user" as const, content: "请总结以下内容的要点" },
        ];
        streamChat(chatHistory, text).finally(() => setIsLoading(false));
        return;
      }
      // 输入较短，视为直接提问（无页面上下文）
      // 继续走下面的逻辑
    }

    if (messages.length === 0 && !pasteMode) {
      // 第一轮：走 START_SUMMARY 流程
      handleFirstMessage(activeTemplateId, text);
    } else {
      // 后续轮：走 CHAT_MESSAGE 流程
      handleFollowUp(text);
    }
  }, [userInput, isBusy, isStreaming, handleStop, pasteMode, pageTextCache, messages.length, activeTemplateId, handleFirstMessage, handleFollowUp, streamChat]);

  /** 获取最近一轮的 AI 总结结果（用于保存/复制） */
  const getLatestSummary = (): { summary: SummaryResult; page: PageContent } | null => {
    // 从最新的消息往回找，找到第一个有 summary 的
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].summary && pageContent) {
        return { summary: messages[i].summary!, page: pageContent };
      }
    }
    return null;
  };

  const handleSave = async () => {
    const data = getLatestSummary();
    if (!data) {
      showToast("没有可保存的总结内容");
      return;
    }
    try {
      const res = await sendMsg<MessageResponse>({
        type: MessageType.SAVE_FILE,
        payload: { summary: data.summary, pageContent: data.page },
      });
      showToast(res.success ? "已保存为 Markdown" : (res.error || "保存失败"));
    } catch {
      showToast("保存失败");
    }
  };

  const handleCopy = async () => {
    const data = getLatestSummary();
    if (!data) {
      // 如果没有结构化总结，复制最近一条 AI 回复
      const lastAi = [...messages].reverse().find(m => m.role === "assistant");
      if (lastAi) {
        await navigator.clipboard.writeText(lastAi.content);
        showToast("已复制到剪贴板");
        return;
      }
      showToast("没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(generateMarkdown(data.summary, data.page));
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败");
    }
  };

  const handleNewChat = () => {
    // 中止正在进行的流式请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setPageContent(null);
    setPageTextCache("");
    setErrorMsg("");
    setStreamingMsgId(null);
    setStreamingText("");
    setIsLoading(false);
    // 同步清空 ref，避免异步回调读到旧数据
    messagesRef.current = [];
    pageTextCacheRef.current = "";
    // 清除 storage 中的持久化数据
    if (currentUrl) {
      clearHistory(currentUrl);
    }
    showToast("对话已清除");
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2000);
  };

  /** 记录刚刚复制过的消息 ID，用于显示"已复制"反馈 */
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 复制某条消息的内容到剪贴板 */
  const handleCopyMsg = useCallback(async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedMsgId(null), 1500);
    } catch {
      showToast("复制失败");
    }
  }, []);

  const hasMessages = messages.length > 0 || streamingMsgId !== null;

  /** AI 头像组件 — 使用程序图标 */
  const AiAvatar = () => (
    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-500 shadow-sm">
      <svg width="18" height="18" viewBox="0 0 128 128">
        <defs>
          <linearGradient id="av-bolt" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FCD34D"/>
            <stop offset="100%" stopColor="#F59E0B"/>
          </linearGradient>
        </defs>
        <path d="M40 22h30l20 20v62c0 3.3-2.7 6-6 6H40c-3.3 0-6-2.7-6-6V28c0-3.3 2.7-6 6-6z" fill="white" fillOpacity="0.92"/>
        <path d="M70 22v14c0 3.3 2.7 6 6 6h14z" fill="white" fillOpacity="0.6"/>
        <rect x="44" y="52" width="32" height="3.5" rx="1.75" fill="white" fillOpacity="0.4"/>
        <rect x="44" y="62" width="26" height="3.5" rx="1.75" fill="white" fillOpacity="0.35"/>
        <rect x="44" y="72" width="30" height="3.5" rx="1.75" fill="white" fillOpacity="0.3"/>
        <path d="M78 52l-14 22h10l-4 24 18-28H78l6-18z" fill="url(#av-bolt)" stroke="#F59E0B" strokeWidth="1" strokeLinejoin="round"/>
        <path d="M78 52l-14 22h10l-4 24 18-28H78l6-18z" fill="white" fillOpacity="0.25"/>
      </svg>
    </div>
  );

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-white dark:bg-[#1a1a2e]">
      {/* 内容区：消息列表 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {/* 空状态 */}
        {!hasMessages && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-14 h-14 mb-4 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-md">
              <svg width="28" height="28" viewBox="0 0 128 128">
                <defs>
                  <linearGradient id="empty-bolt" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FCD34D"/>
                    <stop offset="100%" stopColor="#F59E0B"/>
                  </linearGradient>
                </defs>
                <path d="M40 22h30l20 20v62c0 3.3-2.7 6-6 6H40c-3.3 0-6-2.7-6-6V28c0-3.3 2.7-6 6-6z" fill="white" fillOpacity="0.92"/>
                <path d="M70 22v14c0 3.3 2.7 6 6 6h14z" fill="white" fillOpacity="0.6"/>
                <rect x="44" y="52" width="32" height="3.5" rx="1.75" fill="white" fillOpacity="0.4"/>
                <rect x="44" y="62" width="26" height="3.5" rx="1.75" fill="white" fillOpacity="0.35"/>
                <rect x="44" y="72" width="30" height="3.5" rx="1.75" fill="white" fillOpacity="0.3"/>
                <path d="M78 52l-14 22h10l-4 24 18-28H78l6-18z" fill="url(#empty-bolt)" stroke="#F59E0B" strokeWidth="1" strokeLinejoin="round"/>
                <path d="M78 52l-14 22h10l-4 24 18-28H78l6-18z" fill="white" fillOpacity="0.25"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">AI Web Clipper</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">输入指令开始对话，AI 将基于网页内容分析</p>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map((msg) => (
          <div key={msg.id} className={`mb-5 ${msg.role === "user" ? "flex justify-end" : "flex items-start gap-3"} group/msg`}>
            {/* AI 头像 */}
            {msg.role === "assistant" && <AiAvatar />}

            <div className={msg.role === "user" ? "max-w-[80%]" : "flex-1 min-w-0"}>
              <div
                className={
                  msg.role === "user"
                    ? "inline-block rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                    : "text-sm leading-relaxed text-gray-700 dark:text-gray-200"
                }
              >
                {msg.role === "assistant" ? (
                  <div className="markdown-body prose prose-sm dark:prose-invert max-w-none
                    prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:text-gray-800 dark:prose-headings:text-gray-100
                    prose-h1:text-base prose-h2:text-[0.9rem] prose-h3:text-sm
                    prose-p:my-2 prose-p:leading-[1.75]
                    prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
                    prose-strong:font-semibold prose-strong:text-gray-800 dark:prose-strong:text-white
                    prose-code:text-xs prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono
                    prose-pre:bg-gray-50 dark:prose-pre:bg-gray-800/80 prose-pre:rounded-xl prose-pre:p-3 prose-pre:my-3 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-gray-700
                    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                    prose-blockquote:border-l-2 prose-blockquote:border-gray-200 dark:prose-blockquote:border-gray-600 prose-blockquote:pl-4 prose-blockquote:my-3 prose-blockquote:text-gray-500 dark:prose-blockquote:text-gray-400 prose-blockquote:italic
                    prose-table:text-xs prose-th:p-2 prose-td:p-2
                    prose-hr:my-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span>{msg.content}</span>
                )}
              </div>
              {/* 操作按钮栏：AI 消息显示复制/点赞等，用户消息只显示复制 */}
              {msg.role === "assistant" ? (
                <div className="flex items-center gap-1 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                  {/* 复制 */}
                  <button
                    onClick={() => handleCopyMsg(msg.id, msg.content)}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${copiedMsgId === msg.id ? "text-green-500" : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                    title={copiedMsgId === msg.id ? "已复制" : "复制"}
                  >
                    {copiedMsgId === msg.id ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  {/* 重新生成 */}
                  <button
                    onClick={() => handleRegenerate(msg.id)}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                    title="重新生成"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className={`h-5 flex items-center mt-0.5 justify-end mr-1`}>
                  <button
                    onClick={() => handleCopyMsg(msg.id, msg.content)}
                    className="opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200 p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    title="复制"
                  >
                    {copiedMsgId === msg.id ? (
                      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 流式打字：AI 正在生成中 */}
        {streamingMsgId && (
          <div className="mb-5 flex items-start gap-3">
            <AiAvatar />
            <div className="flex-1 min-w-0 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              {streamingText ? (
                <div className="markdown-body prose prose-sm dark:prose-invert max-w-none
                  prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold
                  prose-p:my-2 prose-p:leading-[1.75]
                  prose-strong:font-semibold prose-strong:text-gray-800 dark:prose-strong:text-white
                  prose-code:text-xs prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  <span className="inline-block w-1.5 h-4 bg-indigo-400 dark:bg-indigo-500 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 加载指示器 */}
        {isLoading && (
          <div className="mb-5 flex items-start gap-3">
            <AiAvatar />
            <div className="flex items-center gap-1.5 py-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* 底部：模板快捷栏 + 输入框 */}
      <div className="flex-shrink-0 bg-white dark:bg-[#1a1a2e] border-t border-gray-100 dark:border-gray-800 px-4 pt-3 pb-3">
        {/* 模板快捷标签栏 — 横向可滚动 + 鼠标拖拽滑动 */}
        {templates.length > 0 && (
          <div
            ref={templateScrollRef}
            className="flex gap-2 overflow-x-auto pb-2 template-scrollbar select-none"
            style={{ cursor: "grab" }}
            onMouseDown={(e) => {
              const el = templateScrollRef.current;
              if (!el) return;
              const startX = e.pageX;
              const scrollLeft = el.scrollLeft;
              let moved = false;
              el.style.cursor = "grabbing";

              const onMouseMove = (ev: MouseEvent) => {
                const dx = ev.pageX - startX;
                if (Math.abs(dx) > 3) moved = true;
                el.scrollLeft = scrollLeft - dx;
              };
              const onMouseUp = () => {
                el.style.cursor = "grab";
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                if (moved) {
                  const blockClick = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
                  el.addEventListener("click", blockClick, { capture: true, once: true });
                }
              };
              document.addEventListener("mousemove", onMouseMove);
              document.addEventListener("mouseup", onMouseUp);
            }}
          >
            {templates.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => handleTemplateQuickSelect(tmpl)}
                title={tmpl.description || tmpl.prompt.slice(0, 80)}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer whitespace-nowrap ${
                  activeTemplateId === tmpl.id
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700"
                    : "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                {tmpl.name}
              </button>
            ))}
          </div>
        )}

        {/* 输入框 */}
        <div className="relative flex items-end rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-2.5 shadow-sm focus-within:border-indigo-300 dark:focus-within:border-indigo-600 focus-within:shadow-md transition-all">
          <textarea
            ref={textareaRef}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                if (isStreaming) {
                  e.preventDefault();
                  handleStop();
                } else if (userInput.trim()) {
                  e.preventDefault();
                  handleSend();
                }
              }
            }}
            placeholder={pasteMode && !pageTextCache ? "粘贴文档内容到这里，发送即可 AI 总结..." : hasMessages ? "继续追问..." : "尽管问，带图也行"}
            disabled={isLoading && !isStreaming}
            className="flex-1 text-sm bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none resize-none disabled:opacity-50"
            style={{ minHeight: "36px", maxHeight: containerRef.current ? `${Math.floor(containerRef.current.clientHeight / 3)}px` : "33vh" }}
          />
          {/* 发送/停止按钮 */}
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-white transition-all cursor-pointer ml-2 bg-red-500 hover:bg-red-600 shadow-sm"
              title="停止生成"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!userInput.trim() || isBusy}
              className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-white transition-all cursor-pointer ml-2 shadow-sm ${userInput.trim() && !isBusy ? "bg-indigo-500 hover:bg-indigo-600" : "bg-gray-300 dark:bg-gray-600 opacity-40 cursor-not-allowed"}`}
              title="发送"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            {isStreaming ? "AI 正在回复中... 点击停止或按 Enter 中止" : "Enter 发送 · Shift+Enter 换行"}
          </p>
          {hasMessages && (
            <button
              onClick={handleNewChat}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all cursor-pointer"
              title="清除当前页面的对话历史，重新开始"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              重新开始
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/90 dark:bg-gray-700/90 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full shadow-lg z-50">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

/** 将结构化总结转为可读文本 */
function formatSummaryText(summary: SummaryResult): string {
  const parts: string[] = [];

  if (summary.oneLiner) {
    parts.push(summary.oneLiner);
  }

  if (summary.keyPoints.length > 0) {
    parts.push("");
    parts.push("核心要点：");
    summary.keyPoints.forEach((p, i) => {
      parts.push(`${i + 1}. ${p}`);
    });
  }

  if (summary.detailedSummary) {
    parts.push("");
    parts.push(summary.detailedSummary);
  }

  if (summary.tags.length > 0) {
    parts.push("");
    parts.push(`标签：${summary.tags.map(t => `#${t}`).join(" ")}`);
  }

  return parts.join("\n");
}
