import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiHttpError } from '@/services/api/client';
import * as toast from '@/components/feedback/AppToast';
import * as authApi from '@/services/api/auth';
import { clearAccessToken } from '@/services/auth/accessToken';
import { useAuthStore } from './authStore';
import { RegisterScreen } from './RegisterScreen';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

const session = {
  token: 'access-token', username: 'new-user', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
};

describe('RegisterScreen', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'mobile';
    useAuthStore.setState({ status: 'signedOut', username: null, tenantId: null, userId: null, role: null, error: null });
    clearAccessToken();
    jest.restoreAllMocks();
    jest.spyOn(toast, 'showToast').mockImplementation(() => {});
    mockReplace.mockClear();
    jest.spyOn(authApi, 'requestVerification').mockResolvedValue({
      challengeId: 'challenge-1', message: '验证码已发送', expiresIn: 300, resendAfter: 0,
    });
    jest.spyOn(authApi, 'confirmVerification').mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 300 });
    jest.spyOn(authApi, 'registerAccount').mockResolvedValue(session);
  });

  it('keeps registration disabled until invite, username, valid matching passwords and verification exist', async () => {
    const screen = await render(<RegisterScreen />);
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(true);

    await fillAccountFields(screen);
    await verifyContact(screen, 'new@example.com');

    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(false);
  });

  it('shows password validation feedback while registration remains disabled', async () => {
    const screen = await render(<RegisterScreen />);

    await fireEvent.changeText(screen.getByLabelText('密码'), 'short');
    await fireEvent.changeText(screen.getByLabelText('确认密码'), 'short');

    expect(screen.getByText('密码长度必须为 7 至 16 个字符')).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('密码'), 'valid-password');
    await fireEvent.changeText(screen.getByLabelText('确认密码'), 'different-pass');

    expect(screen.getByText('两次输入的密码不一致')).toBeTruthy();
  });

  it('shows when password is the same as the username', async () => {
    const screen = await render(<RegisterScreen />);

    await fireEvent.changeText(screen.getByLabelText('用户名'), 'same-password');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'same-password');
    await fireEvent.changeText(screen.getByLabelText('确认密码'), 'same-password');

    expect(screen.getByText('密码不能与用户名相同')).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(true);
  });

  it('accepts seven to sixteen character passwords and shows strength guidance', async () => {
    const screen = await render(<RegisterScreen />);

    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token');
    await fireEvent.changeText(screen.getByLabelText('用户名'), 'new-user');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'abc1234');
    await fireEvent.changeText(screen.getByLabelText('确认密码'), 'abc1234');
    expect(screen.getByText('密码强度：一般')).toBeTruthy();
    expect(screen.getByText('大于 6 位，最多 16 位')).toBeTruthy();
    await verifyContact(screen, 'new@example.com');

    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(false);
  });

  it('keeps the required field order and sends the invite with registration verification', async () => {
    const screen = await render(<RegisterScreen />);
    const labels = screen.getAllByDisplayValue('').map((input) => input.props.accessibilityLabel);
    expect(labels).toEqual(['注册邀请码', '用户名', '密码', '确认密码', '邮箱/手机号', '验证码']);

    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token');
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'new@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    await waitFor(() => expect(authApi.requestVerification).toHaveBeenCalledWith({
      channel: 'email', purpose: 'register', target: 'new@example.com', inviteToken: 'invite-token',
    }));
  });

  it('clears verification when invite, channel or contact changes', async () => {
    const screen = await render(<RegisterScreen />);
    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token');
    await verifyContact(screen, 'first@example.com');
    expect(screen.getByText('联系方式已验证')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'different-invite');
    expect(screen.queryByText('联系方式已验证')).toBeNull();
    expect(screen.getByLabelText('验证码').props.value).toBe('');

    await verifyContact(screen, 'first@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '手机号' }));
    expect(screen.queryByText('联系方式已验证')).toBeNull();
    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('');

    await verifyContact(screen, '13800138000');
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), '13900139000');
    expect(screen.queryByText('联系方式已验证')).toBeNull();
    expect(screen.getByLabelText('验证码').props.value).toBe('');
  });

  it('retains verification for whitespace-equivalent invite edits', async () => {
    const screen = await render(<RegisterScreen />);
    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token ');
    await fireEvent.changeText(screen.getByLabelText('用户名'), 'new-user');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'valid-password');
    await fireEvent.changeText(screen.getByLabelText('确认密码'), 'valid-password');
    await verifyContact(screen, 'new@example.com');
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token');

    expect(screen.getByText('联系方式已验证')).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(authApi.registerAccount).toHaveBeenCalledWith(
      'new-user', 'valid-password', 'invite-token', 'one-time-token',
    ));
  });

  it('cannot submit an old token after resend fails', async () => {
    jest.spyOn(authApi, 'requestVerification')
      .mockResolvedValueOnce({ challengeId: 'challenge-1', message: '已发送', expiresIn: 300, resendAfter: 0 })
      .mockRejectedValueOnce(new Error('第二次发送失败'));
    const screen = await render(<RegisterScreen />);
    await fillAccountFields(screen);
    await verifyContact(screen, 'new@example.com');
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('第二次发送失败')).toBeTruthy();
    expect(screen.queryByText('联系方式已验证')).toBeNull();
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '注册' }));
    expect(authApi.registerAccount).not.toHaveBeenCalled();
  });

  it('guides an already registered contact to login without persisting the invite', async () => {
    jest.spyOn(authApi, 'requestVerification').mockRejectedValue(
      new ApiHttpError('该联系方式已注册，请登录', 409, 'contact_already_registered'),
    );
    const screen = await render(<RegisterScreen />);
    await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'private-invite');
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'used@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('该联系方式已注册，请登录')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '返回登录' }));
    expect(screen.queryByDisplayValue('private-invite')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('shows final registration errors in the top toast', async () => {
    jest.spyOn(authApi, 'registerAccount').mockRejectedValue(
      new ApiHttpError('用户名或联系方式已存在', 409, 'identifier_conflict'),
    );
    const screen = await render(<RegisterScreen />);
    await fillAccountFields(screen);
    await verifyContact(screen, 'used@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '注册' }));

    await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith('用户名或联系方式已存在', 'error'));
    expect(screen.queryByText('用户名或联系方式已存在')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('submits once, clears page secrets, and replaces to analytics after success', async () => {
    let resolve!: (value: authApi.MobileAuthResult) => void;
    jest.spyOn(authApi, 'registerAccount').mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = await render(<RegisterScreen />);
    await fillAccountFields(screen);
    await verifyContact(screen, 'new@example.com');

    await fireEvent.press(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByRole('button', { name: '注册' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '注册' }));
    expect(authApi.registerAccount).toHaveBeenCalledTimes(1);
    resolve(session);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/analytics'));
    expect(toast.showToast).toHaveBeenCalledWith('注册成功', 'success');
    expect(screen.queryByDisplayValue('invite-token')).toBeNull();
    expect(screen.queryByDisplayValue('valid-password')).toBeNull();
    expect(screen.queryByDisplayValue('new@example.com')).toBeNull();
    expect(mockReplace.mock.calls[0]).toEqual(['/(app)/(tabs)/analytics']);
  });

  it('locks registration fields and navigation, then ignores completion after unmount', async () => {
    let resolve!: (value: authApi.MobileAuthResult) => void;
    jest.spyOn(authApi, 'registerAccount').mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = await render(<RegisterScreen />);
    await fillAccountFields(screen);
    await verifyContact(screen, 'new@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '注册' }));

    expect(screen.getByLabelText('注册邀请码').props.editable).toBe(false);
    expect(screen.getByLabelText('注册邀请码').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '手机号' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('邮箱/手机号').props.editable).toBe(false);
    expect(screen.getByLabelText('邮箱/手机号').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '发送验证码' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '已有账号？返回登录' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '已有账号？返回登录' }));
    expect(mockReplace).not.toHaveBeenCalled();

    await screen.unmount();
    await act(async () => {
      resolve(session);
      await Promise.resolve();
    });
    expect(toast.showToast).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('toggles password visibility without changing its value', async () => {
    const screen = await render(<RegisterScreen />);
    await fireEvent.changeText(screen.getByLabelText('密码'), 'valid-password');
    expect(screen.getByLabelText('密码').props.autoComplete).toBe('new-password');
    expect(screen.getByLabelText('密码').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '显示密码' }));
    expect(screen.getByLabelText('密码').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('密码').props.value).toBe('valid-password');
  });
});

async function fillAccountFields(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.changeText(screen.getByLabelText('注册邀请码'), 'invite-token');
  await fireEvent.changeText(screen.getByLabelText('用户名'), 'new-user');
  await fireEvent.changeText(screen.getByLabelText('密码'), 'valid-password');
  await fireEvent.changeText(screen.getByLabelText('确认密码'), 'valid-password');
}

async function verifyContact(screen: Awaited<ReturnType<typeof render>>, target: string) {
  await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), target);
  await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
  await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: '验证验证码' }).props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
  await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
}
