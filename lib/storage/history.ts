// ============================================================
// 存储管理 — 设置 & 历史记录
// ============================================================

import type { HistoryEntry, UserSettings } from "../types";

// -------------------- 历史记录 --------------------

const HISTORY_KEY = "clipper_history";

/**
 * 获取所有历史记录
 */
export async function getHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return (result[HISTORY_KEY] as HistoryEntry[]) || [];
}

/**
 * 新增一条历史记录（插入到头部）
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const history = await getHistory();
  history.unshift(entry);
  // 最多保留 500 条
  if (history.length > 500) {
    history.length = 500;
  }
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

/**
 * 删除一条历史记录
 */
export async function removeHistoryEntry(id: string): Promise<void> {
  const history = await getHistory();
  const filtered = history.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: filtered });
}

/**
 * 清空所有历史记录
 */
export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
