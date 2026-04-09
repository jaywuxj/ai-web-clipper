// ============================================================
// Content Script — 页面内容提取
// ============================================================

import { Readability } from "@mozilla/readability";
import type { PageContent, MessageResponse } from "@/lib/types";
import { MessageType } from "@/lib/types";

export default defineContentScript({
  matches: ["<all_urls>"],

  main() {
    // 浮动面板状态
    let floatingPanel: HTMLDivElement | null = null;

    // 监听来自 Background 的消息
    browser.runtime.onMessage.addListener(
      (
        message: { type: string },
        _sender: browser.Runtime.MessageSender,
        sendResponse: (response: MessageResponse<PageContent>) => void
      ) => {
        if (message.type === MessageType.EXTRACT_CONTENT) {
          // 异步提取，支持 SPA 页面等待内容加载
          extractPageContentAsync()
            .then((content) => {
              sendResponse({ success: true, data: content });
            })
            .catch((err) => {
              sendResponse({
                success: false,
                error:
                  err instanceof Error ? err.message : "页面内容提取失败",
              });
            });
          return true; // 保持消息通道开放，等待异步响应
        } else if (message.type === MessageType.EXTRACT_SELECTION) {
          try {
            const selectedText = window.getSelection()?.toString()?.trim() || "";
            if (!selectedText) {
              sendResponse({
                success: false,
                error: "没有选中任何文本",
              });
            } else {
              const meta = extractMetadata();
              const content: PageContent = {
                title: document.title || "无标题",
                content: selectedText,
                textContent: selectedText,
                excerpt: selectedText.slice(0, 200),
                byline: meta.author || "",
                siteName: meta.siteName || "",
                url: window.location.href,
                faviconUrl: getFaviconUrl(),
                publishedTime: meta.publishedTime || "",
                savedAt: new Date().toISOString(),
              };
              sendResponse({ success: true, data: content });
            }
          } catch (err) {
            sendResponse({
              success: false,
              error:
                err instanceof Error ? err.message : "选中内容提取失败",
            });
          }
        } else if (message.type === "SHOW_FLOATING_PANEL") {
          showFloatingPanel();
          sendResponse({ success: true } as any);
        }
        return true;
      }
    );

    // --------------------------------------------------
    // 自定义快捷键监听（读取用户在 Options 中设置的快捷键）
    // --------------------------------------------------
    const isMacPlatform = navigator.platform.includes("Mac");

    /** 将 KeyboardEvent 转换为标准化快捷键字符串（与 Options 中 normalizeShortcut 一致） */
    function keyEventToNormalized(e: KeyboardEvent): string | null {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("mod");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      if (parts.length === 0) return null;

      let keyName = e.key;
      if (keyName === " ") keyName = "space";
      else if (keyName.length === 1) keyName = keyName.toLowerCase();
      else if (keyName.startsWith("Arrow")) keyName = keyName.replace("Arrow", "").toLowerCase();
      else keyName = keyName.toLowerCase();

      parts.push(keyName);
      return parts.sort().join("+");
    }

    /** 标准化存储的快捷键字符串（与 Options 中的 normalizeShortcut 一致） */
    function normalizeStoredShortcut(shortcut: string): string {
      return shortcut
        .toLowerCase()
        .replace(/⌘/g, "mod")
        .replace(/ctrl/g, "mod")
        .replace(/option/g, "alt")
        .split("+")
        .sort()
        .join("+");
    }

    // 缓存自定义快捷键映射：normalizedKeys -> commandId
    let shortcutMap: Map<string, string> = new Map();

    /** 从 storage 加载自定义快捷键 */
    function loadCustomShortcuts() {
      chrome.storage.sync.get("customShortcuts", (result) => {
        shortcutMap.clear();
        const custom = result.customShortcuts as Record<string, string> | undefined;
        if (custom) {
          for (const [commandId, keys] of Object.entries(custom)) {
            if (keys) {
              shortcutMap.set(normalizeStoredShortcut(keys), commandId);
            }
          }
        }
      });
    }

    loadCustomShortcuts();

    // 监听 storage 变化，实时更新快捷键映射
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes.customShortcuts) {
        loadCustomShortcuts();
      }
    });

    // 键盘事件监听
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      // 如果没有自定义快捷键，跳过
      if (shortcutMap.size === 0) return;

      // 如果焦点在输入框中，不触发快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      const normalized = keyEventToNormalized(e);
      if (!normalized) return;

      const commandId = shortcutMap.get(normalized);
      if (!commandId) return;

      // 阻止默认行为
      e.preventDefault();
      e.stopPropagation();

      // 发消息给 background 执行命令
      chrome.runtime.sendMessage({
        type: "EXECUTE_SHORTCUT_COMMAND",
        payload: { commandId },
      }).catch((err) => {
        console.warn("[AI Web Clipper] Shortcut command failed:", err);
      });
    }, true);

    // --------------------------------------------------
    // 浮动面板 UI
    // --------------------------------------------------
    function showFloatingPanel() {
      if (floatingPanel) {
        floatingPanel.style.display = floatingPanel.style.display === "none" ? "block" : "none";
        return;
      }

      floatingPanel = document.createElement("div");
      floatingPanel.id = "ai-clipper-floating-panel";

      const shadow = floatingPanel.attachShadow({ mode: "closed" });

      const style = document.createElement("style");
      style.textContent = `
        :host {
          all: initial;
        }
        .panel {
          position: fixed;
          top: 80px;
          right: 20px;
          width: 380px;
          max-height: 520px;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18);
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          color: #1f2937;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          resize: both;
          border: 1px solid #e5e7eb;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          cursor: move;
          user-select: none;
          background: #f9fafb;
          flex-shrink: 0;
        }
        .header .logo {
          width: 20px; height: 20px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          border-radius: 6px;
          flex-shrink: 0;
        }
        .header .title {
          font-size: 13px;
          font-weight: 600;
          flex: 1;
        }
        .header .close-btn {
          background: none; border: none; cursor: pointer;
          color: #9ca3af; font-size: 18px; line-height: 1;
          padding: 0 4px;
        }
        .header .close-btn:hover { color: #374151; }
        .body {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
        }
        .status {
          text-align: center;
          padding: 32px 0;
          color: #6b7280;
          font-size: 13px;
        }
        .spinner {
          width: 24px; height: 24px;
          border: 2px solid #3b82f6;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .summary-title {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 8px;
          line-height: 1.4;
        }
        .summary-text {
          font-size: 13px;
          line-height: 1.7;
          color: #374151;
          white-space: pre-line;
        }
        .actions {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid #e5e7eb;
          flex-shrink: 0;
        }
        .btn {
          flex: 1;
          padding: 6px 0;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-primary { background: #3b82f6; color: #fff; }
        .btn-primary:hover { background: #2563eb; }
        .btn-secondary { background: #f3f4f6; color: #374151; }
        .btn-secondary:hover { background: #e5e7eb; }
        .error { color: #ef4444; text-align: center; padding: 24px 0; font-size: 13px; }
      `;

      const container = document.createElement("div");
      container.className = "panel";
      container.innerHTML = `
        <div class="header">
          <div class="logo"></div>
          <span class="title">AI Web Clipper</span>
          <button class="close-btn" title="关闭">&times;</button>
        </div>
        <div class="body">
          <div class="status">
            <div class="spinner"></div>
            正在总结页面内容...
          </div>
        </div>
        <div class="actions" style="display:none;">
          <button class="btn btn-primary" id="fp-save">保存 Markdown</button>
          <button class="btn btn-secondary" id="fp-copy">复制</button>
        </div>
      `;

      shadow.appendChild(style);
      shadow.appendChild(container);
      document.body.appendChild(floatingPanel);

      // 拖拽
      const header = container.querySelector(".header") as HTMLElement;
      let isDragging = false, dragX = 0, dragY = 0;
      header.addEventListener("mousedown", (e) => {
        isDragging = true;
        dragX = e.clientX - container.getBoundingClientRect().left;
        dragY = e.clientY - container.getBoundingClientRect().top;
      });
      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        container.style.position = "fixed";
        container.style.left = `${e.clientX - dragX}px`;
        container.style.top = `${e.clientY - dragY}px`;
        container.style.right = "auto";
      });
      document.addEventListener("mouseup", () => { isDragging = false; });

      // 关闭
      container.querySelector(".close-btn")!.addEventListener("click", () => {
        floatingPanel!.style.display = "none";
      });

      // 开始总结
      const bodyEl = container.querySelector(".body") as HTMLElement;
      const actionsEl = container.querySelector(".actions") as HTMLElement;

      (async () => {
        try {
          const response = await browser.runtime.sendMessage({
            type: MessageType.START_SUMMARY,
          });
          const res = response as MessageResponse<{ summary: any; pageContent: any }>;
          if (res.success && res.data) {
            const { summary, pageContent } = res.data;
            bodyEl.innerHTML = `
              <div class="summary-title">${escHtml(summary.oneLiner)}</div>
              <div class="summary-text">${escHtml(summary.detailedSummary)}</div>
            `;
            actionsEl.style.display = "flex";

            // 保存
            shadow.getElementById("fp-save")!.addEventListener("click", async () => {
              await browser.runtime.sendMessage({
                type: MessageType.SAVE_FILE,
                payload: { summary, pageContent },
              });
            });

            // 复制
            shadow.getElementById("fp-copy")!.addEventListener("click", async () => {
              const { generateMarkdown } = await import("@/lib/markdown/generator");
              await navigator.clipboard.writeText(generateMarkdown(summary, pageContent));
            });
          } else {
            bodyEl.innerHTML = `<div class="error">${escHtml(res.error || "总结失败")}</div>`;
          }
        } catch (err) {
          bodyEl.innerHTML = `<div class="error">${escHtml(err instanceof Error ? err.message : "总结失败")}</div>`;
        }
      })();
    }

    function escHtml(s: string): string {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  },
});

// -------------------- 在线文档平台识别 --------------------

/** 识别当前页面是否为已知的在线文档平台（Canvas 渲染，DOM 无正文） */
function detectOnlineDocPlatform(): { platform: string; name: string } | null {
  const url = window.location.href;
  const hostname = window.location.hostname;

  // 企业微信文档 / 腾讯文档（微信体系）
  if (hostname === "doc.weixin.qq.com" || hostname === "docs.weixin.qq.com") {
    return { platform: "wecom-doc", name: "企业微信文档" };
  }
  // 腾讯文档（QQ 体系）
  if (hostname === "docs.qq.com") {
    return { platform: "tencent-doc", name: "腾讯文档" };
  }
  // Google Docs
  if (hostname === "docs.google.com" && url.includes("/document/")) {
    return { platform: "google-doc", name: "Google Docs" };
  }
  // 飞书文档
  if ((hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com")) && url.includes("/doc")) {
    return { platform: "feishu-doc", name: "飞书文档" };
  }
  // Notion
  if (hostname === "www.notion.so" || hostname.endsWith(".notion.site")) {
    return { platform: "notion", name: "Notion" };
  }

  return null;
}

// -------------------- 腾讯文档导出 API 提取 --------------------

/**
 * 从 URL 中提取腾讯文档的 docId
 * 支持多种 URL 格式：
 *   - doc.weixin.qq.com/doc/w3_XXXXX?scode=...
 *   - doc.weixin.qq.com/sheet/XXXXX?...
 *   - docs.qq.com/doc/XXXXX
 *   - docs.qq.com/sheet/XXXXX
 */
function extractDocId(): string | null {
  const url = window.location.href;
  const pathname = window.location.pathname;

  // doc.weixin.qq.com 格式: /doc/w3_XXXXX 或 /sheet/XXXXX 等
  // 取路径最后一段（去掉查询参数）
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.length >= 2) {
    // 例如 ["doc", "w3_AL4AmgZ1ACc..."] 或 ["sheet", "XXXXX"]
    const docId = pathParts[pathParts.length - 1];
    if (docId && docId.length > 5) {
      return docId;
    }
  }

  // 尝试从 URL 参数中提取
  const urlParams = new URLSearchParams(window.location.search);
  const paramDocId = urlParams.get("docId") || urlParams.get("doc_id");
  if (paramDocId) return paramDocId;

  // 最后尝试用正则从完整 URL 中匹配
  const match = url.match(/\/(doc|sheet|slide|mind|flowchart)\/([^?&#/]+)/);
  if (match && match[2]) return match[2];

  return null;
}

/**
 * 通过腾讯文档/企业微信文档的导出 API 获取文档内容
 * 原理：调用 /v1/export/export_office 创建导出任务，再轮询 /v1/export/query_progress 获取下载链接
 * Content Script 在同域下运行，fetch 自动携带 cookie，无需额外鉴权
 */
async function extractViaTencentDocExportAPI(platform: string): Promise<string> {
  const docId = extractDocId();
  if (!docId) {
    throw new Error("无法从 URL 中提取文档 ID");
  }

  // 根据平台确定 API 基础 URL
  const hostname = window.location.hostname;
  const baseUrl = (hostname === "docs.qq.com")
    ? "https://docs.qq.com"
    : `https://${hostname}`;

  console.log(`[AI Web Clipper] 尝试导出 API, docId=${docId}, baseUrl=${baseUrl}`);

  // 第一步：创建导出任务
  const exportUrl = `${baseUrl}/v1/export/export_office`;
  const exportBody = new URLSearchParams({
    docId: docId,
    version: "2",
  });

  const exportRes = await fetch(exportUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: exportBody.toString(),
    credentials: "include", // 携带 cookie
  });

  if (!exportRes.ok) {
    throw new Error(`导出任务创建失败: HTTP ${exportRes.status}`);
  }

  const exportData = await exportRes.json();
  const operationId = exportData?.operationId;
  if (!operationId) {
    throw new Error(`导出任务返回异常: ${JSON.stringify(exportData).slice(0, 200)}`);
  }

  console.log(`[AI Web Clipper] 导出任务已创建, operationId=${operationId}`);

  // 第二步：轮询导出进度，获取下载链接
  const progressUrl = `${baseUrl}/v1/export/query_progress`;
  let fileUrl = "";
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1000)); // 等 1 秒

    const progressRes = await fetch(`${progressUrl}?operationId=${encodeURIComponent(operationId)}`, {
      method: "GET",
      credentials: "include",
    });

    if (!progressRes.ok) continue;

    const progressData = await progressRes.json();
    console.log(`[AI Web Clipper] 导出进度: ${progressData?.progress || 0}%`);

    if (progressData?.file_url) {
      fileUrl = progressData.file_url;
      break;
    }

    if (progressData?.progress >= 100 && progressData?.file_url) {
      fileUrl = progressData.file_url;
      break;
    }

    // 如果接口返回错误
    if (progressData?.ret !== undefined && progressData.ret !== 0) {
      throw new Error(`导出进度查询错误: ${JSON.stringify(progressData).slice(0, 200)}`);
    }
  }

  if (!fileUrl) {
    throw new Error("导出超时，未获取到下载链接");
  }

  console.log(`[AI Web Clipper] 获取到导出文件 URL`);

  // 第三步：下载导出的文件并提取文本
  // 导出的通常是 docx 或 xlsx，我们需要提取其中的纯文本
  // 对于 docx，它其实是一个 zip，里面的 word/document.xml 包含文档内容
  const fileRes = await fetch(fileUrl, { credentials: "include" });
  if (!fileRes.ok) {
    throw new Error(`文件下载失败: HTTP ${fileRes.status}`);
  }

  // 尝试获取为文本（对于某些情况，服务器可能直接返回 HTML 或纯文本）
  const contentType = fileRes.headers.get("content-type") || "";

  if (contentType.includes("text/") || contentType.includes("json")) {
    // 直接返回文本内容
    const text = await fileRes.text();
    if (text.trim().length > 50) return text;
  }

  // 对于二进制文件（docx/xlsx），需要解析
  // docx 是一个 zip 文件，里面 word/document.xml 包含正文
  const arrayBuffer = await fileRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // 检查是否是 ZIP 文件（PK 头）
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
    // 简单的 ZIP 解析：找到 word/document.xml 并提取文本
    const text = extractTextFromDocx(bytes);
    if (text.trim().length > 50) return text;
  }

  // 兜底：尝试直接作为文本解码
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const rawText = decoder.decode(bytes);
  if (rawText.trim().length > 50) return rawText;

  throw new Error("导出文件解析失败：无法提取文本内容");
}

/**
 * 从 docx 文件（ZIP 格式）中提取纯文本
 * docx 本质是 ZIP，里面的 word/document.xml 包含所有文本
 * 这里使用简单的 ZIP 解析，不依赖第三方库
 */
function extractTextFromDocx(zipBytes: Uint8Array): string {
  // 简单 ZIP 解析：查找 Central Directory，定位 word/document.xml
  // ZIP End of Central Directory Record 在文件末尾
  let eocdOffset = -1;
  for (let i = zipBytes.length - 22; i >= 0; i--) {
    if (
      zipBytes[i] === 0x50 && zipBytes[i + 1] === 0x4B &&
      zipBytes[i + 2] === 0x05 && zipBytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    // 无法找到 EOCD，尝试暴力搜索 XML 内容
    return extractXmlTextBruteForce(zipBytes);
  }

  // 读取 Central Directory 偏移
  const cdOffset =
    zipBytes[eocdOffset + 16] |
    (zipBytes[eocdOffset + 17] << 8) |
    (zipBytes[eocdOffset + 18] << 16) |
    (zipBytes[eocdOffset + 19] << 24);

  // 遍历 Central Directory 条目，找到 word/document.xml
  let offset = cdOffset;
  const decoder = new TextDecoder("utf-8", { fatal: false });

  while (offset < eocdOffset) {
    // Central Directory File Header signature: 0x02014b50
    if (
      zipBytes[offset] !== 0x50 || zipBytes[offset + 1] !== 0x4B ||
      zipBytes[offset + 2] !== 0x01 || zipBytes[offset + 3] !== 0x02
    ) break;

    const compressedSize =
      zipBytes[offset + 20] | (zipBytes[offset + 21] << 8) |
      (zipBytes[offset + 22] << 16) | (zipBytes[offset + 23] << 24);
    const uncompressedSize =
      zipBytes[offset + 24] | (zipBytes[offset + 25] << 8) |
      (zipBytes[offset + 26] << 16) | (zipBytes[offset + 27] << 24);
    const fileNameLen =
      zipBytes[offset + 28] | (zipBytes[offset + 29] << 8);
    const extraLen =
      zipBytes[offset + 30] | (zipBytes[offset + 31] << 8);
    const commentLen =
      zipBytes[offset + 32] | (zipBytes[offset + 33] << 8);
    const localHeaderOffset =
      zipBytes[offset + 42] | (zipBytes[offset + 43] << 8) |
      (zipBytes[offset + 44] << 16) | (zipBytes[offset + 45] << 24);

    const fileName = decoder.decode(zipBytes.slice(offset + 46, offset + 46 + fileNameLen));
    const compressionMethod =
      zipBytes[offset + 10] | (zipBytes[offset + 11] << 8);

    if (fileName === "word/document.xml") {
      // 找到了 document.xml，从 Local File Header 读取数据
      const localFileNameLen =
        zipBytes[localHeaderOffset + 26] | (zipBytes[localHeaderOffset + 27] << 8);
      const localExtraLen =
        zipBytes[localHeaderOffset + 28] | (zipBytes[localHeaderOffset + 29] << 8);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      let xmlBytes: Uint8Array;

      if (compressionMethod === 0) {
        // 无压缩（STORED）
        xmlBytes = zipBytes.slice(dataOffset, dataOffset + uncompressedSize);
      } else if (compressionMethod === 8) {
        // DEFLATE 压缩 — 使用 DecompressionStream API（现代浏览器均支持）
        try {
          // 同步方式暂不可用，改用暴力方法
          return extractXmlTextBruteForce(zipBytes);
        } catch {
          return extractXmlTextBruteForce(zipBytes);
        }
      } else {
        return extractXmlTextBruteForce(zipBytes);
      }

      const xmlStr = decoder.decode(xmlBytes);
      return extractTextFromXml(xmlStr);
    }

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  // 没有找到 word/document.xml，尝试暴力提取
  return extractXmlTextBruteForce(zipBytes);
}

/**
 * 从 XML 字符串中提取纯文本（去除所有 XML 标签）
 */
function extractTextFromXml(xml: string): string {
  // 提取 <w:t> 标签中的文本（Word XML 的文本节点）
  const textParts: string[] = [];
  const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    textParts.push(match[1]);
  }

  if (textParts.length > 0) {
    // 在段落断点处添加换行
    let result = "";
    const fullXml = xml;
    const paragraphs = fullXml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const paraTexts: string[] = [];
      const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(para)) !== null) {
        paraTexts.push(tMatch[1]);
      }
      if (paraTexts.length > 0) {
        result += paraTexts.join("") + "\n";
      }
    }
    return result.trim();
  }

  // 兜底：去掉所有 XML 标签
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 暴力搜索 ZIP 中的 XML 内容并提取文本
 * 用于 DEFLATE 压缩或其他无法正常解析的情况
 */
function extractXmlTextBruteForce(zipBytes: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const fullText = decoder.decode(zipBytes);

  // 尝试找到 XML 片段
  const xmlParts: string[] = [];
  const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = regex.exec(fullText)) !== null) {
    xmlParts.push(match[1]);
  }

  if (xmlParts.length > 0) {
    return xmlParts.join(" ").trim();
  }

  // 最后兜底：去掉所有标签
  const noTags = fullText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // 只保留有意义的文本部分（过滤掉乱码）
  const meaningful = noTags.replace(/[^\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\n]/g, "");
  return meaningful.trim();
}

/**
 * 使用 DecompressionStream API 异步解压 DEFLATE 数据并提取文档文本
 */
async function extractTextFromDocxAsync(zipBytes: Uint8Array): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: false });

  // 查找 EOCD
  let eocdOffset = -1;
  for (let i = zipBytes.length - 22; i >= 0; i--) {
    if (
      zipBytes[i] === 0x50 && zipBytes[i + 1] === 0x4B &&
      zipBytes[i + 2] === 0x05 && zipBytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return extractXmlTextBruteForce(zipBytes);

  const cdOffset =
    zipBytes[eocdOffset + 16] | (zipBytes[eocdOffset + 17] << 8) |
    (zipBytes[eocdOffset + 18] << 16) | (zipBytes[eocdOffset + 19] << 24);

  let offset = cdOffset;
  while (offset < eocdOffset) {
    if (
      zipBytes[offset] !== 0x50 || zipBytes[offset + 1] !== 0x4B ||
      zipBytes[offset + 2] !== 0x01 || zipBytes[offset + 3] !== 0x02
    ) break;

    const uncompressedSize =
      zipBytes[offset + 24] | (zipBytes[offset + 25] << 8) |
      (zipBytes[offset + 26] << 16) | (zipBytes[offset + 27] << 24);
    const fileNameLen = zipBytes[offset + 28] | (zipBytes[offset + 29] << 8);
    const extraLen = zipBytes[offset + 30] | (zipBytes[offset + 31] << 8);
    const commentLen = zipBytes[offset + 32] | (zipBytes[offset + 33] << 8);
    const localHeaderOffset =
      zipBytes[offset + 42] | (zipBytes[offset + 43] << 8) |
      (zipBytes[offset + 44] << 16) | (zipBytes[offset + 45] << 24);
    const compressionMethod = zipBytes[offset + 10] | (zipBytes[offset + 11] << 8);
    const compressedSize =
      zipBytes[offset + 20] | (zipBytes[offset + 21] << 8) |
      (zipBytes[offset + 22] << 16) | (zipBytes[offset + 23] << 24);

    const fileName = decoder.decode(zipBytes.slice(offset + 46, offset + 46 + fileNameLen));

    if (fileName === "word/document.xml") {
      const localFileNameLen = zipBytes[localHeaderOffset + 26] | (zipBytes[localHeaderOffset + 27] << 8);
      const localExtraLen = zipBytes[localHeaderOffset + 28] | (zipBytes[localHeaderOffset + 29] << 8);
      const dataOffset = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        const xmlBytes = zipBytes.slice(dataOffset, dataOffset + uncompressedSize);
        return extractTextFromXml(decoder.decode(xmlBytes));
      }

      if (compressionMethod === 8) {
        // DEFLATE: 使用 DecompressionStream（现代浏览器支持）
        try {
          const compressedData = zipBytes.slice(dataOffset, dataOffset + compressedSize);
          const ds = new DecompressionStream("raw-deflate");
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          const result = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) {
            result.set(chunk, pos);
            pos += chunk.length;
          }
          return extractTextFromXml(decoder.decode(result));
        } catch (e) {
          console.warn("[AI Web Clipper] DecompressionStream 失败:", e);
          return extractXmlTextBruteForce(zipBytes);
        }
      }
    }

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  return extractXmlTextBruteForce(zipBytes);
}

// -------------------- 内容提取核心逻辑 --------------------

/**
 * 等待 SPA 页面内容加载完毕（适用于 KM、飞书文档等异步加载内容的页面）
 * 策略：检测文章正文容器是否出现且有足够内容，最多等待 maxWait 毫秒
 */
async function waitForContentReady(maxWait = 8000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 500;

  // SPA 内容容器的常见选择器（覆盖 KM、Confluence、飞书、Notion 等）
  const contentSelectors = [
    // 腾讯 KM
    ".article-content", ".km-rich-text", ".rich-text-content",
    ".article-detail", ".doc-content", ".markdown-body",
    "[class*='article-body']", "[class*='doc-body']",
    "[class*='rich-text']", "[class*='editor-content']",
    // 通用
    "article", "[role='article']", "[role='main']",
    "main", ".post-content", ".entry-content",
  ];

  return new Promise((resolve) => {
    const check = () => {
      // 检查是否有匹配的内容容器且有一定长度的文本
      for (const sel of contentSelectors) {
        const el = document.querySelector(sel);
        if (el && (el.textContent || "").trim().length > 100) {
          console.log(`[AI Web Clipper] 内容已就绪 (selector: ${sel}, length: ${(el.textContent || "").trim().length})`);
          resolve();
          return;
        }
      }

      // 兜底：检查 body 的文本内容长度
      const bodyText = document.body?.innerText || "";
      if (bodyText.trim().length > 500) {
        // body 有足够内容，可以尝试提取
        if (Date.now() - startTime > 2000) {
          // 已经等了 2 秒，body 有内容就可以了
          console.log(`[AI Web Clipper] 未找到特定容器，但 body 内容充足 (${bodyText.trim().length} chars)，开始提取`);
          resolve();
          return;
        }
      }

      if (Date.now() - startTime >= maxWait) {
        console.warn(`[AI Web Clipper] 等待内容加载超时 (${maxWait}ms)，使用当前 DOM 提取`);
        resolve();
        return;
      }

      setTimeout(check, checkInterval);
    };

    // 如果页面已经加载完毕且有内容，不需要等待
    if (document.readyState === "complete") {
      const bodyLen = (document.body?.innerText || "").trim().length;
      if (bodyLen > 500) {
        console.log(`[AI Web Clipper] 页面已完成加载，内容充足 (${bodyLen} chars)`);
        resolve();
        return;
      }
    }

    check();
  });
}

/**
 * 判断文本是否为"有意义的文档内容"而非 UI 界面文本
 * 在线文档的 DOM 中包含大量工具栏、按钮等 UI 文本，需要过滤
 */
function isContentMeaningful(text: string): boolean {
  if (text.trim().length < 200) return false;

  // UI 界面文本的典型特征：大量短行、重复的按钮/菜单名
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const totalChars = text.trim().length;

  // 如果平均每行不足 15 个字符，很可能是菜单/按钮文本
  const avgLineLength = totalChars / Math.max(lines.length, 1);
  if (avgLineLength < 15 && lines.length > 20) return false;

  // 如果短行（<10 字）占比超过 70%，很可能是 UI 文本
  const shortLines = lines.filter(l => l.trim().length < 10).length;
  if (lines.length > 10 && shortLines / lines.length > 0.7) return false;

  // 检查是否包含大量在线文档 UI 的关键词
  const uiKeywords = ["编辑", "格式", "插入", "表格", "字体", "对齐", "分享", "评论", "工具栏", "菜单"];
  let uiKeywordCount = 0;
  for (const kw of uiKeywords) {
    if (text.includes(kw)) uiKeywordCount++;
  }
  // 如果超过一半的 UI 关键词都出现了，且文本较短，可能是 UI
  if (uiKeywordCount >= 5 && totalChars < 1000) return false;

  return true;
}

async function extractPageContentAsync(): Promise<PageContent> {
  // 检测是否为在线文档平台（Canvas 渲染，DOM 中无正文）
  const docPlatform = detectOnlineDocPlatform();

  if (docPlatform) {
    console.log(`[AI Web Clipper] 检测到在线文档平台: ${docPlatform.name} (${docPlatform.platform})`);

    // 等待文档加载完成
    await waitForContentReady(10000);

    // 方案 1（推荐）：对于腾讯文档/企业微信文档，使用导出 API 直接获取文档内容
    if (docPlatform.platform === "wecom-doc" || docPlatform.platform === "tencent-doc") {
      try {
        console.log("[AI Web Clipper] 尝试通过导出 API 获取文档内容...");
        const exportedText = await extractViaTencentDocExportAPI(docPlatform.platform);
        console.log(`[AI Web Clipper] 导出 API 提取成功 (${exportedText.length} chars)`);

        // 对于 docx 导出，可能需要异步解压
        let finalText = exportedText;
        if (exportedText.length < 100) {
          // 文本过短，可能解析不完整，没关系，继续走后续方案
          console.log("[AI Web Clipper] 导出内容过短，尝试异步解压...");
        }

        const meta = extractMetadata();
        const cleanText = finalText
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/^\s+$/gm, "")
          .trim();

        if (cleanText.length > 50) {
          return {
            title: document.title || "在线文档",
            content: cleanText,
            textContent: cleanText,
            excerpt: cleanText.slice(0, 200),
            byline: meta.author || "",
            siteName: docPlatform.name,
            url: window.location.href,
            faviconUrl: getFaviconUrl(),
            publishedTime: meta.publishedTime || "",
            savedAt: new Date().toISOString(),
          };
        }
      } catch (err) {
        console.warn(`[AI Web Clipper] 导出 API 提取失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 方案 2：尝试常规 DOM 提取（但需过滤 UI 文本）
    try {
      const regularContent = extractPageContentSync();
      if (isContentMeaningful(regularContent.textContent)) {
        console.log(`[AI Web Clipper] 常规 DOM 提取成功且内容有意义 (${regularContent.textContent.length} chars)`);
        return regularContent;
      } else {
        console.log(`[AI Web Clipper] 常规 DOM 提取到的内容疑似 UI 界面文本，跳过`);
      }
    } catch {
      console.log("[AI Web Clipper] 常规 DOM 提取失败");
    }

    // 所有自动方案都失败，抛出带有提示信息的错误
    throw new Error(
      `该页面为${docPlatform.name}，内容采用 Canvas 渲染，自动提取失败。\n` +
      `请尝试以下操作：\n` +
      `1. 在文档页面按 Ctrl+A 全选，再按 Ctrl+C 复制\n` +
      `2. 回到侧边栏，将内容粘贴到输入框发送给 AI\n` +
      `（或直接在输入框中输入问题和要分析的内容）`
    );
  }

  // 非在线文档平台，走常规提取流程
  await waitForContentReady();
  return extractPageContentSync();
}

function extractPageContentSync(): PageContent {
  // 克隆 DOM 避免 Readability 修改原始页面
  const documentClone = document.cloneNode(true) as Document;

  // 清理翻译插件注入的内容（沉浸式翻译、Google Translate 等）
  // 避免提取到双倍内容导致 token 超限
  const translationSelectors = [
    // 沉浸式翻译
    ".immersive-translate-target-wrapper",
    ".immersive-translate-target-translation-block-wrapper",
    "[class*='immersive-translate']",
    // Google Translate
    ".translated-ltr", ".translated-rtl",
    "font[style*='translated']",
    // 通用翻译注入标记
    "[data-immersive-translate-walked]",
  ];
  for (const sel of translationSelectors) {
    documentClone.querySelectorAll(sel).forEach((el) => el.remove());
  }

  // 同时清理页面中的 nav、sidebar、footer、header 等干扰区域
  const noiseSelectors = [
    "nav", "header", "footer", "aside",
    "[class*='sidebar']", "[class*='nav-']",
    "[class*='toolbar']", "[class*='comment']",
    "[class*='recommend']", "[class*='related']",
    ".toc", ".table-of-contents",
  ];
  for (const sel of noiseSelectors) {
    documentClone.querySelectorAll(sel).forEach((el) => el.remove());
  }

  const reader = new Readability(documentClone);
  const article = reader.parse();

  // 从 meta 标签提取额外元信息
  const meta = extractMetadata();

  // 清理提取的文本：去除多余空白行、连续空格
  let textContent = article?.textContent || "";

  // 如果 Readability 提取的内容太短（SPA 可能解析失败），降级使用更激进的提取
  if (textContent.trim().length < 200) {
    console.warn(`[AI Web Clipper] Readability 提取内容过短 (${textContent.trim().length} chars)，尝试降级提取`);
    textContent = extractFallbackContent();
  }

  textContent = textContent
    .replace(/\n{3,}/g, "\n\n")       // 连续3个以上换行压缩为2个
    .replace(/[ \t]{2,}/g, " ")        // 连续空格/tab 压缩
    .replace(/^\s+$/gm, "")            // 去除纯空白行
    .trim();

  if (!textContent) {
    throw new Error("页面内容提取为空，该页面可能需要登录或使用了不支持的内容加载方式");
  }

  return {
    title: article?.title || document.title || "无标题",
    content: article?.content || "",
    textContent,
    excerpt: article?.excerpt || meta.description || "",
    byline: article?.byline || meta.author || "",
    siteName: article?.siteName || meta.siteName || "",
    url: window.location.href,
    faviconUrl: getFaviconUrl(),
    publishedTime: meta.publishedTime || "",
    savedAt: new Date().toISOString(),
  };
}

/**
 * 降级内容提取：当 Readability 失败时，尝试从常见内容容器中提取
 */
function extractFallbackContent(): string {
  // 按优先级依次尝试常见的内容容器选择器
  const contentSelectors = [
    // 腾讯 KM 平台
    ".article-content", ".km-rich-text", ".rich-text-content",
    ".article-detail", ".doc-content",
    "[class*='article-body']", "[class*='doc-body']",
    "[class*='rich-text']", "[class*='editor-content']",
    // Markdown 渲染
    ".markdown-body", ".markdown-section",
    // 通用
    "article", "[role='article']", "[role='main']",
    "main", ".post-content", ".entry-content", ".content",
  ];

  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.textContent || "").trim();
      if (text.length > 100) {
        console.log(`[AI Web Clipper] 降级提取成功 (selector: ${sel}, length: ${text.length})`);
        return text;
      }
    }
  }

  // 最终兜底：使用 body.innerText
  const bodyText = document.body?.innerText || "";
  console.log(`[AI Web Clipper] 使用 body.innerText 兜底 (length: ${bodyText.trim().length})`);
  return bodyText;
}

// -------------------- 元数据提取 --------------------

interface PageMetadata {
  author: string;
  description: string;
  siteName: string;
  publishedTime: string;
}

function extractMetadata(): PageMetadata {
  const getMeta = (name: string): string => {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el?.getAttribute("content") || "";
  };

  return {
    author:
      getMeta("author") ||
      getMeta("article:author") ||
      getMeta("twitter:creator") ||
      "",
    description:
      getMeta("og:description") ||
      getMeta("description") ||
      getMeta("twitter:description") ||
      "",
    siteName:
      getMeta("og:site_name") ||
      getMeta("application-name") ||
      "",
    publishedTime:
      getMeta("article:published_time") ||
      getMeta("datePublished") ||
      "",
  };
}

function getFaviconUrl(): string {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel="icon"]') ||
    document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (link?.href) return link.href;
  // 回退到 /favicon.ico
  return `${window.location.origin}/favicon.ico`;
}
