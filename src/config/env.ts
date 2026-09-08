export type AppEnvironment = 'development' | 'preview' | 'production';
export type AuthMode = 'legacy' | 'mobile';

export type RuntimeConfig = {
  apiUrl: string;
  appEnv: AppEnvironment;
  authMode: AuthMode;
  enableCacheDiagnostics: boolean;
};

type PublicEnvironment = Record<string, string | undefined>;

export function readRuntimeConfig(): RuntimeConfig {
  return getRuntimeConfig({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_AUTH_MODE: process.env.EXPO_PUBLIC_AUTH_MODE,
    EXPO_PUBLIC_ENABLE_CACHE_DIAGNOSTICS: process.env.EXPO_PUBLIC_ENABLE_CACHE_DIAGNOSTICS,
  });
}

export function getRuntimeConfig(env: PublicEnvironment): RuntimeConfig {
  const apiUrl = env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!apiUrl) {
    throw new Error('缺少 EXPO_PUBLIC_API_URL');
  }

  const appEnv = (env.EXPO_PUBLIC_APP_ENV || 'development') as AppEnvironment;
  const authMode = (env.EXPO_PUBLIC_AUTH_MODE || 'legacy') as AuthMode;

  if (!['development', 'preview', 'production'].includes(appEnv)) {
    throw new Error(`无效的 EXPO_PUBLIC_APP_ENV: ${appEnv}`);
  }
  if (!['legacy', 'mobile'].includes(authMode)) {
    throw new Error(`无效的 EXPO_PUBLIC_AUTH_MODE: ${authMode}`);
  }
  if (appEnv === 'production' && authMode === 'legacy') {
    throw new Error('生产环境禁止使用 legacy 鉴权');
  }

  return {
    apiUrl,
    appEnv,
    authMode,
    enableCacheDiagnostics: env.EXPO_PUBLIC_ENABLE_CACHE_DIAGNOSTICS?.trim().toLowerCase() === 'true',
  };
}
