import * as SecureStore from 'expo-secure-store';
import {
  clearStoredRefreshToken,
  refreshSessionFromStoredToken,
  saveRefreshToken,
} from './refreshSession';
import { clearAccessToken } from './accessToken';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mobile refresh session', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'legacy';
    clearAccessToken();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('stores and clears the refresh token in SecureStore', async () => {
    await saveRefreshToken('refresh-a');
    await clearStoredRefreshToken();

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('duizhang_refresh_token', 'refresh-a');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('duizhang_refresh_token');
  });

  it('rotates a stored refresh token and returns a new access identity', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('refresh-old');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      token: 'access-new',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      role: 'admin',
      refresh_token: 'refresh-new',
    }));

    await expect(refreshSessionFromStoredToken()).resolves.toMatchObject({
      token: 'access-new',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_type: 'mobile', refresh_token: 'refresh-old' }),
      }),
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('duizhang_refresh_token', 'refresh-new');
  });

  it('shares one native refresh request across concurrent callers', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('refresh-old');
    let resolveRefresh!: (value: Response) => void;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    }));

    const first = refreshSessionFromStoredToken();
    const second = refreshSessionFromStoredToken();
    resolveRefresh(jsonResponse({
      token: 'access-new',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      role: 'member',
      refresh_token: 'refresh-new',
    }));

    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears a stale refresh token when the server rejects it', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('refresh-old');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'expired' }, 401));

    await expect(refreshSessionFromStoredToken()).resolves.toBeNull();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('duizhang_refresh_token');
  });
});
