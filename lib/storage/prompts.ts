// ============================================================
// Prompt 模板管理
// ============================================================

import type { PromptTemplate } from "../types";

// -------------------- 内置模板 --------------------

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "default",
    name: "快速总结",
    description: "一句话核心结论 + 3-5个关键要点，快速掌握文章精华",
    prompt: `请对以下内容进行高度精炼的总结。

要求：
1. 先用一句话概括全文核心结论
2. 再用 3-5 个要点列出关键信息，每个要点不超过两句话
3. 如文中有具体数据、时间、人名等关键事实，务必保留
4. 严格基于原文，不添加任何外部信息或个人推测
5. 输出语言与原文保持一致`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "summary-full",
    name: "高度总结 + 保留原文",
    description: "200-300字摘要 + 完整保留原文内容，适合存档收藏",
    prompt: `请对以下文章进行"总结 + 原文精华摘录"的双层处理。

## 输出要求

### 一、全文摘要
用 200-300 字概括文章的核心主题、主要论点和关键结论。

### 二、原文内容
**完整保留原文全部内容，不做任何删减、改写或总结。**
直接输出原文的完整文本，确保：
- 段落结构与原文章节一一对应
- 所有数据、引用、案例完整保留
- 专业术语保持原样（如 AI、LLM、RAG 等）
- 不添加个人解读或评论`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "translate-zh",
    name: "全文翻译",
    description: "将英文内容翻译为地道流畅的中文，保留原文格式和专业术语",
    prompt: `请将以下英文内容翻译为地道流畅的中文。

翻译要求：
1. 翻译风格：准确、通顺、自然，符合中文表达习惯，避免"翻译腔"
2. 专业术语处理：首次出现时使用"中文译名（English Term）"格式，后续直接使用中文译名
3. 保留原文的段落结构和格式（标题、列表、代码块等）
4. 对于无通用中文译名的专有名词和技术术语，保留英文原文
5. 代码、命令行、URL 等不翻译，保持原样
6. 数字、日期格式按中文习惯调整

注意：所有输出必须为简体中文。`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "translate-academic",
    name: "学术论文翻译",
    description: "学术领域专业翻译，保持严谨性，术语采用公认译法",
    prompt: `请将以下英文学术内容翻译为中文。

特殊要求：
1. 学术术语采用该领域公认的中文译法，首次出现标注英文原文
2. 数学公式和变量符号保持原样
3. 参考文献编号和引用格式保持不变
4. 保持学术文体的严谨性和准确性
5. "we"统一译为"本文"或按语境处理，不译为"我们"

注意：所有输出必须为简体中文。`,
    isBuiltin: true,
    enabled: false,
  },
  {
    id: "translate-parallel",
    name: "对照翻译",
    description: "逐段对照翻译，英文原文与中文翻译并排展示",
    prompt: `请对以下内容进行逐段对照翻译。每一段先展示英文原文，紧接其下方展示中文翻译，用水平线分隔各段。

格式示例：
> [原文段落]

[中文翻译]

---

翻译要求：
1. 逐段对应，不合并或拆分段落
2. 翻译准确流畅，避免翻译腔
3. 专业术语首次出现标注英文原文`,
    isBuiltin: true,
    enabled: false,
  },
  {
    id: "tech",
    name: "技术文章精读",
    description: "深度拆解技术方案、架构设计、代码分析和实践要点",
    prompt: `请对以下技术文章进行深度精读分析。

## 输出格式

### 一、文章元信息
- 文章主题：
- 技术领域：
- 目标读者：
- 前置知识要求：

### 二、核心结论（TL;DR）
用 2-3 句话概括文章最核心的技术观点或方案。

### 三、技术要点深度拆解
对文章中的每个核心技术点进行拆解：
- **是什么**：用通俗语言解释该技术概念
- **为什么**：这个技术选型或设计决策背后的原因
- **怎么做**：关键实现步骤或架构思路
- **注意事项**：文中提到的坑、限制或最佳实践

### 四、代码/架构分析（如有）
对文中出现的关键代码片段或架构图进行逐块解读。

### 五、与已有方案的对比
该方案相比其他常见方案的优势和劣势是什么？

### 六、实践清单
基于本文内容，列出 3-5 个可以直接在项目中尝试的行动项。

### 七、延伸阅读建议
基于本文涉及的技术栈，推荐可以进一步学习的方向。

要求：
- 保留所有技术术语的英文原文
- 如遇到缩写词，在首次出现时给出全称和解释
- 对文中未充分解释的概念，补充简要说明
- 输出语言与原文保持一致`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "academic",
    name: "学术论文辅助阅读",
    description: "系统性分析论文的研究问题、方法论、实验结果和批判性评估",
    prompt: `请对以下论文内容进行系统性的阅读辅助分析。

## 输出格式

### 一、论文概览
- 研究问题：本文试图解决什么问题？
- 核心贡献：本文最主要的 1-3 个贡献是什么？
- 研究方法：采用了什么方法论？

### 二、背景与动机
- 该研究领域的现状是什么？
- 现有方法存在什么不足？
- 本文的切入点和创新之处？

### 三、方法论详解
用通俗但准确的语言解释本文提出的方法/模型/算法：
- 整体框架是什么？
- 关键步骤和组件有哪些？
- 有哪些重要的假设或约束条件？

### 四、实验与结果
- 使用了哪些数据集和评估指标？
- 关键实验结果是什么？（保留具体数字）
- 与 baseline 的对比表现如何？
- 消融实验揭示了什么？

### 五、批判性分析
- 方法的局限性有哪些？（作者承认的 + 你发现的）
- 实验设计是否充分？有无明显遗漏？
- 结论是否被实验结果充分支撑？

### 六、对该领域的影响
- 这篇论文对该领域的发展有什么潜在影响？
- 可能的后续研究方向有哪些？

要求：
- 所有专业术语保留英文原文
- 保留关键数据和实验结果的精确数字
- 分析要客观中立，既肯定贡献也指出不足
- 输出语言与原文保持一致`,
    isBuiltin: true,
    enabled: false,
  },
  {
    id: "deep-questions",
    name: "深度追问清单",
    description: "生成5个有深度的追问问题，帮助深入理解和批判性思考",
    prompt: `阅读以下内容后，帮我生成 5 个有深度的追问问题，这些问题应该：
1. 指向文章中未充分展开但值得深入探讨的话题
2. 挑战文章中的某些假设或结论
3. 探索文章论点的实际应用场景
4. 帮助我更深入地理解这个主题

要求：
- 每个问题都要有针对性，不要泛泛而谈
- 问题应该能引发思考，而非简单的信息查找
- 至少有一个问题挑战文章的核心观点
- 输出语言与原文保持一致`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "key-info",
    name: "关键信息提取",
    description: "从产品对比、招聘信息、政策文件等提取结构化数据",
    prompt: `请从以下内容中提取关键信息，整理为结构化的表格或列表格式。

提取要求：
1. 识别内容中的核心实体（产品名、公司名、人名、日期等）
2. 提取关键数据点（价格、数量、比例、期限等）
3. 梳理条件或条款（如有）
4. 对比信息整理为表格形式（如适用）
5. 标注不确定或模糊的信息

输出格式：优先使用 Markdown 表格，辅以简要说明。
输出语言：与原文保持一致。`,
    isBuiltin: true,
    enabled: true,
  },
  {
    id: "fact-check",
    name: "观点分析与事实核查",
    description: "识别立场偏向、区分事实与观点、评估论证质量",
    prompt: `请对以下内容进行客观的观点分析和事实核查。

## 输出格式

### 一、内容概述
简要说明文章的主题和核心主张。

### 二、事实 vs 观点分离
将文中的陈述分为两类：
- **事实性陈述**：可被验证的客观事实（标注是否准确，如能判断的话）
- **观点性陈述**：作者的主观判断、解读或推测

### 三、立场与偏向分析
- 作者/来源的可能立场是什么？
- 文中使用了哪些带有情感倾向的表述？
- 是否存在选择性呈现信息的情况？

### 四、论证质量评估
- 主要论据是否充分支撑了结论？
- 是否存在常见的逻辑谬误？（如稻草人论证、滑坡谬误、诉诸权威等）
- 有哪些对立观点被忽略了？

### 五、综合评价
对该内容的可信度给出评价（高/中/低），并说明理由。

输出语言：与原文保持一致。`,
    isBuiltin: true,
    enabled: false,
  },
];

// -------------------- 存储 Key --------------------

const CUSTOM_TEMPLATES_KEY = "clipper_custom_prompts";
const BUILTIN_OVERRIDES_KEY = "clipper_builtin_overrides";
const HIDDEN_BUILTINS_KEY = "clipper_hidden_builtins";
const ACTIVE_PROMPT_KEY = "activePromptId";
const TEMPLATE_ENABLED_KEY = "clipper_template_enabled";

// -------------------- 模板启用/禁用 --------------------

/**
 * 获取模板的启用状态覆写（用户手动切换后的状态）
 * 返回 Record<templateId, boolean>
 */
async function getEnabledOverrides(): Promise<Record<string, boolean>> {
  const result = await chrome.storage.local.get(TEMPLATE_ENABLED_KEY);
  return (result[TEMPLATE_ENABLED_KEY] as Record<string, boolean>) || {};
}

/**
 * 设置模板的启用/禁用状态
 */
export async function setTemplateEnabled(id: string, enabled: boolean): Promise<void> {
  const overrides = await getEnabledOverrides();
  overrides[id] = enabled;
  await chrome.storage.local.set({ [TEMPLATE_ENABLED_KEY]: overrides });
}

/**
 * 获取模板的实际启用状态（覆写 > 默认值）
 */
async function getTemplateEnabledState(id: string, defaultEnabled: boolean): Promise<boolean> {
  const overrides = await getEnabledOverrides();
  if (id in overrides) return overrides[id];
  return defaultEnabled;
}

// -------------------- 内置模板隐藏（删除） --------------------

/**
 * 获取被隐藏（删除）的内置模板 ID 列表
 */
async function getHiddenBuiltins(): Promise<string[]> {
  const result = await chrome.storage.local.get(HIDDEN_BUILTINS_KEY);
  return (result[HIDDEN_BUILTINS_KEY] as string[]) || [];
}

/**
 * 隐藏（删除）一个内置模板
 */
async function hideBuiltinTemplate(id: string): Promise<void> {
  const hidden = await getHiddenBuiltins();
  if (!hidden.includes(id)) {
    hidden.push(id);
    await chrome.storage.local.set({ [HIDDEN_BUILTINS_KEY]: hidden });
  }
}

/**
 * 恢复一个被隐藏的内置模板
 */
export async function restoreBuiltinTemplate(id: string): Promise<void> {
  const hidden = await getHiddenBuiltins();
  const filtered = hidden.filter((h) => h !== id);
  await chrome.storage.local.set({ [HIDDEN_BUILTINS_KEY]: filtered });
}

/**
 * 获取被隐藏的内置模板列表（用于 UI 显示可恢复的模板）
 */
export async function getHiddenBuiltinTemplates(): Promise<PromptTemplate[]> {
  const hidden = await getHiddenBuiltins();
  return BUILTIN_TEMPLATES.filter((t) => hidden.includes(t.id));
}

// -------------------- 内置模板覆写 --------------------

/** 内置模板覆写数据（用户编辑后的版本） */
interface BuiltinOverride {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
}

/**
 * 获取内置模板的覆写数据
 */
async function getBuiltinOverrides(): Promise<BuiltinOverride[]> {
  const result = await chrome.storage.local.get(BUILTIN_OVERRIDES_KEY);
  return (result[BUILTIN_OVERRIDES_KEY] as BuiltinOverride[]) || [];
}

/**
 * 保存内置模板的覆写数据
 */
async function saveBuiltinOverride(override: BuiltinOverride): Promise<void> {
  const overrides = await getBuiltinOverrides();
  const index = overrides.findIndex((o) => o.id === override.id);
  if (index >= 0) {
    overrides[index] = override;
  } else {
    overrides.push(override);
  }
  await chrome.storage.local.set({ [BUILTIN_OVERRIDES_KEY]: overrides });
}

/**
 * 删除内置模板的覆写（恢复默认）
 */
export async function resetBuiltinTemplate(id: string): Promise<void> {
  const overrides = await getBuiltinOverrides();
  const filtered = overrides.filter((o) => o.id !== id);
  await chrome.storage.local.set({ [BUILTIN_OVERRIDES_KEY]: filtered });
}

/**
 * 判断内置模板是否被用户修改过
 */
export async function isBuiltinModified(id: string): Promise<boolean> {
  const overrides = await getBuiltinOverrides();
  return overrides.some((o) => o.id === id);
}

// -------------------- CRUD 操作 --------------------

/**
 * 获取所有模板（内置（可能带覆写） + 自定义），包含实际的 enabled 状态
 */
export async function getAllTemplates(): Promise<PromptTemplate[]> {
  const overrides = await getBuiltinOverrides();
  const custom = await getCustomTemplates();
  const hidden = await getHiddenBuiltins();
  const enabledOverrides = await getEnabledOverrides();

  // 对内置模板应用覆写，并过滤掉被隐藏的
  const builtinWithOverrides = BUILTIN_TEMPLATES
    .filter((tmpl) => !hidden.includes(tmpl.id))
    .map((tmpl) => {
      const override = overrides.find((o) => o.id === tmpl.id);
      const enabled = tmpl.id in enabledOverrides ? enabledOverrides[tmpl.id] : tmpl.enabled;
      if (override) {
        return {
          ...tmpl,
          name: override.name ?? tmpl.name,
          description: override.description ?? tmpl.description,
          prompt: override.prompt ?? tmpl.prompt,
          enabled,
        };
      }
      return { ...tmpl, enabled };
    });

  // 自定义模板也需要应用 enabled 覆写
  const customWithEnabled = custom.map((tmpl) => {
    const enabled = tmpl.id in enabledOverrides ? enabledOverrides[tmpl.id] : tmpl.enabled;
    return { ...tmpl, enabled };
  });

  return [...builtinWithOverrides, ...customWithEnabled];
}

/**
 * 获取所有已启用的模板（用于 Popup/SidePanel 展示）
 */
export async function getEnabledTemplates(): Promise<PromptTemplate[]> {
  const all = await getAllTemplates();
  return all.filter((t) => t.enabled);
}

/**
 * 获取自定义模板
 */
export async function getCustomTemplates(): Promise<PromptTemplate[]> {
  const result = await chrome.storage.local.get(CUSTOM_TEMPLATES_KEY);
  return (result[CUSTOM_TEMPLATES_KEY] as PromptTemplate[]) || [];
}

/**
 * 根据 ID 获取模板
 */
export async function getTemplateById(
  id: string
): Promise<PromptTemplate | undefined> {
  const all = await getAllTemplates();
  return all.find((t) => t.id === id);
}

/**
 * 获取内置模板的原始默认 Prompt（用于重置功能）
 */
export function getBuiltinDefaultById(
  id: string
): PromptTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/**
 * 获取当前激活的模板
 */
export async function getActiveTemplate(): Promise<PromptTemplate> {
  const result = await chrome.storage.sync.get(ACTIVE_PROMPT_KEY);
  const activeId = (result[ACTIVE_PROMPT_KEY] as string) || "default";
  const template = await getTemplateById(activeId);
  return template || BUILTIN_TEMPLATES[0];
}

/**
 * 设置当前激活的模板
 */
export async function setActiveTemplate(id: string): Promise<void> {
  await chrome.storage.sync.set({ [ACTIVE_PROMPT_KEY]: id });
}

/**
 * 新增自定义模板
 */
export async function addCustomTemplate(
  template: Omit<PromptTemplate, "id" | "isBuiltin">
): Promise<PromptTemplate> {
  const custom = await getCustomTemplates();
  const newTemplate: PromptTemplate = {
    ...template,
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    isBuiltin: false,
    enabled: template.enabled !== undefined ? template.enabled : true,
  };
  custom.push(newTemplate);
  await chrome.storage.local.set({ [CUSTOM_TEMPLATES_KEY]: custom });
  return newTemplate;
}

/**
 * 更新模板（支持内置和自定义）
 */
export async function updateTemplate(
  id: string,
  updates: Partial<Omit<PromptTemplate, "id" | "isBuiltin">>
): Promise<void> {
  // 如果更新包含 enabled，单独处理
  if (updates.enabled !== undefined) {
    await setTemplateEnabled(id, updates.enabled);
  }

  // 其余字段的更新
  const { enabled: _enabled, ...otherUpdates } = updates;
  if (Object.keys(otherUpdates).length === 0) return;

  // 检查是否是内置模板
  const builtinTemplate = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtinTemplate) {
    // 内置模板：保存为覆写
    await saveBuiltinOverride({
      id,
      ...otherUpdates,
    });
  } else {
    // 自定义模板：直接更新
    await updateCustomTemplate(id, otherUpdates);
  }
}

/**
 * 更新自定义模板
 */
export async function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<PromptTemplate, "id" | "isBuiltin">>
): Promise<void> {
  const custom = await getCustomTemplates();
  const index = custom.findIndex((t) => t.id === id);
  if (index === -1) throw new Error("模板不存在");
  custom[index] = { ...custom[index], ...updates };
  await chrome.storage.local.set({ [CUSTOM_TEMPLATES_KEY]: custom });
}

/**
 * 删除自定义模板
 */
export async function removeCustomTemplate(id: string): Promise<void> {
  const custom = await getCustomTemplates();
  const filtered = custom.filter((t) => t.id !== id);
  await chrome.storage.local.set({ [CUSTOM_TEMPLATES_KEY]: filtered });

  // 如果删除的是当前激活的模板，回退到默认
  const result = await chrome.storage.sync.get(ACTIVE_PROMPT_KEY);
  if (result[ACTIVE_PROMPT_KEY] === id) {
    await setActiveTemplate("default");
  }
}

/**
 * 删除模板（支持内置和自定义）
 */
export async function removeTemplate(id: string): Promise<void> {
  const builtinTemplate = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtinTemplate) {
    // 内置模板：标记为隐藏
    await hideBuiltinTemplate(id);
    // 同时清除覆写数据
    const overrides = await getBuiltinOverrides();
    const filtered = overrides.filter((o) => o.id !== id);
    await chrome.storage.local.set({ [BUILTIN_OVERRIDES_KEY]: filtered });
  } else {
    // 自定义模板：直接删除
    await removeCustomTemplate(id);
    return; // removeCustomTemplate 已处理 activeId 回退
  }

  // 如果删除的是当前激活的模板，回退到默认
  const result = await chrome.storage.sync.get(ACTIVE_PROMPT_KEY);
  if (result[ACTIVE_PROMPT_KEY] === id) {
    // 找到第一个可用的模板作为回退
    const allTemplates = await getAllTemplates();
    const fallback = allTemplates[0]?.id || "default";
    await setActiveTemplate(fallback);
  }
}
