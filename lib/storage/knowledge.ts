// ============================================================
// 知识体系存储 — 知识树快照 + 待确认提案
// ============================================================

import type {
  KnowledgeTreeSnapshot,
  KnowledgeUpdateProposal,
  KnowledgeNode,
  KnowledgeSettings,
} from "../types";

const TREE_KEY = "knowledgeTreeSnapshot";
const PROPOSAL_KEY = "knowledgePendingProposal";

/** 默认知识体系设置 */
export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  enabled: true,
  maxDepth: 2,
  updateMode: "auto",
};

// --------------------------------------------------
// 知识树快照
// --------------------------------------------------

/** 读取当前知识树快照，不存在时返回空树 */
export async function getKnowledgeTree(): Promise<KnowledgeTreeSnapshot> {
  try {
    const result = await chrome.storage.local.get(TREE_KEY);
    const snap = result[TREE_KEY] as KnowledgeTreeSnapshot | undefined;
    return snap ?? { roots: [], updatedAt: new Date().toISOString() };
  } catch {
    return { roots: [], updatedAt: new Date().toISOString() };
  }
}

/** 保存知识树快照 */
export async function saveKnowledgeTree(tree: KnowledgeTreeSnapshot): Promise<void> {
  await chrome.storage.local.set({ [TREE_KEY]: tree });
}

/**
 * 将一条路径（如 ["AI技术", "提示词工程"]）合并进现有知识树。
 * 如果路径已存在则幂等，否则新建节点。
 * 返回是否发生了新增（true = 有变更）。
 */
export function mergePath(roots: KnowledgeNode[], path: string[]): boolean {
  if (!path.length) return false;
  let changed = false;
  let current = roots;

  for (const segment of path) {
    let node = current.find((n) => n.name === segment);
    if (!node) {
      node = { name: segment, children: [] };
      current.push(node);
      changed = true;
    }
    current = node.children;
  }
  return changed;
}

/**
 * 将路径数组批量合并进知识树。
 * 返回实际新增的路径数组（已存在的过滤掉）。
 */
export function mergePathsIntoTree(
  snapshot: KnowledgeTreeSnapshot,
  paths: string[][]
): { snapshot: KnowledgeTreeSnapshot; newPaths: string[][] } {
  const roots = JSON.parse(JSON.stringify(snapshot.roots)) as KnowledgeNode[];
  const newPaths: string[][] = [];

  for (const path of paths) {
    const changed = mergePath(roots, path);
    if (changed) newPaths.push(path);
  }

  return {
    snapshot: { roots, updatedAt: new Date().toISOString() },
    newPaths,
  };
}

/**
 * 将知识树节点展平为路径列表（用于 UI 展示）。
 * 例：[["AI技术"], ["AI技术", "提示词工程"], ["产品设计"]]
 */
export function flattenTree(roots: KnowledgeNode[], prefix: string[] = []): string[][] {
  const result: string[][] = [];
  for (const node of roots) {
    const path = [...prefix, node.name];
    result.push(path);
    result.push(...flattenTree(node.children, path));
  }
  return result;
}

/**
 * 根据路径查找节点，找到则返回节点，否则返回 undefined
 */
export function findNode(roots: KnowledgeNode[], path: string[]): KnowledgeNode | undefined {
  if (!path.length) return undefined;
  const [head, ...rest] = path;
  const node = roots.find((n) => n.name === head);
  if (!node) return undefined;
  if (!rest.length) return node;
  return findNode(node.children, rest);
}

/**
 * 根据分类路径构造实际下载文件名前缀。
 * 例如 basePath="AI笔记", path=["AI技术", "提示词工程"] → "AI笔记/AI技术/提示词工程"
 */
export function buildFilePath(basePath: string, classPath: string[]): string {
  const parts = basePath ? [basePath.replace(/\/+$/, ""), ...classPath] : [...classPath];
  return parts.join("/");
}

// --------------------------------------------------
// 待确认提案
// --------------------------------------------------

/** 读取待确认的提案（不存在返回 null） */
export async function getPendingProposal(): Promise<KnowledgeUpdateProposal | null> {
  try {
    const result = await chrome.storage.local.get(PROPOSAL_KEY);
    return (result[PROPOSAL_KEY] as KnowledgeUpdateProposal) ?? null;
  } catch {
    return null;
  }
}

/** 保存待确认提案 */
export async function savePendingProposal(proposal: KnowledgeUpdateProposal): Promise<void> {
  await chrome.storage.local.set({ [PROPOSAL_KEY]: proposal });
}

/** 清除待确认提案 */
export async function clearPendingProposal(): Promise<void> {
  await chrome.storage.local.remove(PROPOSAL_KEY);
}
