// ============================================================
// 文件名处理工具
// ============================================================

/**
 * 清理文件名：去掉特殊字符、截断到安全长度
 */
export function sanitizeFilename(raw: string, maxLength = 200): string {
  // 去除文件系统不允许的字符
  let cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "_") // Windows/macOS 非法字符
    .replace(/[\x00-\x1f]/g, "") // 控制字符
    .replace(/\.{2,}/g, ".") // 连续点号
    .replace(/\s+/g, " ") // 多个空白合并
    .trim();

  // 截断到最大长度（保留 .md 后缀的空间）
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}
