import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Share } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import { readRuntimeConfig } from '@/config/env';
import { useAuthStore } from '@/features/auth/authStore';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useThemeStore } from '@/theme/themeStore';
import { AppearanceScreen } from './AppearanceScreen';
import { AccountDeletionScreen } from './AccountDeletionScreen';
import { CacheDiagnosticsScreen } from './CacheDiagnosticsScreen';
import { clearLocalAppData } from './localData';
import { clearOfflineCache, getOfflineCacheDiagnostics, getOfflineCacheLastSyncedAt } from '@/services/cache/offlineCache';
import { LegalDocumentScreen } from './LegalDocumentScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { ProfileScreen } from './ProfileScreen';
import { StoragePrivacyScreen } from './StoragePrivacyScreen';

jest.mock('expo-linking', () => ({ openURL: jest.fn().mockResolvedValue(true) }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');

  return {
    SafeAreaView: ({ children, testID, ...props }: { children?: unknown; testID?: string }) => (
      React.createElement(View, { ...props, testID: testID ?? 'profile-safe-area' }, children)
    ),
  };
});
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('@/config/env', () => ({
  readRuntimeConfig: jest.fn(() => ({
    apiUrl: 'https://blackwave.org.cn/yuanji',
    appEnv: 'development',
    authMode: 'mobile',
    enableCacheDiagnostics: false,
  })),
}));
jest.mock('./localData', () => ({ clearLocalAppData: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  clearOfflineCache: jest.fn().mockResolvedValue(undefined),
  getOfflineCacheDiagnostics: jest.fn().mockResolvedValue({
    analytics: { dailyBuckets: 0, entries: 0, snapshots: 0 },
    available: false,
    categories: { analytics: 0, sessions: 0, tasks: 0 },
    identity: null,
    latestSyncedAt: null,
    totalEntries: 0,
  }),
  getOfflineCacheLastSyncedAt: jest.fn().mockResolvedValue(null),
}));

describe('Profile screens', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      error: null,
      role: 'admin',
      status: 'signedIn',
      tenantId: 'tenant-1',
      userId: 'user-1',
      username: '林豪',
    });
    useThemeStore.setState({ hydrated: true, mode: 'system', revision: 0 });
    jest.mocked(readRuntimeConfig).mockReturnValue({
      apiUrl: 'https://blackwave.org.cn/yuanji',
      appEnv: 'development',
      authMode: 'mobile',
      enableCacheDiagnostics: false,
    });
    jest.mocked(getOfflineCacheDiagnostics).mockResolvedValue({
      analytics: { dailyBuckets: 0, entries: 0, snapshots: 0 },
      available: false,
      categories: { analytics: 0, sessions: 0, tasks: 0 },
      identity: null,
      latestSyncedAt: null,
      totalEntries: 0,
    });
    jest.mocked(getOfflineCacheLastSyncedAt).mockResolvedValue(null);
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
  });

  it('shows the current identity and opens the personal setting entries', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    const screen = await render(<ProfileScreen />);

    expect(screen.getByText('林豪')).toBeTruthy();
    expect(screen.getByText('管理员')).toBeTruthy();
    expect(screen.getByText('tenant-1')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '外观设置' }));
    await fireEvent.press(screen.getByRole('button', { name: '通知设置' }));
    await fireEvent.press(screen.getByRole('button', { name: '存储、隐私与关于' }));
    await fireEvent.press(screen.getByRole('button', { name: '账号与安全' }));

    expect(push).toHaveBeenNthCalledWith(1, '/profile/appearance');
    expect(push).toHaveBeenNthCalledWith(2, '/profile/notifications');
    expect(push).toHaveBeenNthCalledWith(3, '/profile/storage-privacy');
    expect(push).toHaveBeenNthCalledWith(4, '/profile/account-security');
  });

  it('lets the bottom tab bar own the bottom safe-area edge', async () => {
    const screen = await render(<ProfileScreen />);

    expect(screen.getByTestId('profile-safe-area').props.edges).toEqual(['left', 'right']);
  });

  it('requires confirmation before signing out', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout });
    const screen = await render(<ProfileScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '退出登录' }));
    expect(logout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: '同意执行' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith('已退出登录', 'success');
  });

  it('does not report logout success when encrypted cache cleanup fails', async () => {
    const logout = jest.fn().mockRejectedValue(new Error('本地缓存删除失败'));
    useAuthStore.setState({ logout });
    const screen = await render(<ProfileScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '退出登录' }));
    await fireEvent.press(screen.getByRole('button', { name: '同意执行' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('本地缓存删除失败', 'error'));
    expect(showToast).not.toHaveBeenCalledWith('已退出登录', 'success');
  });

  it('changes and persists the selected appearance immediately', async () => {
    const screen = await render(
      <ThemeProvider>
        <AppearanceScreen />
      </ThemeProvider>,
    );

    expect(screen.queryByText('外观')).toBeNull();
    expect(screen.getByText('切换后立即生效，并保留为下次启动时的偏好。')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '深色模式' }));

    expect(useThemeStore.getState().mode).toBe('dark');
    expect(showToast).toHaveBeenCalledWith('已切换为深色模式', 'success');
  });

  it('shows that task notifications have not been enabled before JPush integration', async () => {
    const screen = await render(<NotificationSettingsScreen />);

    expect(screen.queryByText('通知')).toBeNull();
    expect(screen.getByText('通知服务尚未启用')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the real cache sync time and opens every privacy entry', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(getOfflineCacheLastSyncedAt).mockResolvedValue(Date.parse('2026-07-16T15:05:00+08:00'));
    const screen = await render(<StoragePrivacyScreen />);

    expect(screen.queryByText('存储、隐私与关于')).toBeNull();
    expect(screen.getByText('只保存当前账号已查看的会话、任务和经营分析结果；不同门店、日期和筛选条件分别保存。')).toBeTruthy();
    expect(await screen.findByText('最后同步：2026-07-16 15:05')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '隐私政策' }));
    await fireEvent.press(screen.getByRole('button', { name: '用户协议' }));
    await fireEvent.press(screen.getByRole('button', { name: '第三方 SDK 清单' }));
    await fireEvent.press(screen.getByRole('button', { name: '账户删除申请' }));

    expect(push).toHaveBeenNthCalledWith(1, '/profile/privacy-policy');
    expect(push).toHaveBeenNthCalledWith(2, '/profile/user-agreement');
    expect(push).toHaveBeenNthCalledWith(3, '/profile/third-party-sdks');
    expect(push).toHaveBeenNthCalledWith(4, '/profile/account-deletion');
  });

  it('shows cache diagnostics to admins in debug builds', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    const screen = await render(<StoragePrivacyScreen />);
    await screen.findByText('最后同步：暂无同步记录');

    expect(screen.getByRole('button', { name: '本地缓存诊断' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '本地缓存诊断' }));
    expect(push).toHaveBeenCalledWith('/profile/cache-diagnostics');
  });

  it('hides cache diagnostics from members', async () => {
    useAuthStore.setState({ role: 'member' });
    const screen = await render(<StoragePrivacyScreen />);
    await screen.findByText('最后同步：暂无同步记录');

    expect(screen.queryByRole('button', { name: '本地缓存诊断' })).toBeNull();
  });

  it('hides cache diagnostics from production admins by default', async () => {
    jest.mocked(readRuntimeConfig).mockReturnValue({
      apiUrl: 'https://blackwave.org.cn/yuanji',
      appEnv: 'production',
      authMode: 'mobile',
      enableCacheDiagnostics: false,
    });
    const screen = await render(<StoragePrivacyScreen />);
    await screen.findByText('最后同步：暂无同步记录');

    expect(screen.queryByRole('button', { name: '本地缓存诊断' })).toBeNull();
  });

  it('shows cache diagnostics to production admins when explicitly enabled', async () => {
    jest.mocked(readRuntimeConfig).mockReturnValue({
      apiUrl: 'https://blackwave.org.cn/yuanji',
      appEnv: 'production',
      authMode: 'mobile',
      enableCacheDiagnostics: true,
    });
    const screen = await render(<StoragePrivacyScreen />);
    await screen.findByText('最后同步：暂无同步记录');

    expect(screen.getByRole('button', { name: '本地缓存诊断' })).toBeTruthy();
  });

  it('loads cache diagnostics only after opening the diagnostics screen', async () => {
    jest.mocked(getOfflineCacheDiagnostics).mockResolvedValue({
      analytics: { dailyBuckets: 1, entries: 2, snapshots: 1 },
      available: true,
      categories: { analytics: 2, sessions: 1, tasks: 1 },
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      latestSyncedAt: Date.parse('2026-07-16T15:05:00+08:00'),
      totalEntries: 4,
    });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const screen = await render(<CacheDiagnosticsScreen />);

    expect(await screen.findByText('缓存可用')).toBeTruthy();
    expect(screen.getByText('tenant-1')).toBeTruthy();
    expect(screen.getByText('user-1')).toBeTruthy();
    expect(screen.getByText('总条目')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('analytics')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByText('snapshot')).toBeTruthy();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText('daily bucket')).toBeTruthy();
    expect(screen.getByText('最后同步')).toBeTruthy();
    expect(screen.getByText('2026-07-16 15:05')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '复制诊断摘要' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('totalEntries: 4'),
    }));
    expect(share).toHaveBeenCalledWith({ message: expect.not.stringContaining('hidden') });
  });

  it('shows an error state when cache diagnostics cannot be read', async () => {
    jest.mocked(getOfflineCacheDiagnostics).mockRejectedValue(new Error('离线缓存已重置，请重新同步'));
    const screen = await render(<CacheDiagnosticsScreen />);

    expect(await screen.findByText('读取失败')).toBeTruthy();
    expect(screen.getByText('离线缓存已重置，请重新同步')).toBeTruthy();
  });

  it('confirms cache clearing and removes its last sync time', async () => {
    jest.mocked(getOfflineCacheLastSyncedAt).mockResolvedValue(Date.parse('2026-07-16T15:05:00+08:00'));
    const screen = await render(<StoragePrivacyScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '清理本地缓存' }));
    await fireEvent.press(screen.getByRole('button', { name: '同意执行' }));

    expect(clearLocalAppData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(clearOfflineCache).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith('本地缓存已清理', 'success');
    expect(screen.getByText('最后同步：暂无同步记录')).toBeTruthy();
  });

  it('renders real local legal documents', async () => {
    const documents = [
      ['privacy', '隐私政策', '本说明适用于 BlackWave 寰澜内部试用版，说明应用为提供对账、任务、对话和经营分析功能而处理的数据。'],
      ['agreement', '用户协议', '使用 BlackWave 寰澜前，请确认你已获得所属组织授权，并仅在授权范围内处理业务数据。'],
      ['sdks', '第三方 SDK 清单', '以下能力随当前应用构建启用。它们仅在对应功能需要时工作；JPush 尚未接入，不属于当前启用清单。'],
    ] as const;
    const screen = await render(<LegalDocumentScreen kind="privacy" />);

    for (const [kind, title, intro] of documents) {
      await screen.rerender(<LegalDocumentScreen kind={kind} />);
      expect(screen.queryByText(title)).toBeNull();
      expect(screen.getByText(intro)).toBeTruthy();
      expect(screen.getByText('生效日期：2026年7月17日')).toBeTruthy();
    }
    await screen.unmount();
  });

  it('opens a prefilled deletion request without claiming the account was deleted', async () => {
    const screen = await render(<AccountDeletionScreen />);

    expect(screen.queryByText('账户删除申请')).toBeNull();
    expect(screen.getByText('提交申请不会立即删除账户。')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '撰写删除申请邮件' }));

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^mailto:\?subject=/)));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('用户 ID：user-1')));
    expect(showToast).not.toHaveBeenCalled();
  });
});
