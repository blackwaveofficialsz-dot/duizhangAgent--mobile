let accessToken: string | null = null;
let accessTokenVersion = 0;

export type AccessTokenSnapshot = {
  token: string | null;
  version: number;
};

export function getAccessToken(): string | null {
  return accessToken;
}

export function getAccessTokenSnapshot(): AccessTokenSnapshot {
  return { token: accessToken, version: accessTokenVersion };
}

export function isCurrentAccessToken(snapshot: AccessTokenSnapshot): boolean {
  return snapshot.token === accessToken && snapshot.version === accessTokenVersion;
}

export function setAccessToken(token: string): void {
  accessToken = token;
  accessTokenVersion += 1;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessTokenVersion += 1;
}

export function shouldRefreshAccessToken(token: string | null): boolean {
  if (!token) return false;
  const expMs = jwtExpMs(token);
  if (expMs === null) return false;
  return expMs - Date.now() <= 6 * 60 * 60 * 1000;
}

function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const value = JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
    return typeof value.exp === 'number' ? value.exp * 1000 : null;
  } catch {
    return null;
  }
}
