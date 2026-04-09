// ============================================================
// Markdown 文件生成器
// ============================================================

import type { PageContent, SummaryResult } from "../types";
import { formatDateTimestamp } from "../utils/date";

/**
 * 将 AI 总结结果与页面元信息组合生成完整的 Markdown 文件内容
 */
export function generateMarkdown(
  summary: SummaryResult,
  page: PageContent
): string {
  const savedTime = formatDateTimestamp(new Date(page.savedAt));

  // 直接使用 AI 原始返回内容；兼容旧数据：若无 rawContent 则拼接 oneLiner + detailedSummary
  const content =
    summary.rawContent ||
    (summary.oneLiner + "\n\n" + summary.detailedSummary).trim();

  const md = `${content}

---

> 原文链接：[${page.url}](${page.url})
> 保存时间：${savedTime}
`;

  return md;
}
