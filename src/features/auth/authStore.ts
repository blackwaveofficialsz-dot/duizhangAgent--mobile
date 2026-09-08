import { create } from 'zustand';
import {
  loginWithCode as apiLoginWithCode,
  loginWithPassword as apiLoginWithPassword,
  registerAccount,
  resetAccountPassword,
  type IdentifierType,
  type MobileAuthResult,
} from '@/services/api/auth';
import {
  cancelActiveRequests,
  setRefreshSessionHandler,
  setUnauthorizedHandler,
} from '@/services/api/client';
import {
  clearAccessToken,
  getAccessTokenSnapshot,
  isCurrentAccessToken,
  setAccessToken,
  shouldRefreshAccessToken,
  type AccessTokenSnapshot,
} from '@/services/auth/accessToken';
import {
  clearStoredRefreshToken,
  logoutWithStoredRefreshToken,
  refreshSessionFromStoredToken,
  saveRefreshToken,
} from '@/services/auth/refreshSession';
import { clearOfflineCache, configureOfflineCacheIdentity } from '@/services/cache/offlineCache';
import { clearLocalAppData } from '@/features/profile/localData';

type AuthStatus = 'restoring' | 'signedOut' | 'signingIn' | 'signedIn' | 'signingOut';

export type ResetPasswordResult = { cleanupWarning: string | null };

export class AuthActionCancelledError extends Error {
  constructor() {
    super('认证操作已取消');
    this.name = 'AuthActionCancelledError';
  }
}

export function isAuthActionCancelledError(error: unknown): error is AuthActionCancelledError {
  return error instanceof AuthActionCancelledError;
}

type AuthState = {
  status: AuthStatus;
  username: string | null;
  tenantId: string | null;
  userId: string | null;
  role: string | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithPassword: (type: IdentifierType, identifier: string, password: string) => Promise<void>;
  loginWithCode: (verificationToken: string) => Promise<void>;
  register: (username: string, password: string, inviteToken: string, verificationToken: string) => Promise<void>;
  resetPassword: (verificationToken: string, password: string) => Promise<ResetPasswordResult>;
  commitSession: (result: MobileAuthResult) => void;
  refreshSession: (result: MobileAuthResult, accessTokenSnapshot: AccessTokenSnapshot) => boolean;
  restoreSession: () => Promise<void>;
  refreshStoredSession: (options?: { ifNeeded?: boolean }) => Promise<boolean>;
  logout: (options?: { remote?: boolean }) => Promise<void>;
  clearError: () => void;
};

const signedOutState = {
  status: 'signedOut' as const,
  username: null,
  tenantId: null,
  userId: null,
  role: null,
  error: null,
};

let loginAttempt = 0;

function applySession(result: MobileAuthResult): void {
  setAccessToken(result.token);
  configureOfflineCacheIdentity({ tenantId: result.tenantId, userId: result.userId });
}

export const useAuthStore = create<AuthState>((set, get) => {
  const clearSession = async (
    cleanupFailureAsWarning = false,
    options: { remote?: boolean } = {},
  ): Promise<string | null> => {
    const cleanupAttempt = ++loginAttempt;
    cancelActiveRequests();
    clearAccessToken();
    set({ ...signedOutState, status: 'signingOut' });
    const refreshCleanup = options.remote === false
      ? clearStoredRefreshToken()
      : logoutWithStoredRefreshToken();
    const [refreshResult, localResult, offlineResult] = await Promise.allSettled([
      refreshCleanup,
      Promise.resolve().then(clearLocalAppData),
      clearOfflineCache(),
    ]);
    const failure = refreshResult.status === 'rejected'
      ? refreshResult.reason
      : localResult.status === 'rejected'
        ? localResult.reason
        : offlineResult.status === 'rejected'
          ? offlineResult.reason
          : null;
    if (failure) {
      if (cleanupAttempt !== loginAttempt) throw new AuthActionCancelledError();
      const message = failure instanceof Error ? failure.message : '本地缓存清理失败，请重新启动应用';
      if (cleanupFailureAsWarning) {
        set(signedOutState);
        return message;
      }
      set({
        ...signedOutState,
        error: message,
      });
      throw failure;
    }
    if (cleanupAttempt !== loginAttempt) throw new AuthActionCancelledError();
    set(signedOutState);
    return null;
  };

  const authenticate = async (request: () => Promise<MobileAuthResult>) => {
    if (get().status === 'signingIn' || get().status === 'signingOut') {
      throw new AuthActionCancelledError();
    }
    const attempt = ++loginAttempt;
    set({ status: 'signingIn', error: null });
    try {
      const result = await request();
      if (attempt !== loginAttempt) throw new AuthActionCancelledError();
      get().commitSession(result);
    } catch (error) {
      if (attempt !== loginAttempt) throw new AuthActionCancelledError();
      clearAccessToken();
      await clearStoredRefreshToken();
      set({
        ...signedOutState,
        error: error instanceof Error ? error.message : '登录失败，请稍后重试',
      });
      throw error;
    }
  };

  return {
    ...signedOutState,
    status: 'restoring',
    login: async (username, password) => {
      try {
        await get().loginWithPassword('username', username, password);
      } catch {
        // Compatibility callers read the store error instead of catching.
      }
    },
    loginWithPassword: (type, identifier, password) => authenticate(
      () => apiLoginWithPassword(type, identifier.trim(), password),
    ),
    loginWithCode: (verificationToken) => authenticate(() => apiLoginWithCode(verificationToken)),
    register: (username, password, inviteToken, verificationToken) => authenticate(
      () => registerAccount(username.trim(), password, inviteToken.trim(), verificationToken),
    ),
    resetPassword: async (verificationToken, password) => {
      if (get().status === 'signingIn' || get().status === 'signingOut') {
        throw new AuthActionCancelledError();
      }
      const attempt = ++loginAttempt;
      set({ status: 'signingIn', error: null });
      try {
        await resetAccountPassword(verificationToken, password);
      } catch (error) {
        if (attempt !== loginAttempt) throw new AuthActionCancelledError();
        clearAccessToken();
        await clearStoredRefreshToken();
        set({ ...signedOutState, error: error instanceof Error ? error.message : '密码重置失败，请稍后重试' });
        throw error;
      }
      if (attempt !== loginAttempt) throw new AuthActionCancelledError();
      return { cleanupWarning: await clearSession(true) };
    },
    commitSession: (result) => {
      loginAttempt += 1;
      if (result.refreshToken) void saveRefreshToken(result.refreshToken);
      applySession(result);
      set({
        status: 'signedIn',
        username: result.username,
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
        error: null,
      });
    },
    refreshSession: (result, accessTokenSnapshot) => {
      const current = get();
      if (
        current.status !== 'signedIn'
        || current.tenantId !== result.tenantId
        || current.userId !== result.userId
        || !isCurrentAccessToken(accessTokenSnapshot)
      ) return false;
      loginAttempt += 1;
      applySession(result);
      set({
        status: 'signedIn',
        username: result.username,
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
        error: null,
      });
      return true;
    },
    restoreSession: async () => {
      const attempt = ++loginAttempt;
      set({ ...signedOutState, status: 'restoring' });
      const result = await refreshSessionFromStoredToken();
      if (attempt !== loginAttempt) throw new AuthActionCancelledError();
      if (!result) {
        clearAccessToken();
        set(signedOutState);
        return;
      }
      applySession({
        token: result.token,
        username: result.username ?? get().username ?? '',
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
      });
      set({
        status: 'signedIn',
        username: result.username ?? null,
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
        error: null,
      });
    },
    refreshStoredSession: async (options) => {
      const snapshot = getAccessTokenSnapshot();
      if (options?.ifNeeded && !shouldRefreshAccessToken(snapshot.token)) return true;
      const result = await refreshSessionFromStoredToken();
      if (!result) return false;
      const current = get();
      if (
        current.status === 'signedIn'
        && (current.tenantId !== result.tenantId || current.userId !== result.userId)
      ) return false;
      applySession({
        token: result.token,
        username: result.username ?? current.username ?? '',
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
      });
      set({
        status: 'signedIn',
        username: result.username ?? current.username,
        tenantId: result.tenantId,
        userId: result.userId,
        role: result.role,
        error: null,
      });
      return true;
    },
    logout: async (options) => { await clearSession(false, options); },
    clearError: () => set({ error: null }),
  };
});

setRefreshSessionHandler(() => useAuthStore.getState().refreshStoredSession());

setUnauthorizedHandler(() => {
  void useAuthStore.getState().logout({ remote: false }).catch(() => {});
});
