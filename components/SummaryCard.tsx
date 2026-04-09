// ============================================================
// SummaryCard — 展示 AI 总结结果
// ============================================================

import type { SummaryResult } from "@/lib/types";

interface SummaryCardProps {
  summary: SummaryResult;
}

export default function SummaryCard({ summary }: SummaryCardProps) {
  return (
    <div className="py-2">
      {/* 一句话摘要（高亮） */}
      <p className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 mb-3">
        {summary.oneLiner}
      </p>

      {/* 要点 + 详细总结合并为一个连续块 */}
      <div className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed space-y-2">
        {/* 核心要点以列表形式融入 */}
        {summary.keyPoints.length > 0 && (
          <ul className="space-y-1.5">
            {summary.keyPoints.map((point, i) => (
              <li
                key={i}
                className="flex items-start gap-2"
              >
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        )}

        {/* 详细总结紧跟在要点之后 */}
        {summary.detailedSummary.split("\n").map((para, i) =>
          para.trim() ? (
            <p key={`d-${i}`}>{para}</p>
          ) : null
        )}
      </div>

      {/* 标签已移至 TagEditor 组件 */}
    </div>
  );
}
