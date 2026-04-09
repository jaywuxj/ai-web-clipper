// ============================================================
// AI 分类器 — 根据文章标题/摘要/标签，让 AI 推断知识体系路径
// ============================================================

import type { SummaryResult, PageContent, KnowledgeNode } from "../types";
import { chatWithContext } from "./providers";
import { flattenTree } from "../storage/knowledge";

/**
 * 调用 AI，根据文章信息推断文件夹路径。
 *
 * 复用 chatWithContext（支持 apiKey / Cookie / Zero Token 全部模式），
 * 避免因用户没有 apiKey 而降级到「未分类」。
 *
 * 返回路径数组，例如 ["AI技术", "提示词工程"]
 */
export async function classifyArticle(
  summary: SummaryResult,
  page: PageContent,
  existingRoots: KnowledgeNode[],
  maxDepth: number
): Promise<string[]> {
  // 构建现有知识树的文本描述（供 AI 参考，避免重复新建）
  const existingPaths = flattenTree(existingRoots);
  const existingDesc =
    existingPaths.length > 0
      ? existingPaths.map((p) => p.join(" > ")).join("\n")
      : "（暂无，请根据文章自由创建）";

  const depthDesc =
    maxDepth === 1 ? "一级（只有一层，如：AI技术）" :
    `最多 ${maxDepth} 级（如：AI技术 > 提示词工程）`;

  const userQuestion = `请将以下文章归类到知识体系中。

【文章信息】
标题：${page.title}
一句话摘要：${summary.oneLiner || "无"}
标签：${summary.tags.join("、") || "无"}

【现有知识体系】（路径格式：一级 > 二级）
${existingDesc}

【分类要求】
1. 为这篇文章选择或创建一个分类路径，${depthDesc}，每级名称不超过 8 个字
2. 优先复用现有分类；只有在文章明显属于新领域时才创建新分类
3. 分类应简洁通用，避免过于具体（不要用文章标题作为分类名）
4. 只输出路径，每级用英文 > 分隔，不要任何解释

示例：AI技术 > 提示词工程
或：产品设计

直接输出路径：`;

  try {
    // 复用 chatWithContext，支持所有已配置的 provider（apiKey / Cookie / Zero Token）
    const reply = await chatWithContext(
      [{ role: "user", content: userQuestion }],
      "" // 不需要页面内容上下文，文章信息已在 prompt 里
    );

    const raw = reply.trim();
    const path = parsePath(raw, maxDepth);
    console.log(`[Classifier] 文章「${page.title}」→ 分类路径: ${path.join(" > ")}`);
    return path;
  } catch (err) {
    console.error("[Classifier] AI 分类失败:", err);
    return ["未分类"];
  }
}

/**
 * 解析 AI 返回的路径字符串。
 * 支持 "AI技术 > 提示词工程"、"AI技术>提示词工程"、"AI技术/提示词工程" 等格式。
 * 超过 maxDepth 层时截断。
 */
function parsePath(raw: string, maxDepth: number): string[] {
  // 支持 > 或 / 作为分隔符
  const parts = raw
    .split(/[>/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 20);

  if (parts.length === 0) return ["未分类"];

  // 截断到最大层数
  return parts.slice(0, maxDepth);
}
