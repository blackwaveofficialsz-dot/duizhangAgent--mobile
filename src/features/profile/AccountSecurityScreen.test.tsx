import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { useRouter } from 'expo-router';
import { ApiHttpError } from '@/services/api/client';
import * as toast from '@/components/feedback/AppToast';
import * as authApi from '@/services/api/auth';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/services/auth/accessToken';
import { useAuthStore } from '@/features/auth/authStore';
import { useAuthCapabilities } from '@/features/auth/useAuthCapabilities';
import { AccountSecurityScreen } from './AccountSecurityScreen';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/features/auth/useAuthCapabilities', () => ({ useAuthCapabilities: jest.fn() }));

const unboundContacts: authApi.ContactStatus = {
  email: { bound: false, masked: '', verified: false },
  phone: { bound: false, masked: '', verified: false },
};
const verifiedEmail: authApi.ContactStatus = {
  email: { bound: true, masked: 'n***@example.com', verified: true },
  phone: { bound: false, masked: '', verified: false },
};
const verifiedPhone: authApi.ContactStatus = {
  email: { bound: false, masked: '', verified: false },
  phone: { bound: true, masked: '+86 138****8000', verified: true },
};
const enabledCapabilities: authApi.AuthCapabilities = {
  verificationEnabled: true,
  codeLoginEnabled: true,
  codeLoginRevealUnknownContact: false,
  passwordResetEnabled: true,
  contactManagementEnabled: true,
  registerVerificationRequired: true,
};
const rotatedSession: authApi.ContactUpdateResult = {
  token: 'rotated-token',
  username: 'account-user',
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'member',
  message: '邮箱绑定成功',
  contact: verifiedEmail,
};
const originalRefreshSession = useAuthStore.getState().refreshSession;

describe('AccountSecurityScreen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    clearAccessToken();
    setAccessToken('old-token');
    useAuthStore.setState({
      error: null,
      role: 'member',
      status: 'signedIn',
      tenantId: 'tenant-1',
      userId: 'user-1',
      username: 'account-user',
      refreshSession: originalRefreshSession,
    });
    jest.mocked(useRouter).mockReturnValue({ replace: jest.fn() } as never);
    jest.mocked(useAuthCapabilities).mockReturnValue({ status: 'ready', capabilities: enabledCapabilities });
    jest.spyOn(toast, 'showToast').mockImplementation(() => {});
    jest.spyOn(authApi, 'getContactStatus').mockResolvedValue(unboundContacts);
    jest.spyOn(authApi, 'requestVerification').mockResolvedValue({
      challengeId: 'challenge-1', message: '验证码已发送', expiresIn: 300, resendAfter: 0,
    });
    jest.spyOn(authApi, 'confirmVerification').mockResolvedValue({
      verificationToken: 'verified-token', expiresIn: 300,
    });
    jest.spyOn(authApi, 'updateContact').mockResolvedValue(rotatedSession);
  });

  afterEach(() => {
    clearAccessToken();
  });

  it('opens email binding with blank contact and current password fields', async () => {
    const screen = await render(<AccountSecurityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '绑定邮箱' }));

    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('');
    expect(screen.getByLabelText('当前密码').props.value).toBe('');
  });

  it('opens the signed-in change password page from account security', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    const screen = await render(<AccountSecurityScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '修改密码' }));

    expect(push).toHaveBeenCalledWith('/profile/change-password');
  });

  it('shows masked contact verification status without exposing a full contact', async () => {
    jest.spyOn(authApi, 'getContactStatus').mockResolvedValue(verifiedEmail);
    const screen = await render(<AccountSecurityScreen />);

    expect(await screen.findByText('n***@example.com')).toBeTruthy();
    expect(screen.getByText('已验证')).toBeTruthy();
    expect(screen.queryByText('new@example.com')).toBeNull();
  });

  it('keeps the page open, rotates the token, shows only masked status and clears secrets after binding', async () => {
    const replace = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ replace } as never);
    const screen = await render(<AccountSecurityScreen />);

    await completeContactChange(screen, 'new@example.com');

    await waitFor(() => expect(getAccessToken()).toBe('rotated-token'));
    expect(useAuthStore.getState().status).toBe('signedIn');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('n***@example.com')).toBeTruthy();
    expect(screen.queryByText('new@example.com')).toBeNull();
    expect(screen.queryByDisplayValue('new@example.com')).toBeNull();
    expect(screen.queryByDisplayValue('current-password')).toBeNull();
    expect(toast.showToast).toHaveBeenCalledWith('邮箱绑定成功', 'success');
  });

  it('uses the change operation for an already bound contact and still opens blank fields', async () => {
    jest.spyOn(authApi, 'getContactStatus').mockResolvedValue(verifiedEmail);
    const screen = await render(<AccountSecurityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '更换邮箱' }));

    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('');
    expect(screen.getByLabelText('当前密码').props.value).toBe('');
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'replacement@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
    await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
    await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');
    await fireEvent.press(screen.getByRole('button', { name: '确认更换' }));

    await waitFor(() => expect(authApi.updateContact).toHaveBeenCalledWith(
      'change', 'current-password', 'verified-token',
    ));
  });

  it('does not expose bind or change actions before contact status is ready', async () => {
    let resolveInitial!: (value: authApi.ContactStatus) => void;
    jest.spyOn(authApi, 'getContactStatus').mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }));
    const screen = await render(<AccountSecurityScreen />);

    expect(screen.queryByRole('button', { name: '绑定邮箱' })).toBeNull();
    expect(screen.queryByRole('button', { name: '绑定手机号' })).toBeNull();
    expect(screen.getByLabelText('正在读取联系方式')).toBeTruthy();
    await act(async () => {
      resolveInitial(unboundContacts);
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: '绑定邮箱' })).toBeTruthy();
  });

  it('keeps contact operations unavailable and shows the exact non-401 load error', async () => {
    jest.spyOn(authApi, 'getContactStatus').mockRejectedValue(new Error('联系方式读取失败'));
    const screen = await render(<AccountSecurityScreen />);

    expect(await screen.findByText('联系方式读取失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '绑定邮箱' })).toBeNull();
    expect(screen.queryByRole('button', { name: '绑定手机号' })).toBeNull();
  });

  it('accepts contact status after a StrictMode effect cleanup and replay', async () => {
    const screen = await render(
      <StrictMode>
        <AccountSecurityScreen />
      </StrictMode>,
    );

    expect(await screen.findByRole('button', { name: '绑定邮箱' })).toBeTruthy();
  });

  it('does not let an older contact request overwrite a newer update', async () => {
    let capabilitiesState = { status: 'ready' as const, capabilities: enabledCapabilities };
    jest.mocked(useAuthCapabilities).mockImplementation(() => capabilitiesState);
    let resolveOld!: (value: authApi.ContactStatus) => void;
    jest.spyOn(authApi, 'getContactStatus')
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(unboundContacts);
    const screen = await render(<AccountSecurityScreen />);

    capabilitiesState = {
      status: 'ready',
      capabilities: { ...enabledCapabilities, contactManagementEnabled: false },
    };
    await screen.rerender(<AccountSecurityScreen />);
    capabilitiesState = { status: 'ready', capabilities: enabledCapabilities };
    await screen.rerender(<AccountSecurityScreen />);
    await completeContactChange(screen, 'new@example.com');
    await act(async () => {
      resolveOld(unboundContacts);
      await Promise.resolve();
    });

    expect(screen.getByText('n***@example.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '绑定邮箱' })).toBeNull();
  });

  it('keeps the entered contact and inline error when the contact is already registered', async () => {
    jest.spyOn(authApi, 'updateContact').mockRejectedValue(
      new ApiHttpError('该联系方式已注册', 409, 'contact_already_registered'),
    );
    const screen = await render(<AccountSecurityScreen />);

    await completeContactChange(screen, 'used@example.com');

    expect(await screen.findByText('该联系方式已注册')).toBeTruthy();
    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('used@example.com');
    expect(screen.getByLabelText('当前密码').props.value).toBe('current-password');
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it('locks channel actions while verification is being sent and releases them after failure', async () => {
    let rejectSend!: (error: Error) => void;
    jest.spyOn(authApi, 'requestVerification').mockReturnValue(new Promise((_resolve, reject) => { rejectSend = reject; }));
    const screen = await render(<AccountSecurityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '绑定邮箱' }));
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'new@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '绑定手机号' }).props.accessibilityState.disabled).toBe(true));
    await act(async () => {
      rejectSend(new Error('发送失败'));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '绑定手机号' }).props.accessibilityState.disabled).toBe(false));
  });

  it('shows a capability message instead of contact actions when management is disabled', async () => {
    jest.mocked(useAuthCapabilities).mockReturnValue({
      status: 'ready', capabilities: { ...enabledCapabilities, contactManagementEnabled: false },
    });
    const screen = await render(<AccountSecurityScreen />);

    expect(screen.getByText('联系方式管理暂未开放')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '绑定邮箱' })).toBeNull();
    expect(authApi.getContactStatus).not.toHaveBeenCalled();
  });

  it('exposes an accessible progress indicator while account security capability is loading', async () => {
    jest.mocked(useAuthCapabilities).mockReturnValue({ status: 'loading', capabilities: null });
    const screen = await render(<AccountSecurityScreen />);

    expect(screen.getByLabelText('正在读取账号安全设置').props.accessibilityRole).toBe('progressbar');
    expect(authApi.getContactStatus).not.toHaveBeenCalled();
  });

  it('does not add duplicate page feedback when contact status loading returns 401', async () => {
    jest.spyOn(authApi, 'getContactStatus').mockRejectedValue(
      new ApiHttpError('登录状态已失效', 401, 'unauthorized'),
    );
    const screen = await render(<AccountSecurityScreen />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('登录状态已失效')).toBeNull();
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it('binds and changes a phone through the symmetric sms flow', async () => {
    jest.spyOn(authApi, 'updateContact').mockResolvedValue({
      ...rotatedSession,
      message: '手机号绑定成功',
      contact: verifiedPhone,
    });
    const bindScreen = await render(<AccountSecurityScreen />);

    await completeContactOperation(bindScreen, {
      actionLabel: '绑定手机号',
      confirmLabel: '确认绑定',
      target: '13800138000',
    });
    expect(authApi.requestVerification).toHaveBeenCalledWith({
      channel: 'sms', purpose: 'bind_contact', target: '13800138000',
    });
    expect(authApi.updateContact).toHaveBeenLastCalledWith('bind', 'current-password', 'verified-token');
    await bindScreen.unmount();

    jest.clearAllMocks();
    jest.spyOn(authApi, 'getContactStatus').mockResolvedValue(verifiedPhone);
    jest.spyOn(authApi, 'requestVerification').mockResolvedValue({
      challengeId: 'challenge-2', message: '验证码已发送', expiresIn: 300, resendAfter: 0,
    });
    jest.spyOn(authApi, 'confirmVerification').mockResolvedValue({
      verificationToken: 'verified-token', expiresIn: 300,
    });
    jest.spyOn(authApi, 'updateContact').mockResolvedValue({
      ...rotatedSession,
      message: '手机号更换成功',
      contact: verifiedPhone,
    });
    const changeScreen = await render(<AccountSecurityScreen />);

    await completeContactOperation(changeScreen, {
      actionLabel: '更换手机号',
      confirmLabel: '确认更换',
      target: '13900139000',
    });
    expect(authApi.requestVerification).toHaveBeenCalledWith({
      channel: 'sms', purpose: 'change_contact', target: '13900139000',
    });
    expect(authApi.updateContact).toHaveBeenLastCalledWith('change', 'current-password', 'verified-token');
  });

  it('cannot submit an old contact token after resend fails', async () => {
    jest.spyOn(authApi, 'requestVerification')
      .mockResolvedValueOnce({ challengeId: 'challenge-1', message: '已发送', expiresIn: 300, resendAfter: 0 })
      .mockRejectedValueOnce(new Error('第二次发送失败'));
    const screen = await render(<AccountSecurityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '绑定邮箱' }));
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'new@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
    await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
    await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');

    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('第二次发送失败')).toBeTruthy();
    expect(screen.queryByText('联系方式已验证')).toBeNull();
    expect(screen.getByRole('button', { name: '确认绑定' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '确认绑定' }));
    expect(authApi.updateContact).not.toHaveBeenCalled();
  });

  it('does not refresh, notify or clear entered values when an update returns 401', async () => {
    jest.spyOn(authApi, 'updateContact').mockRejectedValue(
      new ApiHttpError('登录状态已失效', 401, 'unauthorized'),
    );
    const refreshSession = jest.fn();
    useAuthStore.setState({ refreshSession });
    const screen = await render(<AccountSecurityScreen />);
    await completeContactChange(screen, 'new@example.com');

    expect(refreshSession).not.toHaveBeenCalled();
    expect(toast.showToast).not.toHaveBeenCalled();
    expect(screen.queryByText('登录状态已失效')).toBeNull();
    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('new@example.com');
  });

  it('safely refreshes the session but does not notify after an update resolves after unmount', async () => {
    let resolveUpdate!: (value: authApi.ContactUpdateResult) => void;
    jest.spyOn(authApi, 'updateContact').mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    const screen = await render(<AccountSecurityScreen />);
    await completeContactChange(screen, 'new@example.com', false);

    await screen.unmount();
    await act(async () => {
      resolveUpdate(rotatedSession);
      await Promise.resolve();
    });

    expect(getAccessToken()).toBe('rotated-token');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', username: 'account-user' });
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it('does not apply an old contact result after a newer session replaces its token', async () => {
    let resolveUpdate!: (value: authApi.ContactUpdateResult) => void;
    jest.spyOn(authApi, 'updateContact').mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    const screen = await render(<AccountSecurityScreen />);
    await completeContactChange(screen, 'new@example.com', false);
    useAuthStore.getState().commitSession({
      token: 'newer-token', username: 'newer-session', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
    });

    await act(async () => {
      resolveUpdate(rotatedSession);
      await Promise.resolve();
    });

    expect(getAccessToken()).toBe('newer-token');
    expect(useAuthStore.getState().username).toBe('newer-session');
    expect(toast.showToast).not.toHaveBeenCalled();
  });
});

async function completeContactChange(
  screen: Awaited<ReturnType<typeof render>>,
  target: string,
  waitForCompletion = true,
) {
  await fireEvent.press(await screen.findByRole('button', { name: '绑定邮箱' }));
  await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), target);
  await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
  await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: '验证验证码' }).props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
  await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');
  await fireEvent.press(screen.getByRole('button', { name: '确认绑定' }));
  if (waitForCompletion) await waitFor(() => expect(authApi.updateContact).toHaveBeenCalledTimes(1));
}

async function completeContactOperation(
  screen: Awaited<ReturnType<typeof render>>,
  input: { actionLabel: string; confirmLabel: string; target: string },
) {
  await fireEvent.press(await screen.findByRole('button', { name: input.actionLabel }));
  await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), input.target);
  await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
  await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: '验证验证码' }).props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
  await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');
  await fireEvent.press(screen.getByRole('button', { name: input.confirmLabel }));
  await waitFor(() => expect(authApi.updateContact).toHaveBeenCalled());
}
