import * as authApi from '@/services/api/auth';
import * as apiClient from '@/services/api/client';
import { apiRequest } from '@/services/api/client';
import {
  clearAccessToken,
  getAccessToken,
  getAccessTokenSnapshot,
  setAccessToken,
} from '@/services/auth/accessToken';
import { useChatStore } from '@/features/chat/chatStore';
import { useTaskStore } from '@/features/tasks/taskStore';
import { clearOfflineCache, configureOfflineCacheIdentity } from '@/services/cache/offlineCache';
import * as refreshStorage from '@/services/auth/refreshSession';
import * as localData from '@/features/profile/localData';
import { useAuthStore } from './authStore';

jest.mock('@/services/cache/offlineCache', () => ({
  clearOfflineCache: jest.fn(),
  configureOfflineCacheIdentity: jest.fn(),
}));

jest.mock('@/services/auth/refreshSession', () => ({
  clearStoredRefreshToken: jest.fn(),
  logoutWithStoredRefreshToken: jest.fn(),
  refreshSessionFromStoredToken: jest.fn(),
  saveRefreshToken: jest.fn(),
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'legacy';
    useAuthStore.setState({
      status: 'signedOut',
      username: null,
      tenantId: null,
      userId: null,
      role: null,
      error: null,
    });
    clearAccessToken();
    useChatStore.setState({ activeSessionId: null, messagesBySessionId: {}, sessions: [] });
    useTaskStore.setState({ error: null, status: 'idle', tasks: [] });
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.mocked(clearOfflineCache).mockResolvedValue(undefined);
    jest.mocked(refreshStorage.clearStoredRefreshToken).mockResolvedValue(undefined);
    jest.mocked(refreshStorage.logoutWithStoredRefreshToken).mockResolvedValue(undefined);
    jest.mocked(refreshStorage.refreshSessionFromStoredToken).mockResolvedValue(null);
    jest.mocked(refreshStorage.saveRefreshToken).mockResolvedValue(undefined);
  });

  it('stores the authenticated identity after login', async () => {
    jest.spyOn(authApi, 'loginWithPassword').mockResolvedValue({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });

    await useAuthStore.getState().login('demo', 'secret');

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
      error: null,
    });
    expect(getAccessToken()).toBe('access-token');
    expect(refreshStorage.saveRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(configureOfflineCacheIdentity).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('restores a stored refresh session on app start', async () => {
    jest.mocked(refreshStorage.refreshSessionFromStoredToken).mockResolvedValue({
      token: 'restored-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
    });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
      error: null,
    });
    expect(getAccessToken()).toBe('restored-token');
  });

  it('submits typed password credentials through the store session boundary', async () => {
    const api = jest.spyOn(authApi, 'loginWithPassword').mockResolvedValue({
      token: 'email-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });

    await useAuthStore.getState().loginWithPassword('email', 'ops@example.com', 'secret-password');

    expect(api).toHaveBeenCalledWith('email', 'ops@example.com', 'secret-password');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'operator' });
    expect(getAccessToken()).toBe('email-token');
  });

  it('commits code login and invite registration sessions through store actions', async () => {
    jest.spyOn(authApi, 'loginWithCode').mockResolvedValue({
      token: 'code-token', username: 'code-user', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    jest.spyOn(authApi, 'registerAccount').mockResolvedValue({
      token: 'register-token', username: 'new-user', tenantId: 'tenant-1', userId: 'user-2', role: 'member',
    });

    await useAuthStore.getState().loginWithCode('login-verification-token');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'code-user' });
    expect(getAccessToken()).toBe('code-token');

    useAuthStore.setState({ status: 'signedOut' });
    await useAuthStore.getState().register('new-user', 'secret-password', 'invite-token', 'register-verification-token');
    expect(authApi.registerAccount).toHaveBeenCalledWith(
      'new-user', 'secret-password', 'invite-token', 'register-verification-token',
    );
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'new-user' });
    expect(getAccessToken()).toBe('register-token');
  });

  it.each(['signingIn', 'signingOut'] as const)('rejects a new auth action while %s', async (status) => {
    const api = jest.spyOn(authApi, 'loginWithPassword').mockResolvedValue({
      token: 'unexpected-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    useAuthStore.setState({ status });

    await expect(useAuthStore.getState().loginWithPassword('username', 'demo', 'secret'))
      .rejects.toMatchObject({ name: 'AuthActionCancelledError' });

    expect(api).not.toHaveBeenCalled();
  });

  it('rejects an overlapping attempt while allowing the active attempt to finish', async () => {
    let resolveLogin!: (result: authApi.MobileAuthResult) => void;
    const api = jest.spyOn(authApi, 'loginWithPassword').mockReturnValue(
      new Promise((resolve) => { resolveLogin = resolve; }),
    );
    const active = useAuthStore.getState().loginWithPassword('username', 'first', 'secret');

    await expect(useAuthStore.getState().loginWithPassword('username', 'second', 'secret'))
      .rejects.toMatchObject({ name: 'AuthActionCancelledError' });
    expect(api).toHaveBeenCalledTimes(1);

    resolveLogin({ token: 'first-token', username: 'first', tenantId: 'tenant-1', userId: 'user-1', role: 'member' });
    await active;
    expect(getAccessToken()).toBe('first-token');
  });

  it('clears the active session after resetting a password', async () => {
    jest.spyOn(authApi, 'resetAccountPassword').mockResolvedValue(undefined);
    setAccessToken('stale-token');
    useAuthStore.setState({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [] },
      sessions: [{ session_id: 'session-a', title: '旧会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    useTaskStore.setState({ error: '旧错误', status: 'error', tasks: [] });
    const cancelSpy = jest.spyOn(apiClient, 'cancelActiveRequests');
    const localCleanupSpy = jest.spyOn(localData, 'clearLocalAppData');

    await useAuthStore.getState().resetPassword('reset-verification-token', 'Secret9');

    expect(authApi.resetAccountPassword).toHaveBeenCalledWith('reset-verification-token', 'Secret9');
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut', username: null, tenantId: null, userId: null, role: null,
    });
    expect(getAccessToken()).toBeNull();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(localCleanupSpy).toHaveBeenCalledTimes(1);
    expect(clearOfflineCache).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState()).toMatchObject({ activeSessionId: null, messagesBySessionId: {}, sessions: [] });
    expect(useTaskStore.getState()).toMatchObject({ error: null, status: 'idle', tasks: [] });
  });

  it('rejects a successful reset superseded by a replacement session', async () => {
    let finishReset!: () => void;
    jest.spyOn(authApi, 'resetAccountPassword').mockReturnValue(new Promise<void>((resolve) => { finishReset = resolve; }));
    const reset = useAuthStore.getState().resetPassword('reset-token', 'Secret9');
    const cancelled = expect(reset).rejects.toMatchObject({ name: 'AuthActionCancelledError' });

    useAuthStore.getState().commitSession({
      token: 'replacement-token', username: 'replacement', tenantId: 'tenant-2', userId: 'user-2', role: 'member',
    });
    finishReset();

    await cancelled;
    expect(getAccessToken()).toBe('replacement-token');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'replacement' });
    expect(clearOfflineCache).not.toHaveBeenCalled();
  });

  it('rejects a reset superseded while session cleanup is pending', async () => {
    let finishCleanup!: () => void;
    jest.spyOn(authApi, 'resetAccountPassword').mockResolvedValue(undefined);
    jest.mocked(clearOfflineCache).mockReturnValueOnce(new Promise<void>((resolve) => { finishCleanup = resolve; }));

    const reset = useAuthStore.getState().resetPassword('reset-token', 'Secret9');
    const cancelled = expect(reset).rejects.toMatchObject({ name: 'AuthActionCancelledError' });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().status).toBe('signingOut');

    useAuthStore.getState().commitSession({
      token: 'replacement-token', username: 'replacement', tenantId: 'tenant-2', userId: 'user-2', role: 'member',
    });
    finishCleanup();

    await cancelled;
    expect(getAccessToken()).toBe('replacement-token');
    expect(configureOfflineCacheIdentity).toHaveBeenLastCalledWith({ tenantId: 'tenant-2', userId: 'user-2' });
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'replacement' });
  });

  it('returns a cleanup warning after the server reset succeeds', async () => {
    jest.spyOn(authApi, 'resetAccountPassword').mockResolvedValue(undefined);
    jest.spyOn(localData, 'clearLocalAppData').mockImplementation(() => { throw new Error('临时文件删除失败'); });
    setAccessToken('stale-token');

    await expect(useAuthStore.getState().resetPassword('reset-token', 'Secret9')).resolves.toEqual({
      cleanupWarning: '临时文件删除失败',
    });

    expect(getAccessToken()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', error: null });
  });

  it('keeps the user signed out and exposes the login error', async () => {
    jest.spyOn(authApi, 'loginWithPassword').mockRejectedValue(new Error('用户名或密码错误'));

    await useAuthStore.getState().login('demo', 'wrong');

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      username: null,
      error: '用户名或密码错误',
    });
    expect(getAccessToken()).toBeNull();
  });

  it('replaces the active token without clearing the signed-in identity', () => {
    setAccessToken('old-token');
    useAuthStore.setState({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    const applied = useAuthStore.getState().refreshSession({
      token: 'new-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    }, getAccessTokenSnapshot());

    expect(applied).toBe(true);
    expect(getAccessToken()).toBe('new-token');
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member', error: null,
    });
    expect(clearOfflineCache).not.toHaveBeenCalled();
  });

  it('does not refresh a session after logout invalidates its token snapshot', async () => {
    setAccessToken('old-token');
    useAuthStore.setState({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    const snapshot = getAccessTokenSnapshot();
    await useAuthStore.getState().logout();

    const applied = useAuthStore.getState().refreshSession({
      token: 'late-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    }, snapshot);

    expect(applied).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('does not let an old refresh overwrite a newer login for the same identity', () => {
    setAccessToken('old-token');
    useAuthStore.setState({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });
    const snapshot = getAccessTokenSnapshot();
    useAuthStore.getState().commitSession({
      token: 'newer-token', username: 'newer-session', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });

    const applied = useAuthStore.getState().refreshSession({
      token: 'late-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    }, snapshot);

    expect(applied).toBe(false);
    expect(getAccessToken()).toBe('newer-token');
    expect(useAuthStore.getState().username).toBe('newer-session');
  });

  it('does not refresh a token for a different tenant or user', () => {
    setAccessToken('old-token');
    useAuthStore.setState({
      status: 'signedIn', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });

    const applied = useAuthStore.getState().refreshSession({
      token: 'foreign-token', username: 'foreign', tenantId: 'tenant-2', userId: 'user-2', role: 'member',
    }, getAccessTokenSnapshot());

    expect(applied).toBe(false);
    expect(getAccessToken()).toBe('old-token');
    expect(useAuthStore.getState()).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1', username: 'operator' });
  });

  it('configures the offline-cache identity before signed-in subscribers run', () => {
    let cacheIdentityConfigured = false;
    jest.mocked(configureOfflineCacheIdentity).mockImplementation(() => {
      cacheIdentityConfigured = true;
    });
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.status === 'signedIn') expect(cacheIdentityConfigured).toBe(true);
    });

    try {
      useAuthStore.getState().commitSession({
        token: 'access-token',
        username: 'operator',
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'member',
      });
    } finally {
      unsubscribe();
    }
  });

  it('clears the in-memory session on logout', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      username: 'demo',
      tenantId: 'tenant-1',
      role: 'member',
    });
    setAccessToken('access-token');
    useTaskStore.setState({
      error: '旧的任务错误',
      status: 'error',
      tasks: [{
        celery_task_id: null,
        completed_at: null,
        created_at: '2026-07-16T10:00:00+08:00',
        id: 'cached-task',
        meta: null,
        session_id: 'tenant-1:session-1',
        status: 'completed',
        task_id: 'task-1',
        task_type: 'file_parsing',
        tenant_id: 'tenant-1',
        updated_at: '2026-07-16T10:00:00+08:00',
        user_id: 'demo',
      }],
    });
    const cancelSpy = jest.spyOn(apiClient, 'cancelActiveRequests');

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      username: null,
      tenantId: null,
      role: null,
    });
    expect(getAccessToken()).toBeNull();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState()).toMatchObject({ error: null, status: 'idle', tasks: [] });
    expect(clearOfflineCache).toHaveBeenCalledTimes(1);
  });

  it('does not finish logout until the encrypted cache cleanup completes', async () => {
    let resolveCleanup!: () => void;
    jest.mocked(clearOfflineCache).mockReturnValueOnce(new Promise<void>((resolve) => { resolveCleanup = resolve; }));
    useAuthStore.setState({ status: 'signedIn', username: 'demo', tenantId: 'tenant-1', userId: 'user-1' });

    const logout = useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe('signingOut');
    resolveCleanup();
    await logout;

    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('still attempts encrypted cache cleanup when temporary file cleanup fails', async () => {
    jest.spyOn(localData, 'clearLocalAppData').mockImplementation(() => { throw new Error('临时文件删除失败'); });
    jest.mocked(clearOfflineCache).mockResolvedValue(undefined);
    useAuthStore.setState({ status: 'signedIn', username: 'demo', tenantId: 'tenant-1', userId: 'user-1' });

    await expect(useAuthStore.getState().logout()).rejects.toThrow('临时文件删除失败');

    expect(clearOfflineCache).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ error: '临时文件删除失败', status: 'signedOut' });
  });

  it('clears loaded chat history on logout before another user signs in', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      username: 'user-a',
      tenantId: 'tenant-a',
      role: 'member',
    });
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [{ id: 'message-a', role: 'user', content: 'A 的历史', created_at: '2026-07-16T10:00:00+08:00' }] },
      sessions: [{ session_id: 'session-a', title: 'A 的会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    jest.spyOn(authApi, 'loginWithPassword').mockResolvedValue({
      token: 'user-b-token',
      username: 'user-b-server',
      tenantId: 'tenant-b',
      userId: 'user-b',
      role: 'member',
    });

    await useAuthStore.getState().logout();
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: null,
      messagesBySessionId: {},
      sessions: [],
    });

    await useAuthStore.getState().login('user-b', 'secret');
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: null,
      messagesBySessionId: {},
      sessions: [],
    });
  });

  it('clears the session when an authenticated request returns 401', async () => {
    useAuthStore.setState({
      status: 'signedIn',
      username: 'demo',
      tenantId: 'tenant-1',
      role: 'member',
    });
    setAccessToken('expired-token');
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [] },
      sessions: [{ session_id: 'session-a', title: 'A 的会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '登录状态已失效' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiRequest('/api/v1/tasks')).rejects.toThrow('登录状态已失效');

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      username: null,
      tenantId: null,
      role: null,
    });
    expect(getAccessToken()).toBeNull();
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: null,
      messagesBySessionId: {},
      sessions: [],
    });
  });

  it('does not restore a login result that finishes after logout', async () => {
    let resolveLogin: ((result: authApi.MobileAuthResult) => void) | undefined;
    jest.spyOn(authApi, 'loginWithPassword').mockReturnValue(
      new Promise((resolve) => { resolveLogin = resolve; }),
    );

    const login = useAuthStore.getState().login('demo', 'secret');
    await Promise.resolve();
    await useAuthStore.getState().logout();
    resolveLogin?.({ token: 'late-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member' });
    await login;

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedOut',
      username: null,
      tenantId: null,
      role: null,
    });
    expect(getAccessToken()).toBeNull();
  });

  it('rejects a typed login result that finishes after logout', async () => {
    let resolveLogin!: (result: authApi.MobileAuthResult) => void;
    jest.spyOn(authApi, 'loginWithPassword').mockReturnValue(
      new Promise((resolve) => { resolveLogin = resolve; }),
    );

    const login = useAuthStore.getState().loginWithPassword('username', 'demo', 'secret');
    const cancelled = expect(login).rejects.toMatchObject({ name: 'AuthActionCancelledError' });
    await useAuthStore.getState().logout();
    resolveLogin({ token: 'late-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member' });

    await cancelled;
    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(getAccessToken()).toBeNull();
  });
});
