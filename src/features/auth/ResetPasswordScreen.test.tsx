import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiHttpError } from '@/services/api/client';
import * as toast from '@/components/feedback/AppToast';
import * as authApi from '@/services/api/auth';
import { getAccessToken, setAccessToken } from '@/services/auth/accessToken';
import { clearLocalAppData } from '@/features/profile/localData';
import { useAuthStore } from './authStore';
import { ResetPasswordScreen } from './ResetPasswordScreen';

const mockReplace = jest.fn();
const showToast = toast.showToast;
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/services/cache/offlineCache', () => ({
  clearOfflineCache: jest.fn().mockResolvedValue(undefined),
  configureOfflineCacheIdentity: jest.fn(),
}));
jest.mock('@/features/profile/localData', () => ({ clearLocalAppData: jest.fn() }));

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'mobile';
    useAuthStore.setState({ status: 'signedOut', username: null, tenantId: null, userId: null, role: null, error: null });
    setAccessToken('stale-token');
    jest.restoreAllMocks();
    jest.mocked(clearLocalAppData).mockReset();
    jest.spyOn(toast, 'showToast').mockImplementation(() => {});
    mockReplace.mockClear();
    jest.spyOn(authApi, 'requestVerification').mockResolvedValue({
      challengeId: 'challenge-1', message: '验证码已发送', expiresIn: 300, resendAfter: 0,
    });
    jest.spyOn(authApi, 'confirmVerification').mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 300 });
    jest.spyOn(authApi, 'resetAccountPassword').mockResolvedValue(undefined);
  });

  it('reveals password fields only after verification and resets through the store', async () => {
    const screen = await render(<ResetPasswordScreen />);
    expect(screen.queryByLabelText('新密码')).toBeNull();

    await completeVerification(screen);
    expect(screen.getByLabelText('新密码')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid123');
    await fireEvent.press(screen.getByRole('button', { name: '重置密码' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
    expect(toast.showToast).toHaveBeenCalledWith('密码重置成功，请重新登录', 'success');
    expect(authApi.resetAccountPassword).toHaveBeenCalledWith('one-time-token', 'Valid123');
    expect(getAccessToken()).toBeNull();
    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(screen.queryByDisplayValue('one-time-token')).toBeNull();
    expect(screen.queryByDisplayValue('Valid123')).toBeNull();
    expect(screen.queryByDisplayValue('reset@example.com')).toBeNull();
    expect(mockReplace.mock.calls[0]).toEqual(['/(auth)/login']);
  });

  it('clears verification when channel or contact changes', async () => {
    const screen = await render(<ResetPasswordScreen />);
    await completeVerification(screen);
    expect(screen.getByLabelText('新密码')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '手机号' }));
    expect(screen.queryByLabelText('新密码')).toBeNull();
    expect(screen.getByLabelText('邮箱/手机号').props.value).toBe('');

    await completeVerification(screen, '13800138000');
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), '13900139000');
    expect(screen.queryByLabelText('新密码')).toBeNull();
    expect(screen.getByLabelText('验证码').props.value).toBe('');
  });

  it('hides reset secrets before a resend that later fails', async () => {
    jest.spyOn(authApi, 'requestVerification')
      .mockResolvedValueOnce({ challengeId: 'challenge-1', message: '已发送', expiresIn: 300, resendAfter: 0 })
      .mockRejectedValueOnce(new Error('第二次发送失败'));
    const screen = await render(<ResetPasswordScreen />);
    await completeVerification(screen);
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');

    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('第二次发送失败')).toBeTruthy();
    expect(screen.queryByLabelText('新密码')).toBeNull();
    expect(screen.queryByDisplayValue('Valid123')).toBeNull();
  });

  it('clears secrets and returns to login with a cleanup warning after reset succeeds', async () => {
    jest.mocked(clearLocalAppData).mockImplementationOnce(() => { throw new Error('临时文件删除失败'); });
    jest.mocked(toast.showToast).mockImplementation(showToast);
    const screen = await render(<><ResetPasswordScreen /><toast.AppToast /></>);
    await completeVerification(screen);
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid123');

    await fireEvent.press(screen.getByRole('button', { name: '重置密码' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
    expect(await screen.findByText('密码重置成功，请重新登录；但本地缓存清理未完成：临时文件删除失败')).toBeTruthy();
    expect(screen.queryByText('密码重置成功，请重新登录')).toBeNull();
    expect(toast.showToast).toHaveBeenCalledTimes(1);
    expect(toast.showToast).toHaveBeenCalledWith(
      '密码重置成功，请重新登录；但本地缓存清理未完成：临时文件删除失败',
      'error',
    );
    expect(screen.queryByDisplayValue('reset@example.com')).toBeNull();
    expect(screen.queryByDisplayValue('Valid123')).toBeNull();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('guides an unknown contact to invite registration without delivery copy', async () => {
    jest.spyOn(authApi, 'requestVerification').mockRejectedValue(
      new ApiHttpError('该联系方式尚未注册', 404, 'contact_not_registered'),
    );
    const screen = await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), 'unknown@example.com');
    await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('该联系方式尚未注册')).toBeTruthy();
    expect(screen.queryByText(/验证码将很快送达/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '使用邀请码注册' }));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/register');
  });

  it('disables duplicate reset and keeps a visible password unchanged', async () => {
    let finish!: () => void;
    jest.spyOn(authApi, 'resetAccountPassword').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await render(<ResetPasswordScreen />);
    await completeVerification(screen);
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid123');
    await fireEvent.press(screen.getByRole('button', { name: '显示新密码' }));
    expect(screen.getByLabelText('新密码').props.value).toBe('Valid123');
    expect(screen.getByLabelText('新密码').props.secureTextEntry).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: '重置密码' }));
    expect(screen.getByRole('button', { name: '重置密码' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '重置密码' }));
    expect(authApi.resetAccountPassword).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/login'));
  });

  it('locks reset inputs and navigation, then ignores completion after unmount', async () => {
    let finish!: () => void;
    jest.spyOn(authApi, 'resetAccountPassword').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await render(<ResetPasswordScreen />);
    await completeVerification(screen);
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid123');
    await fireEvent.press(screen.getByRole('button', { name: '重置密码' }));

    expect(screen.getByLabelText('新密码').props.editable).toBe(false);
    expect(screen.getByLabelText('新密码').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '手机号' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '返回登录' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '返回登录' }));
    expect(mockReplace).not.toHaveBeenCalled();

    await screen.unmount();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(toast.showToast).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('clears page secrets when returning to login', async () => {
    const screen = await render(<ResetPasswordScreen />);
    await completeVerification(screen);
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.press(screen.getByRole('button', { name: '返回登录' }));

    expect(screen.queryByDisplayValue('reset@example.com')).toBeNull();
    expect(screen.queryByDisplayValue('Valid123')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });
});

async function completeVerification(
  screen: Awaited<ReturnType<typeof render>>,
  target = 'reset@example.com',
) {
  await fireEvent.changeText(screen.getByLabelText('邮箱/手机号'), target);
  await fireEvent.press(screen.getByRole('button', { name: '发送验证码' }));
  await fireEvent.changeText(screen.getByLabelText('验证码'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: '验证验证码' }).props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByRole('button', { name: '验证验证码' }));
  await waitFor(() => expect(screen.getByText('联系方式已验证')).toBeTruthy());
}
