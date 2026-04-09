// ============================================================
// Popup 主应用组件 — 后台运行模式
// 总结+保存全程在 background service worker 执行，
// Popup 仅触发和展示状态，关闭 Popup 不影响后台处理。
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageType,
  type SummaryResult,
  type PageContent,
  type MessageResponse,
  type PromptTemplate,
  type BackgroundTaskStatus,
} from "@/lib/types";
import { generateMarkdown } from "@/lib/markdown/generator";
import { getEnabledTemplates, getActiveTemplate, setActiveTemplate } from "@/lib/storage/prompts";
import SummaryCard from "@/components/SummaryCard";
import ActionBar from "@/components/ActionBar";
import StatusIndicator from "@/components/StatusIndicator";
import Header from "@/components/Header";
import TagEditor from "@/components/TagEditor";
import TemplateSelector from "@/components/TemplateSelector";

type AppState = "selecting" | "processing" | "done" | "success" | "error";

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

const STATUS_TEXT: Record<string, string> = {
  extracting: "正在提取页面内容...",
  summarizing: "AI 正在阅读并生成总结...",
  saving: "正在保存文件...",
};

export default function App() {
  const [state, setState] = useState<AppState>("selecting");
  const [statusMsg, setStatusMsg] = useState("");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState("default");
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // 初始化：加载模板 + 检查是否有当前页面的后台任务
  useEffect(() => {
    (async () => {
      try {
        const all = await getEnabledTemplates();
        setTemplates(all);
        const active = await getActiveTemplate();
        setActiveTemplateId(active.id);
      } catch {}

      // 获取当前 tab URL
      let currentUrl = "";
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        currentUrl = tab?.url || "";
      } catch {}

      // 检查后台任务状态，匹配当前页面 URL 时才恢复
      const data = await chrome.storage.session.get("bgTaskStatus");
      const task = data.bgTaskStatus as BackgroundTaskStatus | undefined;
      if (task && task.state !== "idle" && task.url === currentUrl) {
        applyTaskStatus(task);
        if (task.state !== "done" && task.state !== "error") {
          startPolling(currentUrl);
        }
      }
    })();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const applyTaskStatus = (task: BackgroundTaskStatus) => {
    if (task.state === "done") {
      setState("done");
      if (task.summary) setSummary(task.summary);
      if (task.pageContent) setPageContent(task.pageContent);
    } else if (task.state === "error") {
      setState("error");
      setErrorMsg(task.error || "后台处理失败");
    } else {
      setState("processing");
      setStatusMsg(STATUS_TEXT[task.state] || "处理中...");
      if (task.pageContent) setPageContent(task.pageContent);
    }
  };

  const startPolling = (currentUrl?: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const pollStartTime = Date.now();
    const POLL_TIMEOUT = 120_000; // 2 分钟超时
    let lastState = "";

    pollRef.current = setInterval(async () => {
      const data = await chrome.storage.session.get("bgTaskStatus");
      const task = data.bgTaskStatus as BackgroundTaskStatus | undefined;

      // 超时检测：如果 2 分钟没有完成，提示用户
      if (Date.now() - pollStartTime > POLL_TIMEOUT && state === "processing") {
        clearInterval(pollRef.current!);
        setState("error");
        setErrorMsg("处理超时（超过 2 分钟），可能原因：页面内容过长、AI 服务响应缓慢或网络异常。请检查网络后重试。");
        return;
      }

      if (!task) return;
      // 如果提供了 URL 且不匹配，停止轮询
      if (currentUrl && task.url && task.url !== currentUrl) {
        clearInterval(pollRef.current!);
        setState("selecting");
        return;
      }

      // 记录状态变化用于日志
      if (task.state !== lastState) {
        console.log(`[AI Web Clipper Popup] 状态变化: ${lastState || 'init'} → ${task.state}`);
        lastState = task.state;
      }

      applyTaskStatus(task);
      if (task.state === "done" || task.state === "error") {
        clearInterval(pollRef.current!);
      }
    }, 500);
  };

  // 选择模板 → 触发后台处理
  const handleSelectTemplate = useCallback(async (templateId: string) => {
    await setActiveTemplate(templateId);
    setActiveTemplateId(templateId);

    // 清除旧状态
    await chrome.storage.session.remove("bgTaskStatus");
    setState("processing");
    setStatusMsg("正在提取页面内容...");
    setErrorMsg("");
    setSummary(null);
    setPageContent(null);

    // 获取当前 URL 用于轮询匹配
    let currentUrl = "";
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      currentUrl = tab?.url || "";
    } catch {}

    try {
      // Fire-and-forget：发送后台处理消息，不等待回复
      browser.runtime.sendMessage({
        type: MessageType.SUMMARIZE_AND_SAVE,
        payload: { promptId: templateId },
      }).catch(() => {});

      // 直接开始轮询状态，传入当前 URL
      startPolling(currentUrl);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "未知错误";
      setErrorMsg(
        rawMsg.includes("Receiving end does not exist")
          ? "连接插件后台失败，请刷新当前页面后重试"
          : rawMsg.includes("Could not establish connection")
          ? "无法连接到插件后台服务，请重新加载插件后重试"
          : rawMsg
      );
      setState("error");
    }
  }, []);

  // 自定义指令 → 触发后台处理（一次性，不保存）
  const handleCustomPrompt = useCallback(async (customPrompt: string) => {
    // 清除旧状态
    await chrome.storage.session.remove("bgTaskStatus");
    setState("processing");
    setStatusMsg("正在提取页面内容...");
    setErrorMsg("");
    setSummary(null);
    setPageContent(null);

    // 获取当前 URL 用于轮询匹配
    let currentUrl = "";
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      currentUrl = tab?.url || "";
    } catch {}

    try {
      // Fire-and-forget：发送后台处理消息，携带自定义 prompt
      browser.runtime.sendMessage({
        type: MessageType.SUMMARIZE_AND_SAVE,
        payload: { customPrompt },
      }).catch(() => {});

      // 开始轮询状态
      startPolling(currentUrl);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "未知错误";
      setErrorMsg(
        rawMsg.includes("Receiving end does not exist")
          ? "连接插件后台失败，请刷新当前页面后重试"
          : rawMsg.includes("Could not establish connection")
          ? "无法连接到插件后台服务，请重新加载插件后重试"
          : rawMsg
      );
      setState("error");
    }
  }, []);

  const handleRetry = useCallback(async () => {
    await chrome.storage.session.remove("bgTaskStatus");
    setState("selecting");
    setSummary(null);
    setPageContent(null);
    setErrorMsg("");
  }, []);

  const handleTagsChange = (newTags: string[]) => {
    if (summary) setSummary({ ...summary, tags: newTags });
  };

  const handleSave = async () => {
    if (!summary || !pageContent) return;
    try {
      const res = await sendMsg<MessageResponse>({
        type: MessageType.SAVE_FILE,
        payload: { summary, pageContent },
      });
      showToast(res.success ? "已保存为 Markdown 文件" : (res.error || "保存失败"));
    } catch {
      showToast("保存失败");
    }
  };

  const handleCopy = async () => {
    if (!summary || !pageContent) return;
    try {
      await navigator.clipboard.writeText(generateMarkdown(summary, pageContent));
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败");
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2000);
  };

  return (
    <div className="flex flex-col min-h-[200px] max-h-[600px]">
      <Header
        title={pageContent?.title}
        faviconUrl={pageContent?.faviconUrl}
        siteName={pageContent?.siteName}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {/* 模板选择 */}
        {state === "selecting" && (
          <TemplateSelector
            templates={templates}
            activeId={activeTemplateId}
            onSelect={handleSelectTemplate}
            onCustomPrompt={handleCustomPrompt}
          />
        )}

        {/* 后台处理中 */}
        {state === "processing" && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {statusMsg}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              后台运行中，关闭此窗口不影响处理
            </p>
          </div>
        )}

        {/* 完成 */}
        {state === "done" && summary && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">总结完成，已自动保存</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{summary.oneLiner}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={handleCopy} className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                复制 Markdown
              </button>
              <button onClick={handleRetry} className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer">
                换个模板
              </button>
            </div>
          </div>
        )}

        {/* 错误 */}
        {state === "error" && (
          <StatusIndicator
            type="error"
            message={errorMsg}
            onRetry={handleRetry}
          />
        )}

        {/* 手动模式（fallback） */}
        {state === "success" && summary && (
          <>
            <SummaryCard summary={summary} />
            <TagEditor tags={summary.tags} onChange={handleTagsChange} />
            {pageContent && pageContent.textContent && (
              <section className="mt-2">
                <button
                  onClick={() => setShowOriginal(!showOriginal)}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-blue-500 transition-colors cursor-pointer"
                >
                  <span className={`transition-transform ${showOriginal ? "rotate-90" : ""}`}>&#9654;</span>
                  页面原文
                  <span className="normal-case font-normal text-gray-300 dark:text-gray-600">
                    ({Math.round(pageContent.textContent.length / 1000)}k 字)
                  </span>
                </button>
                {showOriginal && (
                  <div className="mt-2 max-h-[300px] overflow-y-auto text-xs text-gray-600 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                    {pageContent.textContent.split("\n").map((para, i) =>
                      para.trim() ? <p key={i} className="mb-2">{para}</p> : null
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {state === "success" && (
        <ActionBar onSave={handleSave} onCopy={handleCopy} onRetry={handleRetry} />
      )}

      {toastMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 text-xs px-4 py-2 rounded-full shadow-lg animate-fade-in z-50">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
