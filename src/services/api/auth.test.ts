import {
  changePassword,
  confirmVerification,
  getAuthCapabilities,
  getContactStatus,
  loginWithCode,
  loginWithPassword,
  registerAccount,
  requestVerification,
  resetAccountPassword,
  updateContact,
} from './auth';
import { clearAccessToken, setAccessToken } from '@/services/auth/accessToken';

const loginResponse = {
  token: 'access-token',
  refresh_token: 'refresh-token',
  username: 'operator',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  role: 'member',
};

describe('mobile authentication API', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'legacy';
    clearAccessToken();
  });

  afterEach(() => {
    clearAccessToken();
    jest.restoreAllMocks();
  });

  it('posts the legacy username shape when legacy auth is enabled', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify(loginResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(loginWithPassword('username', 'demo', 'secret')).resolves.toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'demo',
          password: 'secret',
          client_type: 'mobile',
          device_name: 'mobile-app',
        }),
      }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('posts the canonical identifier shape in mobile auth mode', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'mobile';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(loginResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(loginWithPassword('email', 'ops@example.com', 'secret-password')).resolves.toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          identifier_type: 'email',
          identifier: 'ops@example.com',
          password: 'secret-password',
          client_type: 'mobile',
          device_name: 'mobile-app',
        }),
      }),
    );
  });

  it('uses the username returned by the server rather than the password identifier', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify(loginResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(loginWithPassword('username', 'operator-input', 'secret')).resolves.toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });
  });

  it('uses the API error detail when login fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '用户名或密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(loginWithPassword('username', 'demo', 'wrong')).rejects.toThrow('用户名或密码错误');
  });

  it('keeps contact_not_registered and retry_after on an API error', async () => {
    process.env.EXPO_PUBLIC_AUTH_MODE = 'mobile';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error_code: 'contact_not_registered', detail: '该联系方式尚未注册' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
      }),
    );

    await expect(requestVerification({ channel: 'email', purpose: 'login', target: 'new@example.com' }))
      .rejects.toMatchObject({ code: 'contact_not_registered', status: 404, retryAfter: 30 });
  });

  it.each([
    ['login', { channel: 'email', purpose: 'login', target: 'login@example.com' }],
    ['register', { channel: 'email', purpose: 'register', target: 'register@example.com', inviteToken: 'invite-token' }],
    ['reset_password', { channel: 'sms', purpose: 'reset_password', target: '13800138000' }],
  ] as const)('does not send an ambient bearer for public %s verification', async (_label, request) => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        challenge_id: 'challenge-1', message: '验证码已发送', expires_in: 600, resend_after: 60,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await requestVerification(request);

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it.each([
    ['bind_contact', { channel: 'email', purpose: 'bind_contact', target: 'bind@example.com' }],
    ['change_contact', { channel: 'sms', purpose: 'change_contact', target: '13900139000' }],
  ] as const)('uses the ambient bearer for authenticated %s verification', async (_label, request) => {
    setAccessToken('active-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        challenge_id: 'challenge-1', message: '验证码已发送', expires_in: 600, resend_after: 60,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await requestVerification(request);

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer active-token');
  });

  it('posts a verification confirmation code without a stale session bearer', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ verification_token: 'verification-token', expires_in: 600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(confirmVerification('challenge-1', '123456')).resolves.toEqual({
      verificationToken: 'verification-token', expiresIn: 600,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/verifications/challenge-1/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: '123456' }) }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it('posts a code-login verification token without a stale session bearer', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(loginResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await loginWithCode('verification-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/login/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          verification_token: 'verification-token',
          client_type: 'mobile',
          device_name: 'mobile-app',
        }),
      }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it('posts registration credentials and verification tokens without a stale session bearer', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(loginResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await registerAccount('operator', 'secret-password', 'invite-token', 'verification-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'operator',
          password: 'secret-password',
          invite_token: 'invite-token',
          verification_token: 'verification-token',
          client_type: 'mobile',
          device_name: 'mobile-app',
        }),
      }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it('posts reset-password credentials without a stale session bearer', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '密码重置成功，请重新登录', must_change_password: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await resetAccountPassword('verification-token', 'Secret9');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ verification_token: 'verification-token', new_password: 'Secret9' }),
      }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it('posts signed-in change-password credentials with the active bearer', async () => {
    setAccessToken('active-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '密码修改成功', must_change_password: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(changePassword('current-password', 'Valid123')).resolves.toEqual({
      message: '密码修改成功',
      mustChangePassword: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/change-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ old_password: 'current-password', new_password: 'Valid123' }),
      }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer active-token');
  });

  it('posts bind and change contact requests with the current session bearer', async () => {
    setAccessToken('active-token');
    const contactUpdateResponse = {
      ...loginResponse,
      refresh_token: null,
      message: '联系方式已更新',
      contact: {
        email: { bound: true, verified: true, masked: 'o***@example.com' },
        phone: { bound: false, verified: false, masked: '' },
      },
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(contactUpdateResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(contactUpdateResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await updateContact('bind', 'secret-password', 'bind-token');
    await updateContact('change', 'secret-password', 'change-token');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8000/api/v1/auth/contact/bind',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: 'secret-password', verification_token: 'bind-token' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/auth/contact/change',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: 'secret-password', verification_token: 'change-token' }),
      }),
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer active-token');
    }
  });

  it('maps verification, account, and contact responses without persisting secrets', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        verification_enabled: true,
        code_login_enabled: true,
        code_login_reveal_unknown_contact: false,
        password_reset_enabled: true,
        contact_management_enabled: true,
        register_verification_required: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        challenge_id: 'challenge-1', message: '验证码已发送', expires_in: 600, resend_after: 60,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ verification_token: 'verification-token', expires_in: 600 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(loginResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(loginResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: '密码重置成功，请重新登录', must_change_password: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        email: { bound: true, verified: true, masked: 'o***@example.com' },
        phone: { bound: false, verified: false, masked: '' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...loginResponse,
        refresh_token: null,
        message: '联系方式已更新',
        contact: {
          email: { bound: true, verified: true, masked: 'o***@example.com' },
          phone: { bound: false, verified: false, masked: '' },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(getAuthCapabilities()).resolves.toEqual({
      verificationEnabled: true,
      codeLoginEnabled: true,
      codeLoginRevealUnknownContact: false,
      passwordResetEnabled: true,
      contactManagementEnabled: true,
      registerVerificationRequired: true,
    });
    await expect(requestVerification({ channel: 'email', purpose: 'register', target: 'ops@example.com', inviteToken: 'invite-token' })).resolves.toEqual({
      challengeId: 'challenge-1', message: '验证码已发送', expiresIn: 600, resendAfter: 60,
    });
    await expect(confirmVerification('challenge-1', '123456')).resolves.toEqual({ verificationToken: 'verification-token', expiresIn: 600 });
    await expect(loginWithCode('verification-token')).resolves.toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });
    await expect(registerAccount('operator', 'secret-password', 'invite-token', 'verification-token')).resolves.toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
    });
    await expect(resetAccountPassword('verification-token', 'Secret9')).resolves.toBeUndefined();
    await expect(getContactStatus()).resolves.toEqual({
      email: { bound: true, verified: true, masked: 'o***@example.com' },
      phone: { bound: false, verified: false, masked: '' },
    });
    await expect(updateContact('bind', 'secret-password', 'verification-token')).resolves.toEqual({
      token: 'access-token',
      username: 'operator',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
      message: '联系方式已更新',
      contact: {
        email: { bound: true, verified: true, masked: 'o***@example.com' },
        phone: { bound: false, verified: false, masked: '' },
      },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8000/api/v1/auth/capabilities',
      'http://127.0.0.1:8000/api/v1/auth/verifications',
      'http://127.0.0.1:8000/api/v1/auth/verifications/challenge-1/confirm',
      'http://127.0.0.1:8000/api/v1/auth/login/code',
      'http://127.0.0.1:8000/api/v1/auth/register',
      'http://127.0.0.1:8000/api/v1/auth/reset-password',
      'http://127.0.0.1:8000/api/v1/auth/contact',
      'http://127.0.0.1:8000/api/v1/auth/contact/bind',
    ]);
  });

});
