// ============================================================
// OpenClaw Zero Token — 统一导出
// ============================================================

// 类型
export type {
  ZeroTokenProvider,
  ZeroTokenCredential,
  ZeroTokenProviderInfo,
  SSEEvent,
  SSETextExtractor,
  CredentialSource,
} from "./types";

// 注册中心
export {
  ZERO_TOKEN_PROVIDERS,
  ZERO_TOKEN_PROVIDER_IDS,
  getZeroTokenProvider,
  getAllZeroTokenProviders,
  isZeroTokenProvider,
  getZeroTokenProviderInfo,
  checkAllZeroTokenLoginStatus,
} from "./registry";

// 基础类（供外部扩展）
export { BaseZeroTokenProvider, generateRandomId } from "./base";

// 具体适配器（直接使用时可导入）
export { KimiWebProvider } from "./kimi-web";
