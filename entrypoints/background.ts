// ============================================================
// Service Worker (Background) — 消息中枢 & 业务协调
// ============================================================

import { summarize, chatWithContext, getSettings } from "@/lib/ai/providers";
import { generateMarkdown } from "@/lib/markdown/generator";
import { addHistoryEntry } from "@/lib/storage/history";
import { sanitizeFilename } from "@/lib/utils/filename";
import { checkKimiLoginStatus } from "@/lib/ai/kimi-web";
import { checkAllZeroTokenLoginStatus, getZeroTokenProvider } from "@/lib/ai/zero-token";
import { classifyArticle } from "@/lib/ai/classifier";
import { isPdfUrl, extractPdfContent } from "@/lib/utils/pdf-extractor";
import {
  getKnowledgeTree,
  saveKnowledgeTree,
  mergePathsIntoTree,
  buildFilePath,
  getPendingProposal,
  savePendingProposal,
  clearPendingProposal,
} from "@/lib/storage/knowledge";
import {
  MessageType,
  type ChatMessage,
  type PageContent,
  type SummaryResult,
  type MessageResponse,
  type HistoryEntry,
  type BackgroundTaskStatus,
  type KnowledgeUpdateProposal,
} from "@/lib/types";


export default defineBackground(() => {
  // --------------------------------------------------
  // 消息监听器
  // --------------------------------------------------
  browser.runtime.onMessage.addListener(
    (
      message: { type: string; payload?: unknown },
      _sender,
      sendResponse: (response: MessageResponse) => void
    ) => {
      switch (message.type) {
        case MessageType.EXTRACT_CONTENT:
          handleExtractContent(sendResponse);
          break;

        case MessageType.START_SUMMARY:
          handleStartSummary(
            sendResponse,
            (message.payload as { promptId?: string; customTags?: string[]; customPrompt?: string }) || {}
          );
          break;

        case MessageType.START_SUMMARY_SELECTION: {
          const selPayload = message.payload as { selectedText: string };
          handleStartSummarySelection(selPayload.selectedText, sendResponse);
          break;
        }

        case MessageType.SAVE_FILE:
          handleSaveFile(
            message.payload as {
              summary: SummaryResult;
              pageContent: PageContent;
            },
            sendResponse
          );
          break;

        case MessageType.SUMMARIZE_AND_SAVE:
          // 在消息回调内异步执行全流程，保持 service worker 存活
          // sendResponse 延迟到全部完成后调用，防止 MV3 SW 被提前终止
          handleSummarizeAndSave(
            (message.payload as { promptId?: string; customPrompt?: string }) || {}
          ).then(() => {
            sendResponse({ success: true });
          }).catch((err) => {
            sendResponse({ success: false, error: err instanceof Error ? err.message : "后台处理失败" });
          });
          break;

        case MessageType.CHAT_MESSAGE:
          handleChatMessage(
            message.payload as {
              messages: ChatMessage[];
              pageContent: string;
              promptId?: string;
            },
            sendResponse
          );
          break;

        case MessageType.CHECK_KIMI_LOGIN:
          // 在 background service worker 中执行 Kimi 登录检测
          // 只有 background 有 chrome.scripting.executeScript 权限
          checkKimiLoginStatus().then((loggedIn) => {
            sendResponse({ success: true, data: { loggedIn } });
          }).catch((err) => {
            console.warn("[AI Web Clipper] Check Kimi login failed:", err);
            sendResponse({ success: true, data: { loggedIn: false } });
          });
          break;

        case MessageType.CHECK_ZERO_TOKEN_LOGIN:
          // 批量检查所有 Zero Token 提供商的登录状态
          // 如果 payload 包含 providerId，只检查指定的提供商
          {
            const ztPayload = message.payload as { providerId?: string } | undefined;
            if (ztPayload?.providerId) {
              const provider = getZeroTokenProvider(ztPayload.providerId);
              if (provider) {
                provider.checkLoginStatus().then((loggedIn) => {
                  sendResponse({ success: true, data: { [ztPayload.providerId!]: loggedIn } });
                }).catch(() => {
                  sendResponse({ success: true, data: { [ztPayload.providerId!]: false } });
                });
              } else {
                sendResponse({ success: true, data: {} });
              }
            } else {
              checkAllZeroTokenLoginStatus().then((statuses) => {
                sendResponse({ success: true, data: statuses });
              }).catch(() => {
                sendResponse({ success: true, data: {} });
              });
            }
          }
          break;

        case MessageType.REBUILD_KNOWLEDGE_TREE:
          // 手动重建：立即返回，后台异步执行，完成后发通知
          sendResponse({ success: true });
          handleRebuildKnowledgeTree();
          break;

        case MessageType.SYNC_FROM_DOWNLOADS:
          // 从下载记录同步文件夹结构（无需 AI，秒完成）
          (async () => {
            try {
              const result = await handleSyncFromDownloads();
              sendResponse({ success: true, data: result });
            } catch (err) {
              sendResponse({ success: false, error: err instanceof Error ? err.message : "同步失败" });
            }
          })();
          break;

        case MessageType.APPLY_KNOWLEDGE_PROPOSAL:
          // 用户确认应用待确认的知识体系提案
          (async () => {
            try {
              const proposal = await getPendingProposal();
              if (!proposal) { sendResponse({ success: true }); return; }
              const snapshot = await getKnowledgeTree();
              const { snapshot: updated } = mergePathsIntoTree(snapshot, proposal.additions);
              await saveKnowledgeTree(updated);
              await clearPendingProposal();
              sendResponse({ success: true, data: updated });
            } catch (err) {
              sendResponse({ success: false, error: err instanceof Error ? err.message : "应用失败" });
            }
          })();
          break;

        case MessageType.DISMISS_KNOWLEDGE_PROPOSAL:
          // 用户忽略提案
          clearPendingProposal().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: true }));
          break;

        case MessageType.DELETE_KNOWLEDGE_FILE:
          // 删除知识体系文件：本地文件 + 历史记录
          (async () => {
            try {
              const { historyId, downloadId } = message.payload as { historyId: string; downloadId?: number };
              const { removeHistoryEntry } = await import("@/lib/storage/history");
              // 1. 删除本地文件
              if (downloadId) {
                try {
                  await browser.downloads.removeFile(downloadId);
                  await browser.downloads.erase({ id: downloadId });
                } catch (e) {
                  console.warn("[AI Web Clipper] removeFile 失败（文件可能已移动）:", e);
                }
              }
              // 2. 删除历史记录
              await removeHistoryEntry(historyId);
              sendResponse({ success: true });
            } catch (err) {
              sendResponse({ success: false, error: err instanceof Error ? err.message : "删除失败" });
            }
          })();
          break;

        default:
          // 处理自定义快捷键执行命令
          if (message.type === "EXECUTE_SHORTCUT_COMMAND") {
            const { commandId } = message.payload as { commandId: string };
            // 复用已有的 commands.onCommand 逻辑
            if (commandId === "trigger-summary") {
              (async () => {
                try {
                  await (browser.action as any).openPopup();
                } catch {
                  browser.tabs.create({
                    url: browser.runtime.getURL("popup.html?source=shortcut"),
                  });
                }
                sendResponse({ success: true });
              })();
            } else if (commandId === "open-sidepanel") {
              (async () => {
                try {
                  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
                  if (tab?.id) {
                    await (chrome.sidePanel as any).open({ tabId: tab.id });
                  }
                  sendResponse({ success: true });
                } catch (err) {
                  console.warn("[AI Web Clipper] Custom shortcut open sidepanel failed:", err);
                  sendResponse({ success: false, error: "打开侧边栏失败" });
                }
              })();
            } else {
              sendResponse({ success: false, error: `未知命令: ${commandId}` });
            }
          } else {
            sendResponse({ success: false, error: "未知消息类型" });
          }
      }

      // 返回 true 表示异步响应
      return true;
    }
  );

  // --------------------------------------------------
  // 右键菜单注册
  // --------------------------------------------------
  browser.contextMenus.create({
    id: "summarize-page",
    title: "页面AI总结",
    contexts: ["page"],
  });

  browser.contextMenus.create({
    id: "summarize-selection",
    title: "用 AI 总结选中内容",
    contexts: ["selection"],
  });

  browser.contextMenus.create({
    id: "open-sidepanel",
    title: "页面AI对话",
    contexts: ["page"],
  });

  browser.contextMenus.onClicked.addListener(
    async (info: browser.ContextMenus.OnClickData, tab?: browser.Tabs.Tab) => {
      if (!tab?.id) return;

      if (info.menuItemId === "open-sidepanel") {
        // 打开 Side Panel
        try {
          await (chrome.sidePanel as any).open({ tabId: tab.id });
        } catch (err) {
          console.warn("[AI Web Clipper] Failed to open side panel:", err);
        }
        return;
      }

      if (info.menuItemId === "summarize-page") {
        // 直接打开 popup（显示模板选择面板），让用户选择模板后再总结
        try {
          try {
            // Chrome 127+ 支持
            await (browser.action as any).openPopup();
          } catch {
            // 降级：在新标签页中打开 popup
            browser.tabs.create({
              url: browser.runtime.getURL("popup.html?source=contextmenu"),
            });
          }
        } catch (err) {
          console.error("[AI Web Clipper] Context menu open popup failed:", err);
        }
      } else if (info.menuItemId === "summarize-selection") {
        if (!info.selectionText) return;

        try {
          // 获取页面元数据
          const extractResponse = await sendMessageToContentScript(
            tab.id,
            MessageType.EXTRACT_SELECTION
          );

          let pageContent: PageContent;
          if (extractResponse.success && extractResponse.data) {
            pageContent = extractResponse.data;
          } else {
            // 降级：使用基础信息
            pageContent = {
              title: tab.title || "无标题",
              content: info.selectionText,
              textContent: info.selectionText,
              excerpt: info.selectionText.slice(0, 200),
              byline: "",
              siteName: "",
              url: tab.url || "",
              faviconUrl: tab.favIconUrl || "",
              publishedTime: "",
              savedAt: new Date().toISOString(),
            };
          }

          const summary = await summarize(info.selectionText);
          const selSettings = await getSettings();

          // 存到 session storage 供 popup 读取
          await chrome.storage.session.set({
            pendingSummary: { summary, pageContent, promptId: selSettings.activePromptId },
          });

          try {
            await (browser.action as any).openPopup();
          } catch {
            browser.tabs.create({
              url: browser.runtime.getURL("popup.html?source=contextmenu"),
            });
          }
        } catch (err) {
          console.error(
            "[AI Web Clipper] Context menu selection summarize failed:",
            err
          );
        }
      }
    }
  );

  // --------------------------------------------------
  // 快捷键监听
  // --------------------------------------------------
  browser.commands.onCommand.addListener(async (command: string) => {
    if (command === "trigger-summary") {
      // 快捷键触发时，直接打开 popup（等效于点击图标）
      try {
        await (browser.action as any).openPopup();
      } catch {
        // 降级：在新标签页中打开
        browser.tabs.create({
          url: browser.runtime.getURL("popup.html?source=shortcut"),
        });
      }
    } else if (command === "open-sidepanel") {
      // 快捷键打开侧边栏对话
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await (chrome.sidePanel as any).open({ tabId: tab.id });
        }
      } catch (err) {
        console.warn("[AI Web Clipper] Failed to open side panel via shortcut:", err);
      }
    }
  });

  console.log("[AI Web Clipper] Background service worker started.");
});

// --------------------------------------------------
// 向 Content Script 发消息（带自动注入重试 + 超时保护）
// --------------------------------------------------

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时 (${Math.round(timeoutMs / 1000)}s)，页面可能未正确加载或内容仍在异步渲染`));
    }, timeoutMs);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function sendMessageToContentScript(
  tabId: number,
  messageType: string = MessageType.EXTRACT_CONTENT
): Promise<MessageResponse<PageContent>> {
  // 整个提取流程（包括 SPA 等待）最多给 30 秒
  const EXTRACT_TIMEOUT = 30_000;

  const doSend = async (): Promise<MessageResponse<PageContent>> => {
    try {
      // 首先尝试直接发消息
      const response = await browser.tabs.sendMessage(tabId, {
        type: messageType,
      });
      return response as MessageResponse<PageContent>;
    } catch (_firstErr) {
      // 如果失败（Receiving end does not exist），动态注入 content script 再重试
      console.log(
        "[AI Web Clipper] Content script not found, injecting dynamically..."
      );

      await browser.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"],
      });

      // 等待 content script 初始化
      await new Promise((r) => setTimeout(r, 500));

      // 重试发消息
      const retryResponse = await browser.tabs.sendMessage(tabId, {
        type: messageType,
      });
      return retryResponse as MessageResponse<PageContent>;
    }
  };

  return withTimeout(doSend(), EXTRACT_TIMEOUT, "内容提取");
}

/**
 * 统一提取入口：先判断是否为 PDF URL，是则走 PDF 提取，否则发消息给 Content Script。
 */
async function extractContentFromTab(tabId: number, tabUrl: string): Promise<PageContent> {
  // PDF URL 直接用 PDF 提取器处理（content script 无法读取 PDF viewer 的内容）
  if (isPdfUrl(tabUrl)) {
    console.log(`[AI Web Clipper] 检测到 PDF URL，使用 PDF 提取器: ${tabUrl}`);
    return await extractPdfContent(tabUrl);
  }

  // 普通页面走 content script
  const extractResponse = await sendMessageToContentScript(tabId);
  if (!extractResponse.success || !extractResponse.data) {
    throw new Error(extractResponse.error || "页面内容提取失败");
  }
  return extractResponse.data;
}

// --------------------------------------------------
// 处理「提取页面内容」（仅提取，不调用 AI）
// --------------------------------------------------
async function handleExtractContent(
  sendResponse: (r: MessageResponse<PageContent>) => void
) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("无法获取当前标签页");

    const tabUrl = tab.url || "";
    if (
      tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("about:") ||
      tabUrl === ""
    ) {
      throw new Error("无法在此页面使用：请切换到一个普通网页再试。");
    }

    const pageContent = await extractContentFromTab(tab.id, tabUrl);
    sendResponse({ success: true, data: pageContent });
  } catch (err) {
    console.error("[AI Web Clipper] Extract content failed:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : "页面内容提取失败",
    });
  }
}

// --------------------------------------------------
// 处理「开始总结」
// --------------------------------------------------
async function handleStartSummary(
  sendResponse: (
    r: MessageResponse<{ summary: SummaryResult; pageContent: PageContent }>
  ) => void,
  options: { promptId?: string; customTags?: string[]; customPrompt?: string } = {}
) {
  try {
    // 先检查是否有右键菜单/快捷键预先准备好的总结结果
    const sessionData = await chrome.storage.session.get("pendingSummary");
    if (sessionData.pendingSummary) {
      const pending = sessionData.pendingSummary as {
        summary: SummaryResult;
        pageContent: PageContent;
        promptId?: string; // 记录生成缓存时使用的模板 ID
      };
      // 清除 pending 数据
      await chrome.storage.session.remove("pendingSummary");

      // 如果用户在 Popup 中选择了不同的模板，需要用新模板重新总结
      // （缓存是用旧模板生成的，不能直接复用）
      if (options.promptId && options.promptId !== pending.promptId) {
        // 复用已提取的页面内容，但用新模板重新调用 AI
        const summary = await summarize(
          pending.pageContent.textContent,
          options.promptId,
          options.customPrompt
        );

        // 合并用户自定义标签
        if (options.customTags && options.customTags.length > 0) {
          summary.tags = [...new Set([...summary.tags, ...options.customTags])];
        }

        sendResponse({ success: true, data: { summary, pageContent: pending.pageContent } });
        return;
      }

      // 模板相同或未指定模板，直接使用缓存结果
      const { summary, pageContent } = pending;

      // 合并用户自定义标签
      if (options.customTags && options.customTags.length > 0) {
        summary.tags = [...new Set([...summary.tags, ...options.customTags])];
      }

      sendResponse({ success: true, data: { summary, pageContent } });
      return;
    }

    // 1. 获取当前活跃标签页
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("无法获取当前标签页");

    // 检查是否是不可注入的特殊页面
    const tabUrl = tab.url || "";
    if (
      tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("about:") ||
      tabUrl === ""
    ) {
      throw new Error(
        "无法在此页面使用：请切换到一个普通网页（如新闻、博客等）再试。"
      );
    }

    // 2. 向 Content Script 发消息提取内容（PDF URL 自动走 PDF 提取）
    const pageContent = await extractContentFromTab(tab.id, tabUrl);

    // 3. 调用 AI 总结（使用指定或默认的 Prompt 模板）
    const summary = await summarize(
      pageContent.textContent,
      options.promptId,
      options.customPrompt
    );

    // 合并用户自定义标签
    if (options.customTags && options.customTags.length > 0) {
      summary.tags = [...new Set([...summary.tags, ...options.customTags])];
    }

    // 4. 返回结果给 Popup
    sendResponse({ success: true, data: { summary, pageContent } });
  } catch (err) {
    console.error("[AI Web Clipper] Summary failed:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : "总结失败",
    });
  }
}

// --------------------------------------------------
// 处理「总结选中内容」（来自消息通信）
// --------------------------------------------------
async function handleStartSummarySelection(
  selectedText: string,
  sendResponse: (
    r: MessageResponse<{ summary: SummaryResult; pageContent: PageContent }>
  ) => void
) {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    const pageContent: PageContent = {
      title: tab?.title || "选中内容",
      content: selectedText,
      textContent: selectedText,
      excerpt: selectedText.slice(0, 200),
      byline: "",
      siteName: "",
      url: tab?.url || "",
      faviconUrl: (tab as any)?.favIconUrl || "",
      publishedTime: "",
      savedAt: new Date().toISOString(),
    };

    const summary = await summarize(selectedText);

    sendResponse({ success: true, data: { summary, pageContent } });
  } catch (err) {
    console.error("[AI Web Clipper] Selection summary failed:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : "选中内容总结失败",
    });
  }
}

// --------------------------------------------------
// 处理「保存文件」
// --------------------------------------------------
async function handleSaveFile(
  payload: { summary: SummaryResult; pageContent: PageContent },
  sendResponse: (r: MessageResponse) => void
) {
  try {
    const { summary, pageContent } = payload;
    const settings = await getSettings();

    // 1. 生成 Markdown 内容
    const markdown = generateMarkdown(summary, pageContent);

    // 2. 将 Markdown 内容编码为 Data URL
    //    MV3 Service Worker 不支持 URL.createObjectURL，改用 Data URL
    const base64Content = btoa(unescape(encodeURIComponent(markdown)));
    const dataUrl = `data:text/markdown;charset=utf-8;base64,${base64Content}`;

    // 3. 构造文件名（去掉日期前缀）
    const baseName = sanitizeFilename(`${pageContent.title}.md`);

    // 4. AI 分类 + 构造保存路径
    const filename = await buildSavePath(summary, pageContent, settings.savePath || "", baseName);

    // 5. 下载文件
    const downloadId = await browser.downloads.download({
      url: dataUrl,
      filename,
      saveAs: settings.saveAs,
    });

    // 6. 写入历史记录
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: pageContent.title,
      url: pageContent.url,
      summary,
      savedAt: pageContent.savedAt,
      downloadId,
      savedPath: filename,
    };
    await addHistoryEntry(entry);

    sendResponse({ success: true });
  } catch (err) {
    console.error("[AI Web Clipper] Save failed:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : "保存失败",
    });
  }
}

// --------------------------------------------------
// 辅助：更新后台任务状态到 session storage
// --------------------------------------------------
async function updateTaskStatus(status: BackgroundTaskStatus) {
  await chrome.storage.session.set({ bgTaskStatus: status });
}

// --------------------------------------------------
// 后台一体化：总结 + 自动保存（不受 Popup 关闭影响）
// --------------------------------------------------
async function handleSummarizeAndSave(
  options: { promptId?: string; customPrompt?: string } = {}
) {
  // MV3 Service Worker keep-alive：每 25 秒做一次 storage 操作保持 SW 活跃
  // Chrome MV3 SW 在 30s 无活动后会被终止
  const keepAliveInterval = setInterval(async () => {
    try {
      await chrome.storage.session.get("bgTaskStatus");
    } catch {}
  }, 25_000);

  try {
    // 1. 提取内容
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("无法获取当前标签页");

    const tabUrl = tab.url || "";
    if (
      tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("about:") ||
      tabUrl === ""
    ) {
      throw new Error("无法在此页面使用：请切换到一个普通网页再试。");
    }

    await updateTaskStatus({ state: "extracting", url: tabUrl, timestamp: Date.now() });
    console.log(`[AI Web Clipper] 开始提取页面内容: ${tabUrl}`);

    let pageContent: PageContent;
    try {
      pageContent = await extractContentFromTab(tab.id, tabUrl);
    } catch (extractErr) {
      const msg = extractErr instanceof Error ? extractErr.message : "内容提取异常";
      console.error("[AI Web Clipper] 内容提取失败:", extractErr);
      throw new Error(`内容提取失败: ${msg}`);
    }

    // 检查提取到的内容是否有效
    if (!pageContent.textContent || pageContent.textContent.trim().length < 50) {
      console.warn(`[AI Web Clipper] 提取到的内容过短: "${pageContent.textContent?.slice(0, 100)}"`);
      throw new Error(
        `页面内容提取异常：仅提取到 ${pageContent.textContent?.trim().length || 0} 个字符。` +
        `该页面可能使用了动态加载、iframe 嵌入或需要特殊权限访问。`
      );
    }

    console.log(`[AI Web Clipper] 内容提取成功: ${pageContent.title} (${pageContent.textContent.length} chars)`);

    // 2. AI 总结
    await updateTaskStatus({ state: "summarizing", url: tabUrl, pageContent, timestamp: Date.now() });
    console.log("[AI Web Clipper] 开始 AI 总结...");

    let summaryResult;
    try {
      summaryResult = await summarize(
        pageContent.textContent,
        options.promptId,
        options.customPrompt
      );
    } catch (aiErr) {
      const msg = aiErr instanceof Error ? aiErr.message : "AI 总结异常";
      console.error("[AI Web Clipper] AI 总结失败:", aiErr);
      throw new Error(`AI 总结失败: ${msg}`);
    }

    console.log(`[AI Web Clipper] AI 总结成功: ${summaryResult.oneLiner}`);

    // 3. 保存文件
    await updateTaskStatus({ state: "saving", url: tabUrl, summary: summaryResult, pageContent, timestamp: Date.now() });

    const settings = await getSettings();
    const markdown = generateMarkdown(summaryResult, pageContent);
    const base64Content = btoa(unescape(encodeURIComponent(markdown)));
    const dataUrl = `data:text/markdown;charset=utf-8;base64,${base64Content}`;
    // 文件名去掉日期前缀
    const baseName = sanitizeFilename(`${pageContent.title}.md`);
    // AI 分类 + 构造保存路径
    const filename = await buildSavePath(summaryResult, pageContent, settings.savePath || "", baseName);

    const downloadId = await browser.downloads.download({
      url: dataUrl,
      filename,
      saveAs: settings.saveAs,
    });

    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: pageContent.title,
      url: pageContent.url,
      summary: summaryResult,
      savedAt: pageContent.savedAt,
      downloadId,
      savedPath: filename,
    };
    await addHistoryEntry(entry);

    // 4. 完成
    await updateTaskStatus({ state: "done", url: tabUrl, summary: summaryResult, pageContent, timestamp: Date.now() });
    console.log("[AI Web Clipper] 后台总结+保存完成");

    chrome.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon/icon.svg"),
      title: "AI Web Clipper",
      message: "总结完成，已自动保存为 Markdown 文件",
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "后台处理失败";
    console.error("[AI Web Clipper] Background summarize+save failed:", err);
    await updateTaskStatus({ state: "error", error: errorMsg, timestamp: Date.now() });

    chrome.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon/icon.svg"),
      title: "AI Web Clipper — 总结失败",
      message: errorMsg.length > 100 ? errorMsg.slice(0, 100) + "..." : errorMsg,
    });
  } finally {
    clearInterval(keepAliveInterval);
  }
}

// --------------------------------------------------
// 处理「多轮对话」
// --------------------------------------------------
async function handleChatMessage(
  payload: {
    messages: ChatMessage[];
    pageContent: string;
    promptId?: string;
  },
  sendResponse: (r: MessageResponse<{ reply: string }>) => void
) {
  try {
    const reply = await chatWithContext(
      payload.messages,
      payload.pageContent,
      payload.promptId
    );
    sendResponse({ success: true, data: { reply } });
  } catch (err) {
    console.error("[AI Web Clipper] Chat message failed:", err);
    sendResponse({
      success: false,
      error: err instanceof Error ? err.message : "对话失败",
    });
  }
}

// --------------------------------------------------
// AI 分类 + 保存路径构造
// --------------------------------------------------

/**
 * 核心辅助：调用 AI 分类，更新/检查知识树，返回最终下载文件路径。
 * 在 handleSaveFile / handleSummarizeAndSave 中复用。
 */
async function buildSavePath(
  summary: SummaryResult,
  pageContent: PageContent,
  baseSavePath: string,
  baseName: string
): Promise<string> {
  const settings = await getSettings();
  const ks = settings.knowledgeSettings ?? { enabled: true, maxDepth: 2, updateMode: "auto" as const };

  // 知识体系未启用：退化到原始逻辑
  if (!ks.enabled) {
    return baseSavePath
      ? `${baseSavePath.replace(/\/+$/, "")}/${baseName}`
      : baseName;
  }

  try {
    const snapshot = await getKnowledgeTree();

    // 1. AI 推断分类路径
    const classPath = await classifyArticle(summary, pageContent, snapshot.roots, ks.maxDepth);

    // 2. 尝试合并进知识树
    const { snapshot: merged, newPaths } = mergePathsIntoTree(snapshot, [classPath]);

    if (newPaths.length > 0) {
      // 有新分类节点
      if (ks.updateMode === "auto") {
        // 自动模式：直接保存新知识树
        await saveKnowledgeTree(merged);
        console.log(`[AI Web Clipper] 知识树自动更新：新增路径 ${newPaths.map(p => p.join(" > ")).join(", ")}`);
      } else {
        // 手动模式：生成提案，通知用户确认
        await checkAndNotifyKnowledgeUpdate(newPaths, pageContent.title);
        // 手动模式下本次仍使用推断出的路径保存（但不入树，等确认）
      }
    }

    // 3. 构造最终文件路径
    const dirPath = buildFilePath(baseSavePath, classPath);
    return `${dirPath}/${baseName}`;
  } catch (err) {
    console.error("[AI Web Clipper] 知识体系分类失败，退化到默认路径:", err);
    // 分类失败时退化
    return baseSavePath
      ? `${baseSavePath.replace(/\/+$/, "")}/${baseName}`
      : baseName;
  }
}

// --------------------------------------------------
// 知识树更新检测 + Chrome 通知
// --------------------------------------------------

/**
 * 生成待确认提案，并通过 Chrome Notification 提醒用户。
 */
async function checkAndNotifyKnowledgeUpdate(
  newPaths: string[][],
  triggerTitle: string
): Promise<void> {
  // 如果已有未确认提案，合并进去
  const existing = await getPendingProposal();
  const merged: KnowledgeUpdateProposal = {
    additions: [
      ...(existing?.additions ?? []),
      ...newPaths,
    ],
    triggerTitle,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await savePendingProposal(merged);

  const pathDesc = newPaths.map((p) => p.join(" > ")).join("、");
  chrome.notifications.create(`knowledge-update-${Date.now()}`, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icon/icon.svg"),
    title: "AI Web Clipper — 知识体系有更新",
    message: `发现新分类「${pathDesc}」，请前往设置页确认是否加入知识体系。`,
    buttons: [{ title: "去确认" }],
  });
}

// --------------------------------------------------
// 手动重建知识体系
// --------------------------------------------------

/**
 * 手动重建知识体系（后台异步执行，不阻塞 UI）。
 * 流程：
 * 1. 对每篇有文件的历史记录重新 AI 分类
 * 2. 若分类路径发生变化，将文件重新下载到新路径（下载到新位置 + 删除旧文件）
 * 3. 更新历史记录的 savedPath
 * 4. 保存新知识树
 */
async function handleRebuildKnowledgeTree(): Promise<void> {
  try {
    const { getHistory, addHistoryEntry, removeHistoryEntry } = await import("@/lib/storage/history");
    const settings = await getSettings();
    const ks = settings.knowledgeSettings ?? { enabled: true, maxDepth: 2, updateMode: "auto" as const };

    const allHistories = await getHistory();
    const histories = allHistories.filter((h) => h.savedPath && h.summary);

    if (!histories.length) {
      chrome.notifications.create(`knowledge-rebuild-${Date.now()}`, {
        type: "basic",
        iconUrl: browser.runtime.getURL("icon/icon.svg"),
        title: "AI Web Clipper — 知识体系重建",
        message: "暂无已保存的文件记录，请先保存一些文章后再重建。",
      });
      return;
    }

    const baseSavePath = settings.savePath || "";
    let snapshot = { roots: [], updatedAt: new Date().toISOString() };
    let movedCount = 0;

    for (const entry of histories) {
      // 1. 重新 AI 分类
      const classPath = await classifyArticle(
        entry.summary,
        { title: entry.title, url: entry.url } as PageContent,
        snapshot.roots,
        ks.maxDepth
      );

      // 2. 合并到知识树
      const { snapshot: merged } = mergePathsIntoTree(snapshot, [classPath]);
      snapshot = merged;

      // 3. 计算新路径
      const baseName = sanitizeFilename(`${entry.title}.md`);
      const newDirPath = buildFilePath(baseSavePath, classPath);
      const newFilePath = `${newDirPath}/${baseName}`;

      // 若路径没变，跳过文件移动
      if (entry.savedPath === newFilePath) continue;

      // 4. 将文件「移动」到新路径（下载到新位置 + 删除旧文件）
      try {
        const { generateMarkdown } = await import("@/lib/markdown/generator");
        const markdown = generateMarkdown(entry.summary, {
          title: entry.title,
          url: entry.url,
          content: "",
          textContent: "",
          excerpt: "",
          byline: "",
          siteName: "",
          faviconUrl: "",
          publishedTime: "",
          savedAt: entry.savedAt,
        } as PageContent);
        const base64Content = btoa(unescape(encodeURIComponent(markdown)));
        const dataUrl = `data:text/markdown;charset=utf-8;base64,${base64Content}`;

        const newDownloadId = await browser.downloads.download({
          url: dataUrl,
          filename: newFilePath,
          saveAs: false,
        });

        // 删除旧文件
        if (entry.downloadId) {
          try {
            await browser.downloads.removeFile(entry.downloadId);
            await browser.downloads.erase({ id: entry.downloadId });
          } catch {
            console.warn(`[Rebuild] 删除旧文件失败 (downloadId=${entry.downloadId})`);
          }
        }

        // 更新历史记录
        await removeHistoryEntry(entry.id);
        await addHistoryEntry({
          ...entry,
          downloadId: newDownloadId,
          savedPath: newFilePath,
        });
        movedCount++;
        console.log(`[Rebuild] 文件已迁移: ${entry.savedPath} → ${newFilePath}`);
      } catch (moveErr) {
        console.error(`[Rebuild] 文件迁移失败 (${entry.title}):`, moveErr);
      }
    }

    // 5. 保存新知识树
    await saveKnowledgeTree(snapshot);
    await clearPendingProposal();

    chrome.notifications.create(`knowledge-rebuild-${Date.now()}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icon/icon.svg"),
      title: "AI Web Clipper — 知识体系重建完成",
      message: `处理 ${histories.length} 篇文章，迁移了 ${movedCount} 个文件，请前往设置页查看。`,
    });

    console.log(`[AI Web Clipper] 知识体系重建完成：${histories.length} 篇，${movedCount} 个文件已迁移`);
  } catch (err) {
    console.error("[AI Web Clipper] 重建知识体系失败:", err);
    chrome.notifications.create(`knowledge-rebuild-err-${Date.now()}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icon/icon.svg"),
      title: "AI Web Clipper — 重建失败",
      message: err instanceof Error ? err.message : "重建知识体系时出错，请重试。",
    });
  }
}

// --------------------------------------------------
// 从下载记录同步文件夹结构（无需 AI）
// --------------------------------------------------

/**
 * 通过 chrome.downloads.search() 查询所有该扩展发起的 .md 文件下载，
 * 从实际文件路径中提取文件夹结构，直接重建知识树和历史记录的 savedPath。
 *
 * 返回新的知识树快照和更新的历史记录列表。
 */
async function handleSyncFromDownloads(): Promise<{
  tree: import("@/lib/types").KnowledgeTreeSnapshot;
  updatedCount: number;
  totalFound: number;
}> {
  const { getHistory, addHistoryEntry, removeHistoryEntry } = await import("@/lib/storage/history");
  const settings = await getSettings();
  const baseSavePath = settings.savePath || "";

  // 1. 查询所有已完成的 .md 下载记录
  const downloads = await browser.downloads.search({
    state: "complete",
    filenameRegex: "\\.md$",
    limit: 2000,
  });

  if (!downloads.length) {
    return { tree: await getKnowledgeTree(), updatedCount: 0, totalFound: 0 };
  }

  // 2. 从文件路径中提取知识树结构
  //    filename 是完整本地路径，如：/Users/xxx/Downloads/AI笔记/AI技术/深度学习/文章.md
  //    需要提取相对于下载目录的路径段
  const roots: import("@/lib/types").KnowledgeNode[] = [];
  const fileMap = new Map<string, typeof downloads[0]>(); // filename → download item

  for (const dl of downloads) {
    if (!dl.filename) continue;
    // 规范化路径分隔符（Windows 用 \，macOS/Linux 用 /）
    const normalized = dl.filename.replace(/\\/g, "/");
    fileMap.set(normalized, dl);

    // 提取相对路径：去掉文件名，取目录部分
    // 例：/Downloads/AI笔记/AI技术/深度学习/文章.md → 目录段 ["AI笔记","AI技术","深度学习"]
    const pathParts = normalized.split("/");
    const fileName = pathParts[pathParts.length - 1];
    if (!fileName.endsWith(".md")) continue;

    // 找到 baseSavePath 在路径中的位置，以此确定分类路径
    let classParts: string[] = [];
    if (baseSavePath) {
      // baseSavePath 可能是多层，如 "AI笔记" 或 "笔记/AI"
      const baseSegments = baseSavePath.split("/").filter(Boolean);
      // 在 pathParts 中找到 baseSavePath 的起始位置
      for (let i = 0; i < pathParts.length - baseSegments.length; i++) {
        if (baseSegments.every((seg, j) => pathParts[i + j] === seg)) {
          // baseSavePath 之后、文件名之前的部分是分类路径
          classParts = pathParts.slice(i + baseSegments.length, pathParts.length - 1);
          break;
        }
      }
    } else {
      // 没有 baseSavePath：取文件名前一级作为分类路径
      // /Downloads/AI技术/深度学习/文章.md → ["AI技术","深度学习"]
      // 假设下载目录是倒数第(classParts+1)层之前
      // 取最后2层目录（文件名之前）作为分类路径
      classParts = pathParts.slice(-3, -1); // 最多取2层
    }

    if (classParts.length > 0) {
      mergePathsIntoTree({ roots, updatedAt: "" }, [classParts]);
      // mergePathsIntoTree 是纯函数，直接操作 roots 引用
      let cur = roots;
      for (const seg of classParts) {
        let node = cur.find((n) => n.name === seg);
        if (!node) { node = { name: seg, children: [] }; cur.push(node); }
        cur = node.children;
      }
    }
  }

  // 3. 更新历史记录的 savedPath，与下载记录对应
  const histories = await getHistory();
  let updatedCount = 0;

  for (const entry of histories) {
    if (!entry.downloadId) continue;
    // 找到对应的下载记录
    const matchedDownloads = downloads.filter((d) => d.id === entry.downloadId);
    if (!matchedDownloads.length) continue;
    const dl = matchedDownloads[0];
    if (!dl.filename) continue;

    // 提取相对于下载根目录的相对路径（Chrome downloads filename 是完整路径）
    // 简单处理：取 baseSavePath 及其之后的部分
    const normalized = dl.filename.replace(/\\/g, "/");
    let relativePath = normalized;

    // 尝试找到下载根目录位置（通常是用户下载目录）
    // 常见下载目录名：Downloads, 下载
    const downloadDirPatterns = ["/Downloads/", "/下载/", "/download/"];
    for (const pattern of downloadDirPatterns) {
      const idx = normalized.indexOf(pattern);
      if (idx !== -1) {
        relativePath = normalized.slice(idx + pattern.length);
        break;
      }
    }

    if (entry.savedPath !== relativePath) {
      await removeHistoryEntry(entry.id);
      await addHistoryEntry({ ...entry, savedPath: relativePath });
      updatedCount++;
    }
  }

  // 4. 保存新知识树
  const newTree = {
    roots,
    updatedAt: new Date().toISOString(),
  };
  await saveKnowledgeTree(newTree);

  console.log(`[SyncFromDownloads] 同步完成：发现 ${downloads.length} 个文件，更新 ${updatedCount} 条记录`);
  return { tree: newTree, updatedCount, totalFound: downloads.length };
}

