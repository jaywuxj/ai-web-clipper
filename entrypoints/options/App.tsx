// ============================================================
// Options 设置页面 — 完整功能版
// ============================================================

import { useState, useEffect, useRef } from "react";
import type { UserSettings, PromptTemplate, HistoryEntry, KnowledgeSettings, KnowledgeUpdateProposal, KnowledgeTreeSnapshot } from "@/lib/types";
import { MessageType } from "@/lib/types";
import {
  getAllTemplates,
  addCustomTemplate,
  updateTemplate,
  removeCustomTemplate,
  removeTemplate,
  getActiveTemplate,
  setActiveTemplate,
  setTemplateEnabled,
  resetBuiltinTemplate,
  getBuiltinDefaultById,
  getHiddenBuiltinTemplates,
  restoreBuiltinTemplate,
} from "@/lib/storage/prompts";
import { getHistory, removeHistoryEntry, clearHistory } from "@/lib/storage/history";
import { optimizePrompt } from "@/lib/ai/providers";
import {
  getKnowledgeTree,
  saveKnowledgeTree,
  flattenTree,
  getPendingProposal,
  clearPendingProposal,
  mergePathsIntoTree,
  DEFAULT_KNOWLEDGE_SETTINGS,
} from "@/lib/storage/knowledge";

type TabId = "settings" | "prompts" | "history" | "knowledge";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("knowledge");

  return (
    <div className="flex flex-col min-h-screen max-w-3xl mx-auto w-full">
      {/* 固定头部区域 */}
      <div className="flex-shrink-0 px-6 pt-6">
        {/* 标题 */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              AI Web Clipper 设置
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              v2.0.0 — 配置 AI 模型、Prompt 模板和查看历史记录
            </p>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(
            [
              { id: "knowledge" as TabId, label: "知识体系", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
              { id: "prompts" as TabId, label: "Prompt 模板", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
              { id: "settings" as TabId, label: "基础设置", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" },
              { id: "history" as TabId, label: "历史记录", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-white dark:bg-[#16213e] text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容区域 */}
      <div className="flex-1 px-6 pb-6">
        {activeTab === "settings" && <SettingsTab />}
        {activeTab === "prompts" && <PromptsTab />}
        {activeTab === "knowledge" && <KnowledgeTab />}
        {activeTab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

// ============================================================
// 保存路径输入组件 — 默认下载目录 + 可自定义
// ============================================================

function SavePathPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  /** 规范化路径：去除首尾斜杠、非法字符、多余斜杠 */
  const normalizePath = (raw: string): string => {
    return raw
      .replace(/\\/g, "/")           // 反斜杠 → 正斜杠
      .replace(/[<>:"|?*]/g, "")     // 去除 Windows 非法字符
      .replace(/\/+/g, "/")          // 多个斜杠压缩
      .replace(/^\/+|\/+$/g, "")     // 去除首尾斜杠
      .trim();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleBlur = () => {
    // 失去焦点时规范化路径
    if (value) {
      const normalized = normalizePath(value);
      if (normalized !== value) {
        onChange(normalized);
      }
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
        默认保存目录
      </label>

      {/* 路径输入框 */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-sm text-gray-400">下载目录 /</span>
        </div>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="留空则保存到下载根目录"
          className="w-full pl-[120px] pr-9 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-red-400 transition-colors rounded"
            title="清空，恢复到下载根目录"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        相对于浏览器下载目录的子文件夹路径，如 <code className="text-gray-500 dark:text-gray-400">AI-Clipper/笔记</code>。留空则直接保存到下载目录。文件夹不存在时会自动创建。
      </p>
    </div>
  );
}

// ============================================================
// 基础设置 Tab
// ============================================================

function SettingsTab() {
  // 内置 Provider（不可删除）— 当前所有模型均可通过预设模板添加/删除
  const BUILTIN_PROVIDER_INFO: Record<string, { name: string; keyUrl: string; desc: string }> = {};
  const BUILTIN_PROVIDER_IDS: string[] = [];
  const BUILTIN_DEFAULTS: Record<string, { apiBaseUrl: string; model: string }> = {};

  // 可快速添加的预设模型模板
  const PRESET_TEMPLATES = [
    { id: "minimax", displayName: "MiniMax", desc: "MiniMax M2.5 · OpenAI 兼容接口", apiBaseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2.5", keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key" },
    { id: "kimi", displayName: "Kimi (Moonshot)", desc: "Kimi K2.5 · 支持免费 Cookie 模式", apiBaseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", keyUrl: "https://platform.moonshot.cn/console/api-keys" },
    { id: "deepseek", displayName: "DeepSeek", desc: "DeepSeek V3/R1 · 高性价比推理模型", apiBaseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
    { id: "openai", displayName: "OpenAI", desc: "GPT-4o / GPT-4.1 · 全球领先大模型", apiBaseUrl: "https://api.openai.com/v1", model: "gpt-4o", keyUrl: "https://platform.openai.com/api-keys" },
    { id: "claude", displayName: "Claude", desc: "Claude 4 Sonnet · Anthropic 旗舰模型", apiBaseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514", keyUrl: "https://console.anthropic.com/settings/keys" },
    { id: "glm", displayName: "智谱 GLM", desc: "GLM-4-Plus · 智谱 AI 旗舰模型", apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
    { id: "qwen", displayName: "通义千问", desc: "Qwen-Plus · 阿里云大模型", apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyUrl: "https://dashscope.console.aliyun.com/apiKey" },
    { id: "doubao", displayName: "豆包", desc: "Doubao · 字节跳动大模型", apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-1.5-pro-256k", keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" },
  ];

  const [settings, setSettings] = useState<UserSettings>({
    aiProvider: "minimax",
    apiKey: "",
    apiBaseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-M2.5",
    saveAs: false,
    savePath: "",
    activePromptId: "default",
    providerConfigs: {
      minimax: { apiKey: "", apiBaseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2.5", displayName: "MiniMax", isCustom: false },
      kimi: { apiKey: "", apiBaseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", displayName: "Kimi (Moonshot)", isCustom: false },
    },
    providerPriority: ["minimax", "kimi"],
    knowledgeSettings: DEFAULT_KNOWLEDGE_SETTINGS,
  });
  const [saved, setSaved] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [customForm, setCustomForm] = useState({ displayName: "", apiBaseUrl: "", model: "", apiKey: "", keyUrl: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [kimiLoginStatus, setKimiLoginStatus] = useState<"checking" | "logged-in" | "not-logged-in">("checking");
  /** Zero Token 各提供商登录状态 */
  const [zeroTokenStatuses, setZeroTokenStatuses] = useState<Record<string, "checking" | "logged-in" | "not-logged-in">>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  /** Zero Token 提供商信息列表 */
  const ZERO_TOKEN_PROVIDER_LIST = [
    { id: "kimi-web", displayName: "Kimi (免费)", domain: "kimi.moonshot.cn", loginUrl: "https://kimi.moonshot.cn", modelName: "Kimi", desc: "Kimi 网页版 · 复用浏览器登录态 · 无需 API Key" },
  ];

  // 通过 background service worker 检测 Kimi 登录状态（兼容旧 Cookie 模式）
  const checkKimiLogin = async (): Promise<boolean> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MessageType.CHECK_KIMI_LOGIN });
      return response?.data?.loggedIn === true;
    } catch (err) {
      console.warn("[Options] 检测 Kimi 登录状态失败:", err);
      return false;
    }
  };

  /** 检查单个 Zero Token 提供商的登录状态 */
  const checkZeroTokenLogin = async (providerId: string): Promise<boolean> => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.CHECK_ZERO_TOKEN_LOGIN,
        payload: { providerId },
      });
      return response?.data?.[providerId] === true;
    } catch (err) {
      console.warn(`[Options] 检测 ${providerId} 登录状态失败:`, err);
      return false;
    }
  };

  /** 批量检查所有 Zero Token 提供商登录状态 */
  const checkAllZeroTokenLogins = async () => {
    // 先将所有已添加的 Zero Token 提供商设为 checking
    const checking: Record<string, "checking" | "logged-in" | "not-logged-in"> = {};
    for (const ztInfo of ZERO_TOKEN_PROVIDER_LIST) {
      const ztKey = `zt_${ztInfo.id}`;
      if (settings.providerConfigs[ztKey]?.authMode === "zeroToken") {
        checking[ztInfo.id] = "checking";
      }
    }
    setZeroTokenStatuses(checking);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MessageType.CHECK_ZERO_TOKEN_LOGIN,
      });
      const statuses = response?.data || {};
      const result: Record<string, "checking" | "logged-in" | "not-logged-in"> = {};
      for (const ztInfo of ZERO_TOKEN_PROVIDER_LIST) {
        const ztKey = `zt_${ztInfo.id}`;
        if (settings.providerConfigs[ztKey]?.authMode === "zeroToken") {
          result[ztInfo.id] = statuses[ztInfo.id] ? "logged-in" : "not-logged-in";
        }
      }
      setZeroTokenStatuses(result);
    } catch {
      const result: Record<string, "checking" | "logged-in" | "not-logged-in"> = {};
      for (const ztInfo of ZERO_TOKEN_PROVIDER_LIST) {
        const ztKey = `zt_${ztInfo.id}`;
        if (settings.providerConfigs[ztKey]?.authMode === "zeroToken") {
          result[ztInfo.id] = "not-logged-in";
        }
      }
      setZeroTokenStatuses(result);
    }
  };

  // 检测 Kimi 旧版 Cookie 模式登录状态
  useEffect(() => {
    const kimiConfig = settings.providerConfigs["kimi"];
    if (kimiConfig?.authMode === "cookie") {
      setKimiLoginStatus("checking");
      checkKimiLogin().then((ok) => {
        setKimiLoginStatus(ok ? "logged-in" : "not-logged-in");
      });
    }
  }, [settings.providerConfigs["kimi"]?.authMode]);

  // 初始加载时批量检查所有 Zero Token 提供商登录状态
  useEffect(() => {
    const hasAnyZeroToken = ZERO_TOKEN_PROVIDER_LIST.some((zt) => {
      const ztKey = `zt_${zt.id}`;
      return settings.providerConfigs[ztKey]?.authMode === "zeroToken";
    });
    if (hasAnyZeroToken) {
      checkAllZeroTokenLogins();
    }
  }, [Object.keys(settings.providerConfigs).filter(k => k.startsWith("zt_")).length]);

  useEffect(() => {
    chrome.storage.sync.get(
      ["aiProvider", "apiKey", "apiBaseUrl", "model", "saveAs", "savePath", "activePromptId", "providerConfigs", "providerPriority", "knowledgeSettings"],
      (result) => {
        const providerPriority = (result.providerPriority as UserSettings["providerPriority"]) || ["minimax", "kimi"];
        let providerConfigs = result.providerConfigs as UserSettings["providerConfigs"] | null;

        if (!providerConfigs) {
          const oldProvider = (result.aiProvider as string) || "minimax";
          providerConfigs = {
            minimax: { apiKey: "", apiBaseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2.5", displayName: "MiniMax", isCustom: false },
            kimi: { apiKey: "", apiBaseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", displayName: "Kimi (Moonshot)", isCustom: false },
          };
          if (result.apiKey) {
            const defaults = BUILTIN_DEFAULTS[oldProvider];
            if (defaults) {
              providerConfigs[oldProvider] = {
                apiKey: result.apiKey as string,
                apiBaseUrl: (result.apiBaseUrl as string) || defaults.apiBaseUrl,
                model: (result.model as string) || defaults.model,
                displayName: BUILTIN_PROVIDER_INFO[oldProvider]?.name || oldProvider,
                isCustom: false,
              };
            }
          }
        }

        const primary = providerPriority[0] || "minimax";
        const primaryCfg = providerConfigs[primary];

        setSettings({
          aiProvider: primary,
          apiKey: primaryCfg?.apiKey || "",
          apiBaseUrl: primaryCfg?.apiBaseUrl || "",
          model: primaryCfg?.model || "",
          saveAs: result.saveAs || false,
          savePath: (result.savePath as string) || "",
          activePromptId: result.activePromptId || "default",
          providerConfigs,
          providerPriority,
          knowledgeSettings: (result.knowledgeSettings as UserSettings["knowledgeSettings"]) || DEFAULT_KNOWLEDGE_SETTINGS,
        });
      }
    );
  }, []);

  const persistSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      chrome.storage.sync.set(newSettings, () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      });
    }, 500);
  };

  const updateProviderConfig = (provider: string, partial: Partial<UserSettings["providerConfigs"][string]>) => {
    const newConfigs = {
      ...settings.providerConfigs,
      [provider]: { ...settings.providerConfigs[provider], ...partial },
    };
    const primary = settings.providerPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
  };

  const setPrimary = (provider: string) => {
    const list = settings.providerPriority.filter((p) => p !== provider);
    list.unshift(provider);

    const primaryCfg = settings.providerConfigs[provider];
    persistSettings({
      ...settings,
      providerPriority: list,
      aiProvider: provider,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
  };

  /** 添加预设模型 */
  const addPresetProvider = (preset: typeof PRESET_TEMPLATES[0]) => {
    // 避免重复添加
    if (settings.providerConfigs[preset.id]) {
      alert(`${preset.displayName} 已存在，无需重复添加`);
      return;
    }
    const newConfigs = {
      ...settings.providerConfigs,
      [preset.id]: {
        apiKey: "",
        apiBaseUrl: preset.apiBaseUrl,
        model: preset.model,
        displayName: preset.displayName,
        isCustom: true,
      },
    };
    const newPriority = [...settings.providerPriority, preset.id];
    const primary = newPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      providerPriority: newPriority,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
    setShowAddPanel(false);
  };

  /** 添加完全自定义的模型 */
  const addCustomProvider = () => {
    if (!customForm.displayName.trim() || !customForm.apiBaseUrl.trim() || !customForm.model.trim()) {
      alert("请填写名称、Base URL 和模型名称");
      return;
    }
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newConfigs = {
      ...settings.providerConfigs,
      [id]: {
        apiKey: customForm.apiKey,
        apiBaseUrl: customForm.apiBaseUrl,
        model: customForm.model,
        displayName: customForm.displayName,
        isCustom: true,
      },
    };
    const newPriority = [...settings.providerPriority, id];
    const primary = newPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      providerPriority: newPriority,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
    setCustomForm({ displayName: "", apiBaseUrl: "", model: "", apiKey: "", keyUrl: "" });
    setShowAddPanel(false);
  };

  /** 启用 Zero Token 提供商 */
  const enableZeroTokenProvider = (ztInfo: typeof ZERO_TOKEN_PROVIDER_LIST[0]) => {
    const ztKey = `zt_${ztInfo.id}`;
    // 已存在则不重复添加
    if (settings.providerConfigs[ztKey]) return;

    const newConfigs = {
      ...settings.providerConfigs,
      [ztKey]: {
        apiKey: "",
        apiBaseUrl: "",
        model: ztInfo.modelName,
        displayName: ztInfo.displayName,
        isCustom: true,
        authMode: "zeroToken" as const,
        zeroTokenProviderId: ztInfo.id,
      },
    };
    const newPriority = [...settings.providerPriority, ztKey];
    const primary = newPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      providerPriority: newPriority,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });

    // 立即检查登录状态
    setZeroTokenStatuses((prev) => ({ ...prev, [ztInfo.id]: "checking" }));
    checkZeroTokenLogin(ztInfo.id).then((ok) => {
      setZeroTokenStatuses((prev) => ({
        ...prev,
        [ztInfo.id]: ok ? "logged-in" : "not-logged-in",
      }));
    });
  };

  /** 禁用（移除）Zero Token 提供商 */
  const disableZeroTokenProvider = (ztInfo: typeof ZERO_TOKEN_PROVIDER_LIST[0]) => {
    const ztKey = `zt_${ztInfo.id}`;
    const newConfigs = { ...settings.providerConfigs };
    delete newConfigs[ztKey];
    const newPriority = settings.providerPriority.filter((p) => p !== ztKey);
    if (newPriority.length === 0) newPriority.push("minimax");
    const primary = newPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      providerPriority: newPriority,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
    setZeroTokenStatuses((prev) => {
      const next = { ...prev };
      delete next[ztInfo.id];
      return next;
    });
  };

  /** 删除自定义 Provider — 第一步：触发确认 */
  const removeProvider = (provider: string) => {
    if (BUILTIN_PROVIDER_IDS.includes(provider)) return; // 内置不可删除
    setConfirmDeleteId(provider);
  };

  /** 删除自定义 Provider — 第二步：用户确认后执行删除 */
  const confirmRemoveProvider = () => {
    if (!confirmDeleteId) return;
    const newConfigs = { ...settings.providerConfigs };
    delete newConfigs[confirmDeleteId];
    const newPriority = settings.providerPriority.filter((p) => p !== confirmDeleteId);
    if (newPriority.length === 0) newPriority.push("minimax"); // 保底
    const primary = newPriority[0];
    const primaryCfg = newConfigs[primary];
    persistSettings({
      ...settings,
      providerConfigs: newConfigs,
      providerPriority: newPriority,
      aiProvider: primary,
      apiKey: primaryCfg?.apiKey || "",
      apiBaseUrl: primaryCfg?.apiBaseUrl || "",
      model: primaryCfg?.model || "",
    });
    setConfirmDeleteId(null);
  };

  const updateGlobal = (partial: Partial<UserSettings>) => {
    persistSettings({ ...settings, ...partial });
  };

  /** 获取 Provider 的显示信息 */
  const getProviderInfo = (provider: string) => {
    // 内置 Provider
    if (BUILTIN_PROVIDER_INFO[provider]) {
      return BUILTIN_PROVIDER_INFO[provider];
    }
    // 预设模板里的
    const preset = PRESET_TEMPLATES.find((p) => p.id === provider);
    if (preset) {
      return { name: preset.displayName, keyUrl: preset.keyUrl, desc: preset.desc };
    }
    // 自定义 Provider
    const config = settings.providerConfigs[provider];
    return {
      name: config?.displayName || provider,
      keyUrl: "",
      desc: "自定义 OpenAI 兼容接口",
    };
  };

  return (
    <>
      {/* 确认删除弹窗 */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#1a2744] rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">确认删除</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              确定要删除「{getProviderInfo(confirmDeleteId).name}」的模型配置吗？此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmRemoveProvider}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {saved && (
        <div className="mb-4 text-sm text-green-500 font-medium text-right">
          已保存
        </div>
      )}

      {/* Zero Token 免费模式面板 */}
      <section className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            免费模式（Zero Token）
          </h2>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          复用浏览器中已登录的 AI 网站登录态，无需 API Key 即可调用。请确保已在浏览器中登录对应平台。
        </p>

        <div className="space-y-3">
          {ZERO_TOKEN_PROVIDER_LIST.map((ztInfo) => {
            const ztKey = `zt_${ztInfo.id}`;
            const isEnabled = !!settings.providerConfigs[ztKey];
            const status = zeroTokenStatuses[ztInfo.id];

            return (
              <div
                key={ztInfo.id}
                className={`rounded-xl border p-4 transition-colors ${
                  isEnabled
                    ? "border-green-300 dark:border-green-700 bg-green-50/30 dark:bg-green-900/10"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* 左侧：信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{ztInfo.displayName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                        免费
                      </span>
                      {isEnabled && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          status === "checking" ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400" :
                          status === "logged-in" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" :
                          "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                        }`}>
                          {status === "checking" ? "检测中..." : status === "logged-in" ? "已登录" : "未登录"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{ztInfo.desc}</p>
                  </div>

                  {/* 右侧：操作按钮 */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isEnabled && (
                      <>
                        {/* 刷新登录状态 */}
                        <button
                          onClick={() => {
                            setZeroTokenStatuses((prev) => ({ ...prev, [ztInfo.id]: "checking" }));
                            checkZeroTokenLogin(ztInfo.id).then((ok) => {
                              setZeroTokenStatuses((prev) => ({
                                ...prev,
                                [ztInfo.id]: ok ? "logged-in" : "not-logged-in",
                              }));
                            });
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg transition-colors"
                          title="刷新登录状态"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        {/* 去登录 */}
                        <a
                          href={ztInfo.loginUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {status === "logged-in" ? "打开网站" : "去登录"}
                        </a>
                      </>
                    )}

                    {/* 启用/禁用开关 */}
                    <button
                      role="switch"
                      aria-checked={isEnabled}
                      onClick={() => {
                        if (isEnabled) {
                          disableZeroTokenProvider(ztInfo);
                        } else {
                          enableZeroTokenProvider(ztInfo);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isEnabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                      title={isEnabled ? "点击禁用" : "点击启用"}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          isEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* 已启用时：显示详细的登录状态 */}
                {isEnabled && status === "not-logged-in" && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      未检测到登录态。请先在浏览器中访问{" "}
                      <a href={ztInfo.loginUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        {ztInfo.domain}
                      </a>{" "}
                      并登录账号，然后点击刷新按钮重新检测。
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 模型优先级与配置 */}
      <section className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            AI 模型配置
          </h2>
          <button
            onClick={() => setShowAddPanel(!showAddPanel)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加模型
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          可同时配置多个模型的 API Key，按优先级从高到低调用。优先模型失败时自动切换到下一个。支持所有 OpenAI 兼容接口。
        </p>

        {/* 添加模型面板 */}
        {showAddPanel && (
          <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10 p-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">快速添加常用模型</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {PRESET_TEMPLATES
                .filter((p) => !settings.providerConfigs[p.id]) // 过滤已添加的
                .map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => addPresetProvider(preset)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-white dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{preset.displayName}</span>
                    <p className="text-[10px] text-gray-400 truncate">{preset.desc}</p>
                  </div>
                  <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ))}
            </div>

            {/* 自定义模型表单 */}
            <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">或手动添加自定义模型</h4>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input
                  type="text"
                  value={customForm.displayName}
                  onChange={(e) => setCustomForm({ ...customForm, displayName: e.target.value })}
                  placeholder="显示名称（如 My GPT）"
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={customForm.model}
                  onChange={(e) => setCustomForm({ ...customForm, model: e.target.value })}
                  placeholder="模型名称（如 gpt-4o）"
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={customForm.apiBaseUrl}
                  onChange={(e) => setCustomForm({ ...customForm, apiBaseUrl: e.target.value })}
                  placeholder="Base URL（如 https://api.openai.com/v1）"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowAddPanel(false); setCustomForm({ displayName: "", apiBaseUrl: "", model: "", apiKey: "", keyUrl: "" }); }}
                  className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={addCustomProvider}
                  disabled={!customForm.displayName.trim() || !customForm.apiBaseUrl.trim() || !customForm.model.trim()}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {settings.providerPriority.map((provider, index) => {
            const info = getProviderInfo(provider);
            const config = settings.providerConfigs[provider];
            const isPrimary = index === 0;
            const hasKey = !!config?.apiKey;
            const isBuiltin = BUILTIN_PROVIDER_IDS.includes(provider);
            const isZeroToken = config?.authMode === "zeroToken";

            // Zero Token 模式的卡片在独立的 "免费模式" 面板中管理，
            // 不在 AI 模型配置列表中显示
            if (isZeroToken) {
              return null;
            }

            return (
              <div
                key={provider}
                className={`rounded-xl border p-4 transition-colors ${
                  isPrimary
                    ? "border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/10"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                {/* 标题行 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{info.name}</span>
                  <span className="text-[11px] text-gray-400">{info.desc}</span>

                  <div className="ml-auto flex items-center gap-1">
                    {!isPrimary && (
                      <button
                        onClick={() => setPrimary(provider)}
                        className="px-2.5 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                      >
                        设为优先
                      </button>
                    )}
                    {!isBuiltin && (
                      <button
                        onClick={() => removeProvider(provider)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                        title="删除此模型"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* 认证模式：Kimi 支持 API Key / 免费（Cookie）模式切换 */}
                {provider === "kimi" && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">认证方式</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateProviderConfig(provider, { authMode: undefined })}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          config?.authMode !== "cookie"
                            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300"
                        }`}
                      >
                        API Key 模式
                      </button>
                      <button
                        onClick={() => updateProviderConfig(provider, { authMode: "cookie" })}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          config?.authMode === "cookie"
                            ? "border-green-400 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                            : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300"
                        }`}
                      >
                        免费模式（免 Key）
                      </button>
                    </div>
                  </div>
                )}

                {/* Cookie 免费模式：显示登录状态 */}
                {provider === "kimi" && config?.authMode === "cookie" ? (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Kimi 登录状态</label>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
                      {/* 状态指示灯 */}
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        kimiLoginStatus === "checking" ? "bg-yellow-400 animate-pulse" :
                        kimiLoginStatus === "logged-in" ? "bg-green-500" :
                        "bg-red-400"
                      }`} />
                      <span className="text-xs text-gray-600 dark:text-gray-300 flex-1">
                        {kimiLoginStatus === "checking" && "正在检测登录状态..."}
                        {kimiLoginStatus === "logged-in" && "已登录 — 可直接使用 Kimi，无需 API Key"}
                        {kimiLoginStatus === "not-logged-in" && "未检测到登录态，请先登录 Kimi"}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* 刷新检测 */}
                        <button
                          onClick={() => {
                            setKimiLoginStatus("checking");
                            checkKimiLogin().then((ok) => {
                              setKimiLoginStatus(ok ? "logged-in" : "not-logged-in");
                            });
                          }}
                          className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
                          title="刷新登录状态"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        {/* 去登录按钮 */}
                        <a
                          href="https://kimi.moonshot.cn"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {kimiLoginStatus === "logged-in" ? "打开 Kimi" : "去登录"}
                        </a>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      免费模式通过复用 Kimi 网页版的登录态调用 AI，无需 API Key。请确保已在浏览器中登录 kimi.moonshot.cn。
                    </p>
                  </div>
                ) : (
                  /* API Key 模式（默认） */
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={config?.apiKey || ""}
                        onChange={(e) => updateProviderConfig(provider, { apiKey: e.target.value })}
                        placeholder={`请输入 ${info.name} API Key`}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {info.keyUrl && (
                        <a
                          href={info.keyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors whitespace-nowrap flex items-center"
                        >
                          获取
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Base URL + Model */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Base URL</label>
                    <input
                      type="text"
                      value={config?.apiBaseUrl || ""}
                      onChange={(e) => updateProviderConfig(provider, { apiBaseUrl: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">模型</label>
                    <input
                      type="text"
                      value={config?.model || ""}
                      onChange={(e) => updateProviderConfig(provider, { model: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 免费模式提示：当 Kimi 不在模型列表中时 */}
        {!settings.providerConfigs["kimi"] && !settings.providerConfigs["zt_kimi-web"] && (
          <div className="mt-4 rounded-xl border border-dashed border-green-300 dark:border-green-700 bg-green-50/30 dark:bg-green-900/10 p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-green-700 dark:text-green-300">
                  免费使用 AI — 无需 API Key
                </h4>
                <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-1 leading-relaxed">
                  在上方的「免费模式」面板中启用 Kimi 的免费模式，通过复用浏览器登录态直接调用 AI。
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 通用参数 */}
      {/* 保存设置 */}
      <section className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">
          保存设置
        </h2>

        {/* 默认保存路径 — 预设选择 + 自定义输入 */}
        <SavePathPicker
          value={settings.savePath || ""}
          onChange={(v) => updateGlobal({ savePath: v })}
        />

        {/* 弹出对话框开关 */}
        <div className="flex items-center justify-between mt-5">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              保存时弹出文件对话框
            </p>
            <p className="text-xs text-gray-400">
              开启后每次保存都会弹出系统文件对话框，可自由选择位置
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.saveAs}
            onClick={() => updateGlobal({ saveAs: !settings.saveAs })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.saveAs
                ? "bg-blue-500"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.saveAs ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* 分割线 */}
        <div className="border-t border-gray-100 dark:border-gray-700 mt-6 mb-5" />

        {/* 知识体系设置 */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-4">知识体系自动分类</h3>

        {/* 启用开关 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">自动分类保存</p>
            <p className="text-xs text-gray-400 mt-0.5">保存文章时由 AI 推断所属分类，自动放入对应文件夹</p>
          </div>
          <button
            role="switch"
            aria-checked={settings.knowledgeSettings.enabled}
            onClick={() => updateGlobal({ knowledgeSettings: { ...settings.knowledgeSettings, enabled: !settings.knowledgeSettings.enabled } })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.knowledgeSettings.enabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${settings.knowledgeSettings.enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {settings.knowledgeSettings.enabled && (
          <>
            {/* 文件夹层数 */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                文件夹最大层数
                <span className="ml-2 text-xs font-normal text-gray-400">（当前：{settings.knowledgeSettings.maxDepth} 层）</span>
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((d) => (
                  <button
                    key={d}
                    onClick={() => updateGlobal({ knowledgeSettings: { ...settings.knowledgeSettings, maxDepth: d } })}
                    className={`px-4 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer ${
                      settings.knowledgeSettings.maxDepth === d
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700"
                        : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {d} 层
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {settings.knowledgeSettings.maxDepth === 1 && "示例：下载目录/AI技术/文章.md"}
                {settings.knowledgeSettings.maxDepth === 2 && "示例：下载目录/AI技术/提示词工程/文章.md"}
                {settings.knowledgeSettings.maxDepth === 3 && "示例：下载目录/技术/AI/提示词工程/文章.md"}
                {settings.knowledgeSettings.maxDepth === 4 && "示例：下载目录/技术/AI/应用/提示词工程/文章.md"}
                {settings.knowledgeSettings.maxDepth === 5 && "示例：下载目录/知识/技术/AI/应用/提示词/文章.md"}
              </p>
            </div>

            {/* 更新方式 */}
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">知识体系更新方式</label>
              <div className="flex gap-3">
                {([
                  { value: "auto" as const, label: "自动更新", desc: "发现新分类时立即更新" },
                  { value: "manual" as const, label: "手动确认", desc: "发现新分类时发通知，等待你确认" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateGlobal({ knowledgeSettings: { ...settings.knowledgeSettings, updateMode: opt.value } })}
                    className={`flex-1 text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                      settings.knowledgeSettings.updateMode === opt.value
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <p className={`text-sm font-medium ${settings.knowledgeSettings.updateMode === opt.value ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>



      {/* 关于 */}
      <section className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">
        <p>AI Web Clipper v2.0.0</p>
        <p className="mt-1">
          一键抓取网页内容，AI 智能总结，保存为本地 Markdown 文件
        </p>
      </section>
    </>
  );
}

// ============================================================
// Prompt 模板管理 Tab
// ============================================================

function PromptsTab() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [hiddenBuiltins, setHiddenBuiltins] = useState<PromptTemplate[]>([]);
  const [activeId, setActiveId] = useState("default");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    prompt: "",
  });
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);
  const [confirmResetBuiltinId, setConfirmResetBuiltinId] = useState<string | null>(null);
  const editFormRef = useRef<HTMLDivElement>(null);
  /** AI 优化相关状态 */
  const [optimizeInput, setOptimizeInput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    const all = await getAllTemplates();
    setTemplates(all);
    const active = await getActiveTemplate();
    setActiveId(active.id);

    // 加载被隐藏（删除）的内置模板
    const hidden = await getHiddenBuiltinTemplates();
    setHiddenBuiltins(hidden);
  };

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    await setTemplateEnabled(id, !currentEnabled);
    await loadTemplates();
  };

  const startCreate = () => {
    setFormData({ name: "", prompt: "" });
    setIsCreating(true);
    setEditingId(null);
    setOptimizeInput("");
    setOptimizeError("");
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const startEdit = (template: PromptTemplate) => {
    setFormData({
      name: template.name,
      prompt: template.prompt,
    });
    setEditingId(template.id);
    setIsCreating(false);
    setOptimizeInput("");
    setOptimizeError("");
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.prompt.trim()) return;

    if (isCreating) {
      await addCustomTemplate({ ...formData, enabled: true });
    } else if (editingId) {
      await updateTemplate(editingId, formData);
    }

    setIsCreating(false);
    setEditingId(null);
    setFormData({ name: "", prompt: "" });
    await loadTemplates();
  };

  const handleDelete = (id: string) => {
    setConfirmDeleteTemplateId(id);
  };

  const confirmDeleteTemplate = async () => {
    if (!confirmDeleteTemplateId) return;
    await removeTemplate(confirmDeleteTemplateId);
    if (editingId === confirmDeleteTemplateId) {
      setEditingId(null);
      setFormData({ name: "", prompt: "" });
    }
    setConfirmDeleteTemplateId(null);
    await loadTemplates();
  };

  const handleResetBuiltin = (id: string) => {
    setConfirmResetBuiltinId(id);
  };

  const confirmResetBuiltin = async () => {
    if (!confirmResetBuiltinId) return;
    await resetBuiltinTemplate(confirmResetBuiltinId);
    if (editingId === confirmResetBuiltinId) {
      const defaultTmpl = getBuiltinDefaultById(confirmResetBuiltinId);
      if (defaultTmpl) {
        setFormData({
          name: defaultTmpl.name,
          prompt: defaultTmpl.prompt,
        });
      }
    }
    setConfirmResetBuiltinId(null);
    await loadTemplates();
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({ name: "", prompt: "" });
    setOptimizeInput("");
    setOptimizeError("");
  };

  /** 调用 AI 优化当前 Prompt */
  const handleOptimize = async () => {
    if (!formData.prompt.trim()) {
      setOptimizeError("请先填写 System Prompt 内容");
      return;
    }
    if (!optimizeInput.trim()) {
      setOptimizeError("请输入优化要求");
      return;
    }

    setIsOptimizing(true);
    setOptimizeError("");

    try {
      const optimized = await optimizePrompt(formData.prompt, optimizeInput.trim());
      setFormData({ ...formData, prompt: optimized });
      setOptimizeInput("");
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : "优化失败，请重试");
    } finally {
      setIsOptimizing(false);
    }
  };

  const renderEditForm = () => (
    <div ref={editFormRef} className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-blue-200 dark:border-blue-700 p-5 mb-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {isCreating ? "新建模板" : "编辑模板"}
        </h3>
        {editingId && !isCreating && (() => {
          const tmpl = templates.find(t => t.id === editingId);
          return tmpl?.isBuiltin;
        })() && (
          <button
            onClick={() => handleResetBuiltin(editingId)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            恢复默认
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            模板名称
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="如：技术文章总结"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            System Prompt
          </label>
          <textarea
            value={formData.prompt}
            onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
            placeholder="输入 AI 系统提示词..."
            rows={8}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono text-xs leading-relaxed"
          />
        </div>

        {/* AI 优化 Prompt */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI 优化 Prompt
            </span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={optimizeInput}
              onChange={(e) => { setOptimizeInput(e.target.value); setOptimizeError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isOptimizing && optimizeInput.trim() && formData.prompt.trim()) {
                  e.preventDefault();
                  handleOptimize();
                }
              }}
              placeholder="输入优化要求，如：更简洁、增加对代码块的处理、输出格式改为表格..."
              disabled={isOptimizing}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            />
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || !optimizeInput.trim() || !formData.prompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
            >
              {isOptimizing ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  优化中...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  AI 优化
                </>
              )}
            </button>
          </div>
          {optimizeError && (
            <p className="text-xs text-red-500 mt-1">{optimizeError}</p>
          )}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
            输入优化要求后点击「AI 优化」，将调用已配置的 AI 模型自动改进上方的 Prompt
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={handleCancel}
            className="px-4 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!formData.name.trim() || !formData.prompt.trim()}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* 确认删除模板弹窗 */}
      {confirmDeleteTemplateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#1a2744] rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">确认删除</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              确定要删除「{templates.find(t => t.id === confirmDeleteTemplateId)?.name || "此模板"}」吗？此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteTemplateId(null)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDeleteTemplate}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认恢复内置模板弹窗 */}
      {confirmResetBuiltinId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-[#1a2744] rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">确认恢复</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              确定要恢复「{templates.find(t => t.id === confirmResetBuiltinId)?.name || "此模板"}」为默认内容吗？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmResetBuiltinId(null)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmResetBuiltin}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors"
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 模板列表 */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Prompt 模板
        </h2>
        <button
          onClick={startCreate}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建模板
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        启用开关控制模板是否在扩展弹窗和侧边栏中显示。关闭后模板仍保留，可随时重新启用。
      </p>

      {/* 新建模板时，表单显示在列表顶部 */}
      {isCreating && renderEditForm()}

      {/* 模板卡片列表 */}
      <div className="space-y-3">
        {templates.map((tmpl) => (
          <div key={tmpl.id}>
            <div
              className={`bg-white dark:bg-[#16213e] rounded-xl shadow-sm border p-4 transition-colors ${
                tmpl.enabled
                  ? "border-gray-200 dark:border-gray-700"
                  : "border-gray-200 dark:border-gray-700 opacity-60"
              }`}
            >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-semibold ${tmpl.enabled ? "text-gray-800 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}>
                    {tmpl.name}
                  </h3>
                  {tmpl.isBuiltin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      内置
                    </span>
                  )}
                  {!tmpl.isBuiltin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                      自定义
                    </span>
                  )}
                </div>
                {tmpl.description && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {tmpl.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* 启用/禁用开关 */}
                <button
                  role="switch"
                  aria-checked={tmpl.enabled}
                  onClick={() => handleToggleEnabled(tmpl.id, tmpl.enabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    tmpl.enabled
                      ? "bg-blue-500"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                  title={tmpl.enabled ? "点击禁用" : "点击启用"}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      tmpl.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>
                {/* 编辑按钮 */}
                <button
                  onClick={() => startEdit(tmpl)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                  title="编辑"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* 内置模板显示恢复按钮 */}
                {tmpl.isBuiltin && (
                  <button
                    onClick={() => handleResetBuiltin(tmpl.id)}
                    className="p-1 text-gray-400 hover:text-amber-600 dark:hover:text-amber-300 rounded transition-colors"
                    title="恢复默认"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                )}
                {/* 删除按钮 */}
                <button
                  onClick={() => handleDelete(tmpl.id)}
                  className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                  title="删除"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
            </div>

            {/* 编辑表单紧跟在被编辑的模板卡片下方 */}
            {editingId === tmpl.id && !isCreating && renderEditForm()}
          </div>
        ))}
      </div>


    </div>
  );
}

// ============================================================
// 历史记录 Tab
// ============================================================

function HistoryTab() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await getHistory();
    setHistory(data);
  };

  const handleDelete = async (id: string) => {
    await removeHistoryEntry(id);
    await loadHistory();
  };

  const handleClearAll = async () => {
    if (!confirm("确定要清空所有历史记录吗？此操作不可撤销。")) return;
    await clearHistory();
    setHistory([]);
  };

  // 收集所有标签
  const allTags = Array.from(
    new Set(history.flatMap((h) => h.summary.tags))
  ).sort();

  // 筛选
  const filtered = history.filter((entry) => {
    const matchesSearch =
      !searchQuery ||
      entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.summary.oneLiner.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTag =
      !filterTag || entry.summary.tags.includes(filterTag);

    return matchesSearch && matchesTag;
  });

  const formatSavedAt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div>
      {/* 搜索和筛选 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索标题、URL 或摘要..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 标签筛选 */}
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">所有标签</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        )}

        {/* 清空全部 */}
        {history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors whitespace-nowrap"
          >
            清空全部
          </button>
        )}
      </div>

      {/* 统计 */}
      <p className="text-xs text-gray-400 mb-3">
        共 {history.length} 条记录
        {filtered.length !== history.length && `，已筛选 ${filtered.length} 条`}
      </p>

      {/* 历史记录列表 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm text-gray-400">
            {history.length === 0 ? "还没有保存过任何文章" : "没有匹配的记录"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* 摘要行 */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {entry.title}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {entry.summary.oneLiner}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-gray-400">
                      {formatSavedAt(entry.savedAt)}
                    </span>
                    {entry.summary.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {entry.downloadId && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          // 先查询下载记录是否还存在
                          const results = await chrome.downloads.search({ id: entry.downloadId! });
                          if (results.length > 0 && results[0].exists !== false) {
                            // 尝试直接打开文件
                            try {
                              await chrome.downloads.open(entry.downloadId!);
                            } catch {
                              // open 失败时，退而求其次在文件管理器中显示
                              chrome.downloads.show(entry.downloadId!);
                            }
                          } else {
                            alert("文件已被移动或删除，无法打开");
                          }
                        } catch {
                          // downloadId 已失效（浏览器重启等情况）
                          alert("下载记录已过期，无法定位文件。请在下载目录中手动查找。");
                        }
                      }}
                      className="p-1 text-gray-400 hover:text-green-500 rounded transition-colors"
                      title="打开文件"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                  )}
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
                    title="打开原文"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry.id);
                    }}
                    className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="删除"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      expandedId === entry.id ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* 展开详情 */}
              {expandedId === entry.id && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        核心要点：
                      </span>
                      <ul className="mt-1 space-y-1">
                        {entry.summary.keyPoints.map((p, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs"
                          >
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-blue-500 flex-shrink-0" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        详细总结：
                      </span>
                      <p className="text-xs mt-1 leading-relaxed text-gray-600 dark:text-gray-300">
                        {entry.summary.detailedSummary}
                      </p>
                    </div>
                    <div className="pt-1">
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline break-all"
                      >
                        {entry.url}
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 知识体系 Tab
// ============================================================

function KnowledgeTab() {
  const [tree, setTree] = useState<KnowledgeTreeSnapshot>({ roots: [], updatedAt: "" });
  const [proposal, setProposal] = useState<KnowledgeUpdateProposal | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  /** 已展开的文件夹路径 key → 文件列表是否可见 */
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  /** 所有历史记录 */
  const [histories, setHistories] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    (async () => {
      const t = await getKnowledgeTree();
      setTree(t);
      const p = await getPendingProposal();
      setProposal(p);
      // 加载历史记录用于文件列表展示
      const h = await getHistory();
      setHistories(h);
    })();
  }, []);

  /** 根据文件夹路径数组精确匹配历史记录（只匹配直接父目录，不含子文件夹冒泡） */
  const getFilesInPath = (path: string[]): HistoryEntry[] => {
    return histories.filter((h) => {
      if (!h.savedPath) return false;
      // savedPath 示例：AI笔记/本地生活/酒店住宿/文章标题.md
      const parts = h.savedPath.split("/");
      parts.pop(); // 去掉文件名，剩余是目录段数组：["AI笔记","本地生活","酒店住宿"]
      // 精确匹配：目录段数组的末尾连续段 === path
      // 即 parts 末尾恰好等于 path（文件直接在该文件夹下，不是子文件夹）
      if (parts.length < path.length) return false;
      const tail = parts.slice(parts.length - path.length);
      return tail.every((seg, j) => seg === path[j]);
    });
  };

  /** 切换文件夹展开/收起 */
  const toggleExpand = (pathKey: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) { next.delete(pathKey); } else { next.add(pathKey); }
      return next;
    });
  };

  /** 打开文件：优先用 downloadId，fallback 到打开 URL */
  const openFile = async (entry: HistoryEntry) => {
    if (entry.downloadId) {
      try {
        await chrome.downloads.show(entry.downloadId);
        return;
      } catch { /* fallback */ }
    }
    chrome.tabs.create({ url: entry.url });
  };

  /** 删除文件：本地文件 + 历史记录，并从文件列表中移除 */
  const handleDeleteFile = async (entry: HistoryEntry) => {
    if (!confirm(`确认删除「${entry.title}」？\n本地文件和记录将一并删除，此操作不可恢复。`)) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: MessageType.DELETE_KNOWLEDGE_FILE,
        payload: { historyId: entry.id, downloadId: entry.downloadId },
      });
      if (res?.success) {
        // 从本地 state 中移除
        setHistories((prev) => prev.filter((h) => h.id !== entry.id));
        showToast("文件已删除");
      } else {
        showToast(res?.error || "删除失败");
      }
    } catch {
      showToast("删除失败，请重试");
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const handleApplyProposal = async () => {
    if (!proposal) return;
    try {
      await chrome.runtime.sendMessage({ type: MessageType.APPLY_KNOWLEDGE_PROPOSAL });
      const updated = await getKnowledgeTree();
      setTree(updated);
      setProposal(null);
      showToast("知识体系已更新");
    } catch {
      showToast("操作失败，请重试");
    }
  };

  const handleDismissProposal = async () => {
    await chrome.runtime.sendMessage({ type: MessageType.DISMISS_KNOWLEDGE_PROPOSAL });
    setProposal(null);
    showToast("已忽略本次更新");
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      // Fire-and-forget：立即返回，后台异步执行
      chrome.runtime.sendMessage({ type: MessageType.REBUILD_KNOWLEDGE_TREE }).catch(() => {});
      showToast("正在后台重建，完成后会收到通知");

      // 轮询知识树是否更新（最多等 120 秒，每 3 秒检查一次）
      const startTime = Date.now();
      const currentUpdatedAt = tree.updatedAt;
      const poll = async () => {
        const updated = await getKnowledgeTree();
        if (updated.updatedAt !== currentUpdatedAt) {
          setTree(updated);
          const h = await getHistory();
          setHistories(h);
          await clearPendingProposal();
          setProposal(null);
          setRebuilding(false);
          showToast("知识体系重建完成");
          return;
        }
        if (Date.now() - startTime < 120_000) {
          setTimeout(poll, 3000);
        } else {
          setRebuilding(false);
        }
      };
      setTimeout(poll, 3000);
    } catch {
      showToast("操作失败，请重试");
      setRebuilding(false);
    }
  };

  /** 用 File System Access API 扫描用户选择的目录，从真实文件重建知识体系 */
  const handleScanDirectory = async () => {
    setSyncing(true);
    try {
      // 1. 让用户选择保存根目录（需要用户手势触发，在 options 页面可以使用）
      const dirHandle = await (window as any).showDirectoryPicker({ mode: "read" });

      // 2. 递归扫描目录，收集所有 .md 文件的路径信息
      interface FileEntry { name: string; path: string[]; handle: FileSystemFileHandle }
      const allFiles: FileEntry[] = [];

      async function scanDir(handle: FileSystemDirectoryHandle, pathParts: string[]) {
        for await (const [name, entry] of (handle as any).entries()) {
          if (entry.kind === "directory") {
            await scanDir(entry as FileSystemDirectoryHandle, [...pathParts, name]);
          } else if (entry.kind === "file" && name.endsWith(".md")) {
            allFiles.push({ name, path: pathParts, handle: entry as FileSystemFileHandle });
          }
        }
      }

      await scanDir(dirHandle, []);

      if (allFiles.length === 0) {
        showToast("该目录下没有找到 .md 文件");
        setSyncing(false);
        return;
      }

      // 3. 从文件路径构建知识树
      const roots: import("@/lib/types").KnowledgeNode[] = [];
      for (const f of allFiles) {
        if (f.path.length === 0) continue; // 根目录直接的文件，不建文件夹
        let cur = roots;
        for (const seg of f.path) {
          let node = cur.find((n) => n.name === seg);
          if (!node) { node = { name: seg, children: [] }; cur.push(node); }
          cur = node.children;
        }
      }

      // 4. 保存新知识树
      const newTree: KnowledgeTreeSnapshot = { roots, updatedAt: new Date().toISOString() };
      await saveKnowledgeTree(newTree);

      // 5. 更新历史记录的 savedPath（匹配文件名）
      const settings = await chrome.storage.sync.get({ savePath: "" });
      const baseSavePath = (settings.savePath as string) || "";
      const currentHistories = await getHistory();
      let updatedCount = 0;

      for (const entry of currentHistories) {
        // 通过文件名在扫描结果中查找对应文件
        const expectedFileName = entry.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200) + ".md";
        const matched = allFiles.find((f) =>
          f.name === expectedFileName ||
          f.name.replace(/\.md$/, "") === entry.title
        );
        if (!matched) continue;

        // 构造新的相对路径（相对于下载根目录）
        const newSavedPath = baseSavePath
          ? [baseSavePath, ...matched.path, matched.name].join("/")
          : [...matched.path, matched.name].join("/");

        if (entry.savedPath !== newSavedPath) {
          // 更新历史记录（先删再加）
          const { removeHistoryEntry, addHistoryEntry } = await import("@/lib/storage/history");
          await removeHistoryEntry(entry.id);
          await addHistoryEntry({ ...entry, savedPath: newSavedPath });
          updatedCount++;
        }
      }

      setTree(newTree);
      const h = await getHistory();
      setHistories(h);
      showToast(`扫描完成：发现 ${allFiles.length} 个文件，更新 ${updatedCount} 条记录`);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        showToast("已取消选择");
      } else {
        showToast("扫描失败：" + (err instanceof Error ? err.message : "未知错误"));
      }
    } finally {
      setSyncing(false);
    }
  };

  /** 刷新：重新从 storage 加载知识树和历史记录，不做任何写操作 */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [t, p, h] = await Promise.all([
        getKnowledgeTree(),
        getPendingProposal(),
        getHistory(),
      ]);
      setTree(t);
      setProposal(p);
      setHistories(h);
      showToast("已刷新");
    } catch {
      showToast("刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeletePath = async (pathStr: string) => {
    const pathArr = pathStr.split(" > ");
    const roots: typeof tree.roots = JSON.parse(JSON.stringify(tree.roots));

    const removeNode = (nodes: typeof roots, parts: string[]): boolean => {
      if (!parts.length) return false;
      const [head, ...rest] = parts;
      const idx = nodes.findIndex((n) => n.name === head);
      if (idx === -1) return false;
      if (!rest.length) { nodes.splice(idx, 1); return true; }
      return removeNode(nodes[idx].children, rest);
    };

    removeNode(roots, pathArr);
    const updated = { roots, updatedAt: new Date().toISOString() };
    await saveKnowledgeTree(updated);
    setTree(updated);
    showToast("已删除该分类");
  };

  const paths = flattenTree(tree.roots);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-gray-800/90 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}

      {/* 待确认提案 */}
      {proposal && proposal.additions.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700 p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-800 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">待确认的知识体系更新</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                发现以下新分类，来自文章「{proposal.triggerTitle}」
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {proposal.additions.map((path, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-600">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {path.join(" > ")}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleApplyProposal} className="px-4 py-1.5 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors cursor-pointer">
              确认加入
            </button>
            <button onClick={handleDismissProposal} className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors cursor-pointer">
              忽略
            </button>
          </div>
        </section>
      )}

      {/* 当前知识树展示 */}
      <section className="bg-white dark:bg-[#16213e] rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">当前知识体系</h2>
            {tree.updatedAt && (
              <p className="text-xs text-gray-400 mt-0.5">最后更新：{new Date(tree.updatedAt).toLocaleString("zh-CN")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 扫描目录：用 File System Access API 直接读取本地文件夹 */}
            <button
              onClick={handleScanDirectory}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="选择保存目录，直接扫描本地文件重建知识体系（最准确）"
            >
              {syncing ? (
                <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              )}
              {syncing ? "扫描中..." : "扫描目录"}
            </button>
          </div>
        </div>

        {paths.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-sm">暂无知识体系</p>
            <p className="text-xs mt-1">保存文章后自动生成，或点击「手动重建」</p>
          </div>
        ) : (
          <div className="space-y-1">
            {paths.map((path, i) => {
              const depth = path.length - 1;
              const pathKey = path.join(" > ");
              const filesInFolder = getFilesInPath(path);
              const isExpanded = expandedPaths.has(pathKey);
              return (
                <div key={i}>
                  {/* 文件夹行 */}
                  <div
                    className="flex items-center justify-between group rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ paddingLeft: `${12 + depth * 20}px` }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {depth > 0 && <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 text-xs">└</span>}
                      {/* 展开/收起按钮（有文件时才显示） */}
                      {filesInFolder.length > 0 ? (
                        <button
                          onClick={() => toggleExpand(pathKey)}
                          className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                        >
                          <svg
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                      <svg className="w-3.5 h-3.5 flex-shrink-0 text-blue-400 dark:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{path[path.length - 1]}</span>
                      {/* 文件数量徽章 */}
                      {filesInFolder.length > 0 && (
                        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 border border-blue-100 dark:border-blue-800">
                          {filesInFolder.length}
                        </span>
                      )}
                    </div>
                    {/* 操作按钮（删除） */}
                    <button
                      onClick={() => handleDeletePath(pathKey)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all cursor-pointer flex-shrink-0"
                      title="删除此分类"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* 文件列表（展开时显示） */}
                  {isExpanded && filesInFolder.length > 0 && (
                    <div
                      className="space-y-0.5 mb-1"
                      style={{ paddingLeft: `${12 + depth * 20 + 44}px` }}
                    >
                      {filesInFolder.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between group/file rounded-md px-2 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {/* 文件图标 */}
                            <svg className="w-3 h-3 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0" title={entry.title}>
                              {entry.title}
                            </span>
                            <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">
                              {new Date(entry.savedAt).toLocaleDateString("zh-CN")}
                            </span>
                          </div>
                          {/* 操作按钮 */}
                          <div className="opacity-0 group-hover/file:opacity-100 flex items-center gap-1 transition-all flex-shrink-0">
                            <button
                              onClick={() => openFile(entry)}
                              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded text-blue-500 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors cursor-pointer"
                              title="在文件管理器中显示文件"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              打开
                            </button>
                            <button
                              onClick={() => handleDeleteFile(entry)}
                              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded text-red-400 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                              title="删除本地文件和记录"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
