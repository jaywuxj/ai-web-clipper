// ============================================================
// 类型定义 — 全项目共享
// ============================================================

/** Content Script 提取的页面内容 */
export interface PageContent {
  title: string;
  content: string; // 正文 HTML
  textContent: string; // 纯文本
  excerpt: string; // 摘要
  byline: string; // 作者
  siteName: string; // 站点名
  url: string;
  faviconUrl: string;
  publishedTime: string;
  savedAt: string; // ISO 时间戳
}

/** AI 总结结果 */
export interface SummaryResult {
  oneLiner: string; // 一句话摘要
  keyPoints: string[]; // 核心要点 (3-5 条)
  detailedSummary: string; // 详细总结
  tags: string[]; // 推荐标签
  rawContent: string; // AI 模型返回的原始文本（去除 think 标签后）
}

/** Prompt 模板 */
export interface PromptTemplate {
  id: string;
  name: string;
  description?: string; // 模板描述
  prompt: string;
  isBuiltin: boolean; // 内置模板不可删除
  enabled: boolean; // 是否启用（启用后才在扩展中展示和使用）
}

/** AI Provider 类型（支持任意自定义 provider） */
export type AIProvider = string;

/** 单个 Provider 的配置 */
export interface ProviderConfig {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  /** 显示名称（自定义 provider 必填） */
  displayName?: string;
  /** 是否为用户自定义添加的 provider */
  isCustom?: boolean;
  /** 认证模式：apiKey（默认）、cookie（免 Key，复用网页登录态）、zeroToken（Zero Token 框架） */
  authMode?: "apiKey" | "cookie" | "zeroToken";
  /** Zero Token 提供商 ID（当 authMode 为 "zeroToken" 时使用） */
  zeroTokenProviderId?: string;
}

/** 用户设置 */
export interface UserSettings {
  aiProvider: AIProvider; // 优先使用的 provider（兼容旧字段）
  apiKey: string; // 当前优先 provider 的 key（兼容旧字段）
  apiBaseUrl: string;
  model: string;
  saveAs: boolean;
  savePath: string; // 默认保存子目录（相对于下载目录）
  activePromptId: string;
  /** 各 provider 独立配置 */
  providerConfigs: Record<string, ProviderConfig>;
  /** provider 优先级顺序，索引越小优先级越高 */
  providerPriority: AIProvider[];
  /** 知识体系相关设置 */
  knowledgeSettings: KnowledgeSettings;
}

// ============================================================
// 知识体系类型
// ============================================================

/** 知识体系设置 */
export interface KnowledgeSettings {
  /** 是否启用自动分类 */
  enabled: boolean;
  /** 文件夹最大层数（1~3，默认 2） */
  maxDepth: number;
  /** 知识体系更新检查方式：auto=每次保存后检查, manual=手动触发 */
  updateMode: "auto" | "manual";
}

/**
 * 知识体系节点（树形结构）
 * 例：{ name: "AI技术", children: [{ name: "提示词工程", children: [] }] }
 */
export interface KnowledgeNode {
  name: string;
  children: KnowledgeNode[];
}

/** 存储在 chrome.storage.local 中的知识体系快照 */
export interface KnowledgeTreeSnapshot {
  /** 根节点列表（一级分类） */
  roots: KnowledgeNode[];
  /** 最后更新时间（ISO 字符串） */
  updatedAt: string;
}

/** 知识体系变更提案（待用户确认） */
export interface KnowledgeUpdateProposal {
  /** 建议新增的节点路径，如 ["AI技术", "多模态"] */
  additions: string[][];
  /** 建议删除的节点路径（暂时保留，不主动删） */
  // removals: string[][];
  /** 触发本次提案的文章标题 */
  triggerTitle: string;
  /** 创建时间 */
  createdAt: string;
}

/** 聊天消息（前端展示 + 发送给 AI） */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** 消息类型枚举 */
export enum MessageType {
  EXTRACT_CONTENT = "EXTRACT_CONTENT",
  EXTRACT_SELECTION = "EXTRACT_SELECTION",
  START_SUMMARY = "START_SUMMARY",
  START_SUMMARY_SELECTION = "START_SUMMARY_SELECTION",
  SAVE_FILE = "SAVE_FILE",
  COPY_MARKDOWN = "COPY_MARKDOWN",
  /** 后台一体化：总结 + 自动保存（不受 Popup 关闭影响） */
  SUMMARIZE_AND_SAVE = "SUMMARIZE_AND_SAVE",
  /** 多轮对话消息 */
  CHAT_MESSAGE = "CHAT_MESSAGE",
  /** 检查 Kimi Cookie 模式登录状态（由 background 执行，支持读取 localStorage） */
  CHECK_KIMI_LOGIN = "CHECK_KIMI_LOGIN",
  /** 检查 Zero Token 提供商登录状态（由 background 执行） */
  CHECK_ZERO_TOKEN_LOGIN = "CHECK_ZERO_TOKEN_LOGIN",
  /** 手动触发知识体系重新分析 */
  REBUILD_KNOWLEDGE_TREE = "REBUILD_KNOWLEDGE_TREE",
  /** 确认/应用待确认的知识体系提案 */
  APPLY_KNOWLEDGE_PROPOSAL = "APPLY_KNOWLEDGE_PROPOSAL",
  /** 忽略/丢弃待确认的知识体系提案 */
  DISMISS_KNOWLEDGE_PROPOSAL = "DISMISS_KNOWLEDGE_PROPOSAL",
  /** 删除知识体系中的一个文件（本地文件 + 历史记录） */
  DELETE_KNOWLEDGE_FILE = "DELETE_KNOWLEDGE_FILE",
  /** 从 chrome.downloads 记录同步文件夹结构，刷新知识体系（无需 AI） */
  SYNC_FROM_DOWNLOADS = "SYNC_FROM_DOWNLOADS",
}

/** 后台任务状态（存储在 session storage） */
export interface BackgroundTaskStatus {
  state: "idle" | "extracting" | "summarizing" | "saving" | "done" | "error";
  url?: string; // 任务对应的页面 URL
  summary?: SummaryResult;
  pageContent?: PageContent;
  error?: string;
  timestamp: number;
}

/** 消息结构 */
export interface ExtractContentMessage {
  type: MessageType.EXTRACT_CONTENT;
}

export interface ExtractSelectionMessage {
  type: MessageType.EXTRACT_SELECTION;
}

export interface StartSummaryMessage {
  type: MessageType.START_SUMMARY;
  payload?: {
    promptId?: string;
    customTags?: string[];
    customPrompt?: string;
  };
}

export interface StartSummarySelectionMessage {
  type: MessageType.START_SUMMARY_SELECTION;
  payload: {
    selectedText: string;
  };
}

export interface SaveFileMessage {
  type: MessageType.SAVE_FILE;
  payload: {
    summary: SummaryResult;
    pageContent: PageContent;
  };
}

export interface ChatMessageMessage {
  type: MessageType.CHAT_MESSAGE;
  payload: {
    messages: ChatMessage[];
    pageContent: string;
    promptId?: string;
  };
}

export type AppMessage =
  | ExtractContentMessage
  | ExtractSelectionMessage
  | StartSummaryMessage
  | StartSummarySelectionMessage
  | SaveFileMessage
  | ChatMessageMessage;

/** 消息响应 */
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 历史记录条目 */
export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  summary: SummaryResult;
  savedAt: string;
  /** Chrome 下载 ID，用于打开已保存的文件 */
  downloadId?: number;
  /** 文件保存路径（相对于下载目录，含文件名），用于知识体系文件列表展示 */
  savedPath?: string;
}

/** 自定义快捷键绑定 */
export interface ShortcutBinding {
  /** 命令 ID，与 manifest commands 中的 key 对应 */
  commandId: string;
  /** 按键组合字符串，如 "Ctrl+Shift+S"、"⌘+Shift+L" */
  keys: string;
  /** 标准化按键表示（不含平台修饰符差异），如 "ctrl+shift+s" */
  normalizedKeys: string;
}

/** 自定义快捷键配置（存储到 chrome.storage.sync） */
export interface CustomShortcutConfig {
  /** 用户自定义快捷键映射：commandId -> ShortcutBinding */
  bindings: Record<string, ShortcutBinding>;
}
