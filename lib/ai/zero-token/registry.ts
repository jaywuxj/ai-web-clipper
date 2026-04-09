// ============================================================
// OpenClaw Zero Token — 提供商注册中心
// 统一管理所有免 Token 提供商的注册、查询、调用
// ============================================================

import type { ZeroTokenProvider, ZeroTokenProviderInfo } from "./types";
import { KimiWebProvider } from "./kimi-web";

// -------------------- 提供商注册表 --------------------

/** 已注册的所有 Zero Token 提供商信息 */
export const ZERO_TOKEN_PROVIDERS: ZeroTokenProviderInfo[] = [
  {
    id: "kimi-web",
    displayName: "Kimi (免费)",
    domain: "kimi.moonshot.cn",
    loginUrl: "https://kimi.moonshot.cn",
    modelName: "Kimi",
    description: "Kimi 网页版 · 复用浏览器登录态 · 无需 API Key",
    credentialSource: "localStorage",
    storageKey: "refresh_token",
  },
];

/** 所有 Zero Token 提供商的 ID 列表 */
export const ZERO_TOKEN_PROVIDER_IDS = ZERO_TOKEN_PROVIDERS.map((p) => p.id);

// -------------------- 提供商实例管理 --------------------

/** 缓存的提供商实例（单例模式） */
const providerInstances = new Map<string, ZeroTokenProvider>();

/**
 * 获取指定 ID 的 Zero Token 提供商实例
 */
export function getZeroTokenProvider(id: string): ZeroTokenProvider | null {
  // 检查缓存
  if (providerInstances.has(id)) {
    return providerInstances.get(id)!;
  }

  // 创建实例
  let provider: ZeroTokenProvider | null = null;
  switch (id) {
    case "kimi-web":
      provider = new KimiWebProvider();
      break;
    default:
      return null;
  }

  // 缓存并返回
  providerInstances.set(id, provider);
  return provider;
}

/**
 * 获取所有 Zero Token 提供商实例
 */
export function getAllZeroTokenProviders(): ZeroTokenProvider[] {
  return ZERO_TOKEN_PROVIDERS.map((info) => getZeroTokenProvider(info.id)!);
}

/**
 * 判断一个 provider ID 是否是 Zero Token 类型
 */
export function isZeroTokenProvider(providerId: string): boolean {
  return ZERO_TOKEN_PROVIDER_IDS.includes(providerId);
}

/**
 * 获取 Zero Token 提供商的显示信息
 */
export function getZeroTokenProviderInfo(
  id: string,
): ZeroTokenProviderInfo | null {
  return ZERO_TOKEN_PROVIDERS.find((p) => p.id === id) || null;
}

/**
 * 批量检查所有 Zero Token 提供商的登录状态
 * @returns Record<providerId, loggedIn>
 */
export async function checkAllZeroTokenLoginStatus(): Promise<
  Record<string, boolean>
> {
  const results: Record<string, boolean> = {};

  await Promise.all(
    ZERO_TOKEN_PROVIDERS.map(async (info) => {
      const provider = getZeroTokenProvider(info.id);
      if (provider) {
        try {
          results[info.id] = await provider.checkLoginStatus();
        } catch {
          results[info.id] = false;
        }
      }
    }),
  );

  return results;
}
