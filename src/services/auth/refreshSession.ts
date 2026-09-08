import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { readRuntimeConfig } from '@/config/env';

export const REFRESH_TOKEN_STORAGE_KEY = 'duizhang_refresh_token';

export type MobileAuthIdentity = {
  token: string;
  tenantId: string;
  userId: string;
  role: string;
  username?: string;
};

type RefreshResponse = {
  token: string;
  tenant_id: string;
  user_id?: string;
  role: string;
  refresh_token?: string | null;
};

let refreshPromise: Promise<MobileAuthIdentity | null> | null = null;

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, token);
}

export async function clearStoredRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY);
}

export async function refreshSessionFromStoredToken(): Promise<MobileAuthIdentity | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshSession()
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function logoutWithStoredRefreshToken(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
  try {
    if (refreshToken) {
      const { apiUrl } = readRuntimeConfig();
      await expoFetch(`${apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_type: 'mobile', refresh_token: refreshToken }),
      });
    }
  } catch {
    // Local session cleanup should not depend on network availability.
  }
  await clearStoredRefreshToken();
}

async function refreshSession(): Promise<MobileAuthIdentity | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
  if (!refreshToken) return null;
  const { apiUrl } = readRuntimeConfig();
  try {
    const response = await expoFetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_type: 'mobile', refresh_token: refreshToken }),
    });
    if (response.status === 401) {
      await clearStoredRefreshToken();
      return null;
    }
    if (!response.ok) return null;
    const data = await response.json() as RefreshResponse;
    const nextRefreshToken = nonEmptyString(data.refresh_token);
    const userId = nonEmptyString(data.user_id) ?? jwtStringClaim(data.token, 'user_id');
    if (!userId || !nextRefreshToken) {
      await clearStoredRefreshToken();
      return null;
    }
    await saveRefreshToken(nextRefreshToken);
    return {
      token: data.token,
      tenantId: data.tenant_id,
      userId,
      role: data.role,
      username: jwtStringClaim(data.token, 'sub') ?? undefined,
    };
  } catch {
    return null;
  }
}

function jwtStringClaim(token: string, claim: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const value = JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
    return nonEmptyString(value[claim]);
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
