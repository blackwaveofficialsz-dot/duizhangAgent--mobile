import { apiRequest } from './client';
import { readRuntimeConfig } from '@/config/env';
import type { components } from '@/types/generated/api';

type LoginResponse = components['schemas']['LoginResponse'];
type AuthCapabilitiesResponse = components['schemas']['AuthCapabilitiesResponse'];
type ChangePasswordResponse = components['schemas']['ChangePasswordResponse'];
type VerificationCreateResponse = components['schemas']['VerificationCreateResponse'];
type VerificationConfirmResponse = components['schemas']['VerificationConfirmResponse'];

export type IdentifierType = 'username' | 'email' | 'phone';

export type MobileAuthResult = {
  token: string;
  username: string;
  tenantId: string;
  userId: string;
  role: string;
  refreshToken?: string;
};

export type LoginResult = MobileAuthResult;

export type AuthCapabilities = {
  verificationEnabled: boolean;
  codeLoginEnabled: boolean;
  codeLoginRevealUnknownContact: boolean;
  passwordResetEnabled: boolean;
  contactManagementEnabled: boolean;
  registerVerificationRequired: boolean;
};

export type VerificationRequest = {
  channel: 'email' | 'sms';
  purpose: 'register' | 'login' | 'reset_password' | 'bind_contact' | 'change_contact';
  target: string;
  inviteToken?: string;
};

export type VerificationChallenge = {
  challengeId: string;
  message: string;
  expiresIn: number;
  resendAfter: number;
};

export type VerificationConfirmation = {
  verificationToken: string;
  expiresIn: number;
};

export type ContactStatus = components['schemas']['ContactStatusResponse'];
type ContactUpdateResponse = components['schemas']['ContactUpdateResponse'];

export type ContactUpdateResult = MobileAuthResult & {
  message: string;
  contact: ContactStatus;
};

export type ChangePasswordResult = {
  message: string;
  mustChangePassword: boolean;
};

export async function getAuthCapabilities(): Promise<AuthCapabilities> {
  const response = await apiRequest<AuthCapabilitiesResponse>('/api/v1/auth/capabilities', {}, { auth: false });
  return {
    verificationEnabled: response.verification_enabled,
    codeLoginEnabled: response.code_login_enabled,
    codeLoginRevealUnknownContact: response.code_login_reveal_unknown_contact,
    passwordResetEnabled: response.password_reset_enabled,
    contactManagementEnabled: response.contact_management_enabled,
    registerVerificationRequired: response.register_verification_required,
  };
}

export async function requestVerification(request: VerificationRequest): Promise<VerificationChallenge> {
  const publicRequest = request.purpose === 'login'
    || request.purpose === 'register'
    || request.purpose === 'reset_password';
  const response = await apiRequest<VerificationCreateResponse>(
    '/api/v1/auth/verifications',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: request.channel,
        purpose: request.purpose,
        target: request.target,
        ...(request.inviteToken ? { invite_token: request.inviteToken } : {}),
      }),
    },
    publicRequest ? { auth: false } : {},
  );
  return {
    challengeId: response.challenge_id,
    message: response.message,
    expiresIn: response.expires_in,
    resendAfter: response.resend_after,
  };
}

export async function confirmVerification(
  challengeId: string,
  code: string,
): Promise<VerificationConfirmation> {
  const response = await apiRequest<VerificationConfirmResponse>(
    `/api/v1/auth/verifications/${encodeURIComponent(challengeId)}/confirm`,
    jsonPost({ code }),
    { auth: false },
  );
  return { verificationToken: response.verification_token, expiresIn: response.expires_in };
}

export async function loginWithPassword(
  type: IdentifierType,
  identifier: string,
  password: string,
): Promise<MobileAuthResult> {
  const legacy = readRuntimeConfig().authMode === 'legacy';

  const response = await apiRequest<LoginResponse>(
    '/api/v1/auth/login',
    jsonPost(legacy ? {
      username: identifier,
      password,
      client_type: 'mobile',
      device_name: 'mobile-app',
    } : {
      identifier_type: type,
      identifier,
      password,
      client_type: 'mobile',
      device_name: 'mobile-app',
    }),
    { auth: false },
  );
  return toMobileAuthResult(response, { requireRefreshToken: true });
}

export async function loginWithCode(verificationToken: string): Promise<MobileAuthResult> {
  return toMobileAuthResult(await apiRequest<LoginResponse>(
    '/api/v1/auth/login/code',
    jsonPost({
      verification_token: verificationToken,
      client_type: 'mobile',
      device_name: 'mobile-app',
    }),
    { auth: false },
  ), { requireRefreshToken: true });
}

export async function registerAccount(
  username: string,
  password: string,
  inviteToken: string,
  verificationToken: string,
): Promise<MobileAuthResult> {
  return toMobileAuthResult(await apiRequest<LoginResponse>(
    '/api/v1/auth/register',
    jsonPost({
      username,
      password,
      invite_token: inviteToken,
      verification_token: verificationToken,
      client_type: 'mobile',
      device_name: 'mobile-app',
    }),
    { auth: false },
  ), { requireRefreshToken: true });
}

export async function resetAccountPassword(verificationToken: string, newPassword: string): Promise<void> {
  await apiRequest('/api/v1/auth/reset-password', jsonPost({
    verification_token: verificationToken,
    new_password: newPassword,
  }), { auth: false });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const response = await apiRequest<ChangePasswordResponse>('/api/v1/auth/change-password', jsonPost({
    old_password: oldPassword,
    new_password: newPassword,
  }));
  return {
    message: response.message,
    mustChangePassword: response.must_change_password,
  };
}

export function getContactStatus(): Promise<ContactStatus> {
  return apiRequest<ContactStatus>('/api/v1/auth/contact');
}

export async function updateContact(
  mode: 'bind' | 'change',
  password: string,
  verificationToken: string,
): Promise<ContactUpdateResult> {
  const response = await apiRequest<ContactUpdateResponse>(
    `/api/v1/auth/contact/${mode}`,
    jsonPost({ password, verification_token: verificationToken }),
  );
  return { ...toMobileAuthResult(response), message: response.message, contact: response.contact };
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function toMobileAuthResult(
  response: LoginResponse,
  options: { requireRefreshToken?: boolean } = {},
): MobileAuthResult {
  if (!response.username.trim()) throw new Error('登录响应缺少 username');
  if (options.requireRefreshToken && !response.refresh_token) {
    throw new Error('登录响应缺少 refresh token');
  }
  return {
    token: response.token,
    username: response.username,
    tenantId: response.tenant_id,
    userId: response.user_id,
    role: response.role,
    refreshToken: response.refresh_token ?? undefined,
  };
}
