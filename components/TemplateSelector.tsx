// ============================================================
// TemplateSelector — 模板选择器（Popup 首屏）
// ============================================================

import { useState } from "react";
import type { PromptTemplate } from "@/lib/types";

interface TemplateSelectorProps {
  templates: PromptTemplate[];
  activeId: string;
  onSelect: (templateId: string) => void;
  onCustomPrompt?: (prompt: string) => void;
}

/** 模板图标映射 */
const TEMPLATE_ICONS: Record<string, string> = {
  default: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  "summary-full": "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  tech: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
  "deep-read": "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  "translate-zh": "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129",
  "translate-academic": "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129",
  "translate-parallel": "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129",
  academic: "M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z",
  "deep-questions": "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "key-info": "M4 6h16M4 10h16M4 14h16M4 18h16",
  "fact-check": "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

function getIconPath(templateId: string): string {
  return (
    TEMPLATE_ICONS[templateId] ||
    "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
  );
}

export default function TemplateSelector({
  templates,
  activeId,
  onSelect,
  onCustomPrompt,
}: TemplateSelectorProps) {
  const [customInput, setCustomInput] = useState("");

  const handleSubmitCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || !onCustomPrompt) return;
    onCustomPrompt(trimmed);
    setCustomInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitCustom();
    }
  };

  return (
    <div className="py-3">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
        选择总结模板
      </h2>

      <div className="space-y-1.5">
        {templates.map((tmpl) => (
          <button
            key={tmpl.id}
            onClick={() => onSelect(tmpl.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:shadow-sm group cursor-pointer ${
              activeId === tmpl.id
                ? "bg-blue-50/70 dark:bg-blue-900/15 ring-1 ring-blue-200 dark:ring-blue-700"
                : "bg-white dark:bg-gray-800/50"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                activeId === tmpl.id
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-800/30 group-hover:text-blue-500"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={getIconPath(tmpl.id)} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{tmpl.name}</span>
                {activeId === tmpl.id && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium flex-shrink-0">上次使用</span>
                )}
                {!tmpl.isBuiltin && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium flex-shrink-0">自定义</span>
                )}
              </div>
              {tmpl.description && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{tmpl.description}</p>
              )}
            </div>
            <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      {/* AI 智能对话入口 */}
      <div className="mt-3 mb-1">
        <button
          onClick={async () => {
            try {
              // 直接在 popup 中调用 sidePanel.open()
              // 必须在用户手势上下文中调用，不能通过消息中转到 background
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.id) {
                await (chrome.sidePanel as any).open({ tabId: tab.id });
              }
              // 关闭 popup
              window.close();
            } catch {
              // 降级：通知 background 打开（某些 Chrome 版本不支持 popup 中直接调用）
              try {
                await browser.runtime.sendMessage({
                  type: "EXECUTE_SHORTCUT_COMMAND",
                  payload: { commandId: "open-sidepanel" },
                });
                window.close();
              } catch {
                alert("请使用快捷键 Ctrl+Shift+L（Mac: ⌘+Shift+L）打开侧边对话");
              }
            }
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:shadow-sm group cursor-pointer bg-gradient-to-r from-emerald-50/50 to-blue-50/50 dark:from-emerald-900/10 dark:to-blue-900/10 ring-1 ring-emerald-200/60 dark:ring-emerald-700/40"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-500 to-blue-500 text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">智能对话</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 font-medium flex-shrink-0">侧边栏</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">基于当前页面内容，与 AI 多轮深度对话</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-emerald-400 flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 自定义指令输入框 */}
      <div className="mt-3">
        <div className="relative flex items-end rounded-2xl bg-gray-100 dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700/60 px-3 py-2">
          <textarea
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入自定义指令，如：用英文总结要点..."
            rows={2}
            className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none"
          />
          <button
            onClick={handleSubmitCustom}
            disabled={!customInput.trim()}
            className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-white transition-colors cursor-pointer ml-2 ${customInput.trim() ? "bg-blue-500 hover:bg-blue-600" : "bg-gray-300 dark:bg-gray-600 opacity-40 cursor-not-allowed"}`}
            title="发送自定义指令"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center mt-1.5">
        一次性指令不会保存，Enter 发送
      </p>
    </div>
  );
}
