// ============================================================
// AI Prompt 模板 — 兼容旧代码的导出
// ============================================================

import { BUILTIN_TEMPLATES } from "../storage/prompts";

/**
 * 默认的系统 Prompt（从内置模板中获取）
 */
export const DEFAULT_SYSTEM_PROMPT = BUILTIN_TEMPLATES[0].prompt;
