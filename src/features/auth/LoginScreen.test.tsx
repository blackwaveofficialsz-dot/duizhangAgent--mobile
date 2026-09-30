import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ApiHttpError } from '@/services/api/client';
import * as toast from '@/components/feedback/AppToast';
import * as authApi from '@/services/api/auth';
import { clearAccessToken } from '@/services/auth/accessToken';
import { useAuthStore } from './authStore';
import { LoginScreen } from './LoginScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

const capabilities: authApi.AuthCapabilities = {
  verificationEnabled: true,
  codeLoginEnabled: true,
  codeLoginRevealUnknownContact: true,
  passwordResetEnabled: true,
  contactManagementEnabled: true,
  registerVerificationRequired: true,
};

const session = {
  token: 'access-token', username: 'operator', tenantId: 'tenant-1', userId: 'user-1', role: 'member',
};

describe('LoginScreen', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'mobile';
    useAuthStore.setState({
      status: 'signedOut', username: null, tenantId: null, userId: null, role: null, error: null,
    });
    clearAccessToken();
    jest.restoreAllMocks();
    jest.spyOn(toast, 'showToast').mockImplementation(() => {});
    mockReplace.mockClear();
    jest.spyOn(authApi, 'getAuthCapabilities').mockResolvedValue(capabilities);
    jest.spyOn(authApi, 'loginWithPassword').mockResolvedValue(session);
    jest.spyOn(authApi, 'requestVerification').mockResolvedValue({
      challengeId: 'challenge-1', message: '验证码已发送', expiresIn: 300, resendAfter: 0,
    });
    jest.spyOn(authApi, 'confirmVerification').mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 300 });
    jest.spyOn(authApi, 'loginWithCode').mockResolvedValue(session);
  });

  it('keeps login disabled until typed password credentials are present', async () => {
    const screen = await render(<LoginScreen />);
    const submit = screen.getByRole('button', { name: '登录' });

    expect(screen.getByTestId('brand-mark')).toBeTruthy();
    expect(screen.getByTestId('auth-primary-button')).toHaveStyle({ alignSelf: 'stretch', height: 52 });
    expect(screen.queryByText('账号类型')).toBeNull();
    expect(screen.queryByRole('button', { name: '选择用户名' })).toBeNull();
    expect(screen.getByPlaceholderText('请输入用户名/手机号/邮箱')).toBeTruthy();
    expect(submit.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('账号'), 'demo');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'secret');
    expect(screen.getByRole('button', { name: '登录' }).props.accessibilityState.disabled).toBe(false);
  });

  it('anchors the login form near the top when switching login modes', async () => {
    const screen = await render(<LoginScreen />);
    const initialStyle = StyleSheet.flatten(screen.getByTestId('auth-screen-scroll').props.contentContainerStyle);

    expect(initialStyle).toMatchObject({ justifyContent: 'flex-start' });
    expect(initialStyle.paddingTop).toBeGreaterThan(0);

    await fireEvent.press(await screen.findByRole('button', { name: '验证码登录' }));
    const codeStyle = StyleSheet.flatten(screen.getByTestId('auth-screen-scroll').props.contentContainerStyle);

    expect(codeStyle).toMatchObject({ justifyContent: 'flex-start', paddingTop: initialStyle.paddingTop });
  });

  it.each([
    ['ops@example.com', 'email'],
    ['13900139000', 'phone'],
    ['demo', 'username'],
  ] as const)('infers password identifier type for %s and replaces to analytics', async (identifier, type) => {
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('账号'), identifier);
    await fireEvent.changeText(screen.getByLabelText('密码'), 'secret-password');
    await fireEvent.press(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(authApi.loginWithPassword).toHaveBeenCalledWith(type, identifier, 'secret-password'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/analytics');
    expect(toast.showToast).toHaveBeenCalledWith('登录成功', 'success');
    expect(screen.queryByDisplayValue('secret-password')).toBeNull();
  });

  it('submits password login from the password return key', async () => {
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('账号'), 'demo');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'secret-password');
    await fireEvent(screen.getByLabelText('密码'), 'submitEditing');

    await waitFor(() => expect(authApi.loginWithPassword).toHaveBeenCalledWith('username', 'demo', 'secret-password'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/analytics');
  });

  it('shows code login only after effective capability is ready', async () => {
    let resolve!: (value: authApi.AuthCapabilities) => void;
    jest.spyOn(authApi, 'getAuthCapabilities').mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = await render(<LoginScreen />);
    expect(screen.queryByRole('button', { name: '验证码登录' })).toBeNull();

    resolve(capabilities);
    expect(await screen.findByRole('button', { name: '验证码登录' })).toBeTruthy();
  });

  it('guides an unknown code-login contact to registration without claiming delivery', async () => {
    jest.spyOn(authApi, 'requestVerification').mockRejectedValue(
      new ApiHttpError('该联系方式尚未注册', 404, 'contact_not_registered'),
    );
    const screen = await render(<LoginScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '验证码登录' }));
    expect(screen.queryByText('验证渠道')).toBeNull();
    expect(screen.queryByRole('button', { name: '邮箱' })).toBeNull();
    expect(screen.queryByRole('button', { name: '手机号' })).toBeNull();
    expect(screen.getByPlaceholderText('请输入手机号/邮箱')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'unknown@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('该联系方式尚未注册')).toBeTruthy();
    expect(authApi.requestVerification).toHaveBeenCalledWith({ channel: 'email', purpose: 'login', target: 'unknown@example.com' });
    expect(screen.queryByText(/验证码将很快送达/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '使用邀请码注册' }));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/register');
  });

  it('rejects an invalid code-login contact before sending a verification request', async () => {
    const screen = await render(<LoginScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '验证码登录' }));
    expect(screen.queryByRole('button', { name: '验证验证码' })).toBeNull();
    expect(screen.getByRole('button', { name: '登录' })).toHaveStyle({ alignSelf: 'stretch', height: 52 });
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'not-a-contact');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(screen.getByText('请输入有效的手机号或邮箱')).toBeTruthy();
    expect(authApi.requestVerification).not.toHaveBeenCalled();
  });

  it('logs in with a confirmed code without putting the token in navigation', async () => {
    const screen = await render(<LoginScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '验证码登录' }));
    await completeVerification(screen);

    await waitFor(() => expect(authApi.loginWithCode).toHaveBeenCalledWith('one-time-token'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/analytics');
    expect(toast.showToast).toHaveBeenCalledWith('登录成功', 'success');
    expect(mockReplace.mock.calls[0]).toEqual(['/(app)/(tabs)/analytics']);
    expect(screen.queryByDisplayValue('one-time-token')).toBeNull();
    expect(screen.queryByDisplayValue('login@example.com')).toBeNull();
  });

  it('disables duplicate password submit and preserves a visible password', async () => {
    let resolve!: (value: authApi.MobileAuthResult) => void;
    jest.spyOn(authApi, 'loginWithPassword').mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('账号'), 'demo');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'secret-password');
    await fireEvent.press(screen.getByRole('button', { name: '显示密码' }));
    expect(screen.getByLabelText('密码').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('密码').props.value).toBe('secret-password');

    await fireEvent.press(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByRole('button', { name: '登录' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '登录' }));
    expect(authApi.loginWithPassword).toHaveBeenCalledTimes(1);
    resolve(session);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/analytics'));
  });

  it('locks login inputs and navigation, then ignores completion after unmount', async () => {
    let resolve!: (value: authApi.MobileAuthResult) => void;
    jest.spyOn(authApi, 'loginWithPassword').mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('账号'), 'demo');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'secret-password');
    await fireEvent.press(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByLabelText('账号').props.editable).toBe(false);
    expect(screen.getByLabelText('账号').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '选择邮箱' })).toBeNull();
    expect(screen.getByRole('button', { name: '忘记密码' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '使用邀请码注册' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '使用邀请码注册' }));
    expect(mockReplace).not.toHaveBeenCalled();

    await screen.unmount();
    await act(async () => {
      resolve(session);
      await Promise.resolve();
    });
    expect(toast.showToast).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows a server password error and retains navigation links', async () => {
    jest.spyOn(authApi, 'loginWithPassword').mockRejectedValue(new Error('用户名或密码错误'));
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('账号'), 'demo');
    await fireEvent.changeText(screen.getByLabelText('密码'), 'wrong');
    await fireEvent.press(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.getByText('用户名或密码错误')).toBeTruthy());
    expect(screen.getByRole('button', { name: '忘记密码' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '使用邀请码注册' })).toBeTruthy();
  });
});

async function completeVerification(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'login@example.com');
  await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
  await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' }).props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByRole('button', { name: '登录' }));
}
