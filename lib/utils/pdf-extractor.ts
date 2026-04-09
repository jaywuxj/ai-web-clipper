// ============================================================
// PDF 内容提取工具
// ============================================================
//
// 不引入 pdfjs-dist 等大型依赖，采用两阶段策略：
// 1. 智能 URL 转换：对已知学术/文档网站，把 PDF URL 转为 HTML 摘要页
// 2. 轻量文本提取：fetch PDF 二进制，用正则从 PDF 文本流中提取可读文本
//    （覆盖 PDF 1.x/2.x 的 BT/ET 文本块，支持 ASCII 和简单 UTF-16）

import type { PageContent } from "../types";

/** 判断 URL 是否指向 PDF */
export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".pdf")) return true;
    // arxiv PDF 直链
    if (u.hostname === "arxiv.org" && path.startsWith("/pdf/")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 尝试将 PDF URL 转换为对应的 HTML 页面 URL。
 * 返回 null 表示无法转换，需要走原始 PDF 提取。
 */
export function tryConvertPdfToHtmlUrl(pdfUrl: string): string | null {
  try {
    const u = new URL(pdfUrl);

    // arxiv: /pdf/1706.03762 → /abs/1706.03762
    if (u.hostname === "arxiv.org" && u.pathname.startsWith("/pdf/")) {
      const arxivId = u.pathname.replace("/pdf/", "").replace(/\.pdf$/, "");
      return `https://arxiv.org/abs/${arxivId}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从 HTML 摘要页提取文章内容（arxiv abs 页等）
 */
export async function fetchHtmlPageContent(
  htmlUrl: string,
  originalPdfUrl: string
): Promise<PageContent | null> {
  try {
    const resp = await fetch(htmlUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Web-Clipper)" },
    });
    if (!resp.ok) return null;

    const html = await resp.text();

    // 简单解析标题和摘要（针对 arxiv abs 页面）
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = titleMatch?.[1]?.trim() || "PDF 文档";
    // arxiv 标题格式：[2301.xxxxx] Title | ... 去掉前缀
    const title = rawTitle.replace(/^\[\d+\.\d+\]\s*/, "").replace(/\s*\|.*$/, "").trim();

    // 提取摘要
    let abstract = "";
    const absMatch = html.match(/class="abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i)
      || html.match(/id="abstract"[^>]*>([\s\S]*?)<\/(?:div|p|section)>/i);
    if (absMatch) {
      abstract = absMatch[1]
        .replace(/<[^>]+>/g, " ")  // 去 HTML 标签
        .replace(/\s+/g, " ")
        .replace(/^Abstract:?\s*/i, "")
        .trim();
    }

    // 提取作者
    let author = "";
    const authorMatch = html.match(/class="authors"[^>]*>([\s\S]*?)<\/div>/i);
    if (authorMatch) {
      author = authorMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    if (!abstract && !title) return null;

    const textContent = [
      title,
      author ? `作者：${author}` : "",
      abstract ? `摘要：${abstract}` : "",
      `原文链接：${originalPdfUrl}`,
    ].filter(Boolean).join("\n\n");

    return {
      title,
      content: `<p>${abstract}</p>`,
      textContent,
      excerpt: abstract.slice(0, 200),
      byline: author,
      siteName: new URL(htmlUrl).hostname,
      url: originalPdfUrl,
      faviconUrl: "",
      publishedTime: "",
      savedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * 直接 fetch PDF 并提取文字（轻量正则方案，无需 pdfjs）
 * 适用于无法转换为 HTML 的通用 PDF
 */
export async function fetchAndExtractPdf(pdfUrl: string): Promise<PageContent> {
  const resp = await fetch(pdfUrl);
  if (!resp.ok) throw new Error(`PDF 下载失败 (HTTP ${resp.status})`);

  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = extractTextFromPdfBytes(bytes);

  // 尝试从 PDF 元数据里提取标题
  const title = extractPdfTitle(bytes) || new URL(pdfUrl).pathname.split("/").pop()?.replace(/\.pdf$/i, "") || "PDF 文档";

  const cleanText = text
    .replace(/\s{3,}/g, "\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u4E00-\u9FFF\u3000-\u303F]/g, "") // 保留 ASCII + 中文
    .trim();

  if (cleanText.length < 50) {
    throw new Error("PDF 内容提取失败，该 PDF 可能为扫描版（图片 PDF），暂不支持 OCR 识别");
  }

  return {
    title,
    content: `<p>${cleanText.slice(0, 500)}</p>`,
    textContent: cleanText,
    excerpt: cleanText.slice(0, 200),
    byline: "",
    siteName: new URL(pdfUrl).hostname,
    url: pdfUrl,
    faviconUrl: "",
    publishedTime: "",
    savedAt: new Date().toISOString(),
  };
}

// --------------------------------------------------
// PDF 文本提取内核（纯正则，无依赖）
// --------------------------------------------------

function extractTextFromPdfBytes(bytes: Uint8Array): string {
  // 将字节转为 Latin1 字符串（PDF 是二进制格式，先用 Latin1 读取再处理）
  let raw = "";
  for (let i = 0; i < Math.min(bytes.length, 5_000_000); i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const textParts: string[] = [];

  // 提取 BT ... ET 文本块中的字符串
  const btEtRegex = /BT[\s\S]*?ET/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btEtRegex.exec(raw)) !== null) {
    const block = btMatch[0];
    // 从 Tj / TJ / ' / " 指令中提取字符串
    const strRegex = /\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = decodePdfString(strMatch[1]);
      if (decoded.trim()) textParts.push(decoded);
    }
    // TJ 数组形式：[(text) -200 (more) ] TJ
    const tjArrRegex = /\[((?:[^[\]]*(?:\([^)]*\)[^[\]]*)*)*)\]\s*TJ/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjArrRegex.exec(block)) !== null) {
      const inner = tjMatch[1];
      const innerStr = /\(((?:[^()\\]|\\.)*)\)/g;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerStr.exec(inner)) !== null) {
        const decoded = decodePdfString(innerMatch[1]);
        if (decoded.trim()) textParts.push(decoded);
      }
    }
  }

  return textParts.join(" ");
}

function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, "$1");
}

function extractPdfTitle(bytes: Uint8Array): string | null {
  let raw = "";
  for (let i = 0; i < Math.min(bytes.length, 100_000); i++) {
    raw += String.fromCharCode(bytes[i]);
  }
  const match = raw.match(/\/Title\s*\(([^)]+)\)/);
  return match ? decodePdfString(match[1]).trim() : null;
}

/**
 * 主入口：对 PDF URL 进行内容提取。
 * 优先策略：HTML 摘要页 → PDF 文本提取
 */
export async function extractPdfContent(pdfUrl: string): Promise<PageContent> {
  // 策略1：尝试转为 HTML 页提取
  const htmlUrl = tryConvertPdfToHtmlUrl(pdfUrl);
  if (htmlUrl) {
    console.log(`[PDF Extractor] 尝试 HTML 摘要页: ${htmlUrl}`);
    const htmlContent = await fetchHtmlPageContent(htmlUrl, pdfUrl);
    if (htmlContent && htmlContent.textContent.length > 100) {
      console.log(`[PDF Extractor] HTML 摘要页提取成功 (${htmlContent.textContent.length} chars)`);
      return htmlContent;
    }
  }

  // 策略2：直接 fetch PDF 文本提取
  console.log(`[PDF Extractor] 直接提取 PDF 文字: ${pdfUrl}`);
  return await fetchAndExtractPdf(pdfUrl);
}
