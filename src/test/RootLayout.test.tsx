import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { useNetworkStore } from '@/services/network/networkStore';

const mockCleanupExpiredReportFiles = jest.fn();
const mockRemoveAppStateListener = jest.fn();
const mockStackScreen = jest.fn();
const mockStartNetworkMonitoring = jest.fn();
const mockStopNetworkMonitoring = jest.fn();
const mockLoadSessions = jest.fn();
const mockRefreshTasks = jest.fn();
const mockRefreshAnalytics = jest.fn();
const mockLoadStores = jest.fn();
const mockRestoreSession = jest.fn().mockResolvedValue(undefined);
const mockRefreshStoredSession = jest.fn().mockResolvedValue(true);
const mockPreventAutoHideAsync = jest.fn().mockResolvedValue(undefined);
const mockHideAsync = jest.fn().mockResolvedValue(undefined);
let mockThemeHydrated = true;

jest.mock('@/services/files/downloadReport', () => ({
  cleanupExpiredReportFiles: () => mockCleanupExpiredReportFiles(),
}));
jest.mock('@/services/network/networkStore', () => {
  const actual = jest.requireActual('@/services/network/networkStore');
  return {
    ...actual,
    startNetworkMonitoring: () => {
      mockStartNetworkMonitoring();
      return mockStopNetworkMonitoring;
    },
  };
});
jest.mock('@/features/auth/authStore', () => {
  const authState = {
    status: 'signedIn',
    restoreSession: mockRestoreSession,
    refreshStoredSession: mockRefreshStoredSession,
  };
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState);
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});
jest.mock('@/features/chat/chatStore', () => ({
  useChatStore: { getState: () => ({ isOffline: false, loadSessions: mockLoadSessions, status: 'idle' }) },
}));
jest.mock('@/features/tasks/taskStore', () => ({
  useTaskStore: { getState: () => ({ isOffline: false, refresh: mockRefreshTasks, status: 'idle' }) },
}));
jest.mock('@/features/analytics/analyticsStore', () => ({
  useAnalyticsStore: { getState: () => ({ isOffline: false, loadStores: mockLoadStores, refresh: mockRefreshAnalytics, status: 'idle' }) },
}));
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 2 },
  lockAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children);
  Stack.Screen = (props: unknown) => { mockStackScreen(props); return null; };
  return { Stack };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-splash-screen', () => ({
  hideAsync: () => mockHideAsync(),
  preventAutoHideAsync: () => mockPreventAutoHideAsync(),
}));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: jest.requireActual('react-native').View }));
jest.mock('@/components/feedback/AppToast', () => ({ AppToast: () => null }));
jest.mock('@/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({
    hydrated: mockThemeHydrated,
    resolvedMode: 'light',
    theme: jest.requireActual('@/theme/tokens').semanticThemes.light,
  }),
}));

describe('RootLayout report cache cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockThemeHydrated = true;
    useNetworkStore.setState({ status: 'unknown' });
    mockRestoreSession.mockResolvedValue(undefined);
    mockRefreshStoredSession.mockResolvedValue(undefined);
  });

  it('shows the branded loading screen until the theme is restored', async () => {
    mockThemeHydrated = false;
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);

    expect(screen.getByTestId('startup-screen')).toBeTruthy();
    expect(screen.getByLabelText('BlackWave 启动标识')).toBeTruthy();
    expect(mockStackScreen).not.toHaveBeenCalled();

    screen.unmount();
  });

  it('keeps the branded startup screen visible for at least three seconds after theme restoration', async () => {
    jest.useFakeTimers();
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);

    expect(screen.getByTestId('startup-screen')).toBeTruthy();
    expect(screen.getByLabelText('BlackWave 启动标识')).toBeTruthy();
    expect(mockStackScreen).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(screen.getByTestId('startup-screen'), 'layout');
    });
    await act(async () => {
      jest.advanceTimersByTime(2_999);
    });
    expect(mockStackScreen).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await waitFor(() => expect(mockStackScreen).toHaveBeenCalledWith({ name: 'chart' }));

    screen.unmount();
    jest.useRealTimers();
  });

  it('keeps the native splash visible until the JS startup screen has laid out', async () => {
    jest.useFakeTimers();
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);

    expect(mockHideAsync).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(mockStackScreen).not.toHaveBeenCalled();
    expect(mockHideAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(screen.getByTestId('startup-screen'), 'layout');
    });
    expect(mockHideAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2_999);
    });
    expect(mockStackScreen).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await waitFor(() => expect(mockStackScreen).toHaveBeenCalledWith({ name: 'chart' }));

    screen.unmount();
    jest.useRealTimers();
  });

  it('prevents the native splash from auto hiding before React Native is ready', () => {
    mockPreventAutoHideAsync.mockClear();

    jest.isolateModules(() => {
      require('../app/_layout') as typeof import('../app/_layout');
    });

    expect(mockPreventAutoHideAsync).toHaveBeenCalledTimes(1);
  });

  it('cleans expired reports on startup, background and exit', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: mockRemoveAppStateListener } as NativeEventSubscription;
    });

    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);
    await waitFor(() => expect(AppState.addEventListener).toHaveBeenCalledTimes(1));
    expect(mockCleanupExpiredReportFiles).toHaveBeenCalledTimes(1);

    await act(async () => listener?.('background'));
    expect(mockCleanupExpiredReportFiles).toHaveBeenCalledTimes(2);

    await screen.unmount();
    expect(mockCleanupExpiredReportFiles).toHaveBeenCalledTimes(3);
    expect(mockRemoveAppStateListener).toHaveBeenCalledTimes(1);
  });

  it('lets the fullscreen component own orientation locking', async () => {
    jest.useFakeTimers();
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);
    await act(async () => {
      fireEvent(screen.getByTestId('startup-screen'), 'layout');
    });
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(mockStackScreen).toHaveBeenCalled());

    expect(mockStackScreen).toHaveBeenCalledWith({ name: 'chart' });
    await screen.unmount();
    jest.useRealTimers();
  });

  it('monitors device connectivity and reloads trusted state after reconnecting', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: mockRemoveAppStateListener } as NativeEventSubscription;
    });
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);
    await waitFor(() => expect(mockStartNetworkMonitoring).toHaveBeenCalledTimes(1));
    await act(async () => listener?.('active'));

    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
    });
    await act(async () => {
      useNetworkStore.setState({ status: 'online' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLoadSessions).toHaveBeenCalledTimes(1);
      expect(mockRefreshTasks).toHaveBeenCalledTimes(1);
      expect(mockRefreshAnalytics).toHaveBeenCalledTimes(1);
      expect(mockLoadStores).toHaveBeenCalledTimes(1);
    });

    await screen.unmount();
    expect(mockStopNetworkMonitoring).toHaveBeenCalledTimes(1);
  });

  it('defers reconnect synchronization until the app returns to the foreground', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: mockRemoveAppStateListener } as NativeEventSubscription;
    });
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);

    await act(async () => listener?.('background'));
    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
      useNetworkStore.setState({ status: 'online' });
      await Promise.resolve();
    });

    expect(mockLoadSessions).not.toHaveBeenCalled();
    expect(mockRefreshTasks).not.toHaveBeenCalled();
    await act(async () => listener?.('active'));
    await waitFor(() => expect(mockLoadSessions).toHaveBeenCalledTimes(1));
    expect(mockRefreshTasks).toHaveBeenCalledTimes(1);
    expect(mockRefreshAnalytics).toHaveBeenCalledTimes(1);
    expect(mockLoadStores).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it('retries trusted-state synchronization when the first reconnect attempt fails', async () => {
    jest.useFakeTimers();
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: mockRemoveAppStateListener } as NativeEventSubscription;
    });
    mockLoadSessions.mockRejectedValueOnce(new Error('network warming up')).mockResolvedValue(undefined);
    mockRefreshTasks.mockResolvedValue(undefined);
    mockRefreshAnalytics.mockResolvedValue(undefined);
    mockLoadStores.mockResolvedValue(undefined);
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);
    await act(async () => listener?.('active'));

    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
    });
    await act(async () => {
      useNetworkStore.setState({ status: 'online' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLoadSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLoadSessions).toHaveBeenCalledTimes(2);

    await screen.unmount();
    jest.useRealTimers();
  });

  it('retries reconnect synchronization when only the store mapping refresh fails', async () => {
    jest.useFakeTimers();
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: mockRemoveAppStateListener } as NativeEventSubscription;
    });
    mockLoadSessions.mockResolvedValue(undefined);
    mockRefreshTasks.mockResolvedValue(undefined);
    mockRefreshAnalytics.mockResolvedValue(undefined);
    mockLoadStores.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { AppRoot } = require('../app/_layout') as typeof import('../app/_layout');
    const screen = await render(<AppRoot />);
    await act(async () => listener?.('active'));

    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
    });
    await act(async () => {
      useNetworkStore.setState({ status: 'online' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLoadStores).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLoadStores).toHaveBeenCalledTimes(2);

    await screen.unmount();
    jest.useRealTimers();
  });
});
