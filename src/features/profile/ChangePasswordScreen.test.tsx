import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as toast from '@/components/feedback/AppToast';
import * as authApi from '@/services/api/auth';
import { useAuthStore } from '@/features/auth/authStore';
import { ChangePasswordScreen } from './ChangePasswordScreen';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));

describe('ChangePasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      error: null,
      role: 'member',
      status: 'signedIn',
      tenantId: 'tenant-1',
      userId: 'user-1',
      username: 'account-user',
      logout: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(authApi, 'changePassword').mockResolvedValue({
      message: '密码修改成功',
      mustChangePassword: false,
    });
  });

  it('changes the signed-in user password and returns to login', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout });
    const screen = await render(<ChangePasswordScreen />);

    await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid123');
    expect(screen.getByText('密码强度：较强')).toBeTruthy();
    expect(screen.getByText('大于 6 位，最多 16 位')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '修改密码' }));

    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith('current-password', 'Valid123'));
    expect(logout).toHaveBeenCalledWith({ remote: false });
    expect(toast.showToast).toHaveBeenCalledWith('密码修改成功，请重新登录', 'success');
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('keeps the form local when new passwords do not match', async () => {
    const screen = await render(<ChangePasswordScreen />);

    await fireEvent.changeText(screen.getByLabelText('当前密码'), 'current-password');
    await fireEvent.changeText(screen.getByLabelText('新密码'), 'Valid123');
    await fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Valid124');
    await fireEvent.press(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByText('两次输入的新密码不一致')).toBeTruthy();
    expect(authApi.changePassword).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
