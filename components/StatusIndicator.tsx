// ============================================================
// StatusIndicator — 加载 / 错误状态展示
// ============================================================

interface LoadingProps {
  type: "loading";
  message?: never;
  onRetry?: never;
}

interface ErrorProps {
  type: "error";
  message: string;
  onRetry: () => void;
}

type StatusIndicatorProps = LoadingProps | ErrorProps;

export default function StatusIndicator(props: StatusIndicatorProps) {
  if (props.type === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        {/* 动画脉冲圈 */}
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-blue-200 dark:border-blue-800" />
          <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        </div>

        {/* 进度文字 */}
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            正在分析页面内容...
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            AI 正在阅读并生成总结
          </p>
        </div>

        {/* 骨架屏预览 */}
        <div className="w-full space-y-3 mt-2 animate-pulse">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-3/4" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-full" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-5/6" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-2/3 mt-4" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full w-full" />
        </div>
      </div>
    );
  }

  // ---------- 错误状态 ----------
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <svg
          className="w-6 h-6 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
          出错了
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[280px]">
          {props.message}
        </p>
      </div>

      <button
        onClick={props.onRetry}
        className="px-4 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
      >
        重试
      </button>
    </div>
  );
}
