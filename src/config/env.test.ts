import { getRuntimeConfig, readRuntimeConfig } from './env';

describe('getRuntimeConfig', () => {
  it('accepts legacy authentication during development', () => {
    expect(
      getRuntimeConfig({
        EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8000',
        EXPO_PUBLIC_APP_ENV: 'development',
        EXPO_PUBLIC_AUTH_MODE: 'legacy',
      }),
    ).toEqual({
      apiUrl: 'http://127.0.0.1:8000',
      appEnv: 'development',
      authMode: 'legacy',
      enableCacheDiagnostics: false,
    });
  });

  it('enables cache diagnostics only when the explicit public flag is true', () => {
    expect(
      getRuntimeConfig({
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_AUTH_MODE: 'mobile',
        EXPO_PUBLIC_ENABLE_CACHE_DIAGNOSTICS: 'true',
      }),
    ).toEqual({
      apiUrl: 'https://api.example.com',
      appEnv: 'production',
      authMode: 'mobile',
      enableCacheDiagnostics: true,
    });
  });

  it('rejects a missing API URL', () => {
    expect(() =>
      getRuntimeConfig({
        EXPO_PUBLIC_APP_ENV: 'development',
        EXPO_PUBLIC_AUTH_MODE: 'legacy',
      }),
    ).toThrow('缺少 EXPO_PUBLIC_API_URL');
  });

  it('rejects legacy authentication in production', () => {
    expect(() =>
      getRuntimeConfig({
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_AUTH_MODE: 'legacy',
      }),
    ).toThrow('生产环境禁止使用 legacy 鉴权');
  });

  it('reads Expo public variables from the process environment', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:9000/';
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'legacy';
    process.env.EXPO_PUBLIC_ENABLE_CACHE_DIAGNOSTICS = 'true';

    expect(readRuntimeConfig()).toEqual({
      apiUrl: 'http://localhost:9000',
      appEnv: 'preview',
      authMode: 'legacy',
      enableCacheDiagnostics: true,
    });
  });
});
