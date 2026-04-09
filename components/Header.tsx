// ============================================================
// Header — Popup 顶部栏
// ============================================================

interface HeaderProps {
  title?: string;
  faviconUrl?: string;
  siteName?: string;
}

export default function Header({ title, faviconUrl, siteName }: HeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#16213e]">
      {/* 插件图标 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-4 h-4 rounded-sm flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-4 h-4 rounded-sm bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {title || "AI Web Clipper"}
          </h1>
          {siteName && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
              {siteName}
            </p>
          )}
        </div>
      </div>

      {/* 设置按钮 */}
      <button
        onClick={() => browser.runtime.openOptionsPage()}
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        title="设置"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  );
}
