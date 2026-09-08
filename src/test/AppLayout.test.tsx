import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

const mockAppHeader = jest.fn((_props: unknown) => null);
const mockNativeTabs = jest.fn((_props: unknown) => null);
const mockNativeTabIcon = jest.fn((_props: unknown) => null);
const mockNativeTabLabel = jest.fn((_props: unknown) => null);
const mockNativeTabTrigger = jest.fn((_props: unknown) => null);
const mockRedirect = jest.fn((_props: { href: string }) => null);
const mockStackScreen = jest.fn((_props: unknown) => null);
let mockAuthStatus = 'signedIn';
let mockPathname = '/analytics/orders';
let mockStackScreenOptions: Record<string, unknown> | null = null;
const defaultPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children, screenOptions }: { children?: ReactNode; screenOptions: Record<string, unknown> }) => {
    mockStackScreenOptions = screenOptions;
    return React.createElement(React.Fragment, null, children);
  };
  Stack.Screen = (props: unknown) => mockStackScreen(props);
  const Tabs = ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children);
  Tabs.Screen = jest.fn();
  return { Redirect: (props: { href: string }) => mockRedirect(props), Stack, Tabs, usePathname: () => mockPathname };
});
jest.mock('expo-router/unstable-native-tabs', () => {
  const React = jest.requireActual('react');
  const NativeTabs = (({ children, ...props }: { children?: ReactNode }) => {
    mockNativeTabs(props);
    return React.createElement(React.Fragment, null, children);
  }) as any;
  const Trigger = (({ children, ...props }: { children?: ReactNode }) => {
    mockNativeTabTrigger(props);
    return React.createElement(React.Fragment, null, children);
  }) as any;
  Trigger.Icon = (props: unknown) => {
    mockNativeTabIcon(props);
    return null;
  };
  Trigger.Label = (props: unknown) => {
    mockNativeTabLabel(props);
    return null;
  };
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});
jest.mock('@/components/layout/AppHeader', () => ({
  AppHeader: (props: unknown) => mockAppHeader(props),
}));
jest.mock('@/features/auth/authStore', () => ({
  useAuthStore: (selector: (state: { status: string }) => unknown) => selector({ status: mockAuthStatus }),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    theme: {
      action: { primary: '#087E6D' },
      background: { canvas: '#ffffff', surface: '#ffffff' },
      border: { default: '#d0d7de' },
      overlay: { scrim: 'rgba(0,0,0,0.4)' },
      text: { muted: '#667085', primary: '#111827', secondary: '#475467' },
    },
  }),
}));

describe('AppLayout navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStackScreenOptions = null;
    mockAuthStatus = 'signedIn';
    mockPathname = '/analytics/orders';
    setPlatformOS(defaultPlatformOS);
  });

  it('sends signed-out users directly to the auth login route', async () => {
    mockAuthStatus = 'signedOut';
    const { default: AppLayout } = require('../app/(app)/_layout') as typeof import('../app/(app)/_layout');
    await render(<AppLayout />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: '/(auth)/login' });
    expect(mockStackScreen).not.toHaveBeenCalled();
    expect(mockNativeTabs).not.toHaveBeenCalled();
  });

  it('keeps utility routes outside the native bottom tab host', async () => {
    const { default: AppLayout } = require('../app/(app)/_layout') as typeof import('../app/(app)/_layout');
    await render(<AppLayout />);

    const screens = mockStackScreen.mock.calls.map(([props]) => props as {
      name: string;
      options?: { headerShown?: boolean };
    });
    expect(screens.map((screen) => screen.name)).toEqual(['(tabs)', 'tasks', 'tables/[messageId]']);
    expect(mockStackScreenOptions).toEqual(expect.objectContaining({ headerShown: false }));
  });

  it('renders the confirmed bottom navigation with native tabs', async () => {
    const { default: AppTabLayout } = require('../app/(app)/(tabs)/_layout') as typeof import('../app/(app)/(tabs)/_layout');
    await render(<AppTabLayout />);

    expect(mockNativeTabs).toHaveBeenCalledWith(expect.objectContaining({
      backBehavior: 'history',
      blurEffect: 'systemUltraThinMaterial',
      disableTransparentOnScrollEdge: false,
      hidden: false,
      minimizeBehavior: 'automatic',
      tintColor: '#087E6D',
    }));
    expect(mockNativeTabTrigger.mock.calls.map(([props]) => (props as { name: string }).name)).toEqual([
      'analytics',
      'profile',
      'chat',
    ]);
    expect(mockNativeTabLabel.mock.calls.map(([props]) => (props as { children: string }).children)).toEqual([
      '经营',
      '我的',
      '对话',
    ]);
    expect(mockNativeTabTrigger.mock.calls.map(([props]) => (props as { role?: string }).role)).toEqual([
      undefined,
      undefined,
      'search',
    ]);
    expect(mockNativeTabIcon).toHaveBeenCalledTimes(3);
    expect(mockNativeTabIcon.mock.calls.map(([props]) => props)).toEqual([
      { sf: 'chart.bar' },
      { sf: 'person' },
      { sf: 'message' },
    ]);
  });

  it('hides the native bottom tab bar on the chat route', async () => {
    mockPathname = '/chat';
    const { default: AppTabLayout } = require('../app/(app)/(tabs)/_layout') as typeof import('../app/(app)/(tabs)/_layout');
    await render(<AppTabLayout />);

    expect(mockNativeTabs).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
  });

  it('uses Android native material icon names only on Android', async () => {
    setPlatformOS('android');
    const { default: AppTabLayout } = require('../app/(app)/(tabs)/_layout') as typeof import('../app/(app)/(tabs)/_layout');
    await render(<AppTabLayout />);

    expect(mockNativeTabIcon.mock.calls.map(([props]) => props)).toEqual([
      { md: 'bar_chart' },
      { md: 'person_outline' },
      { md: 'chat_bubble_outline' },
    ]);
  });

  it('uses the analytics route as the default business tab entry', async () => {
    const { default: AppTabLayout } = require('../app/(app)/(tabs)/_layout') as typeof import('../app/(app)/(tabs)/_layout');
    await render(<AppTabLayout />);

    const analyticsScreen = mockNativeTabTrigger.mock.calls
      .map(([props]) => props as { name: string })
      .find((screen) => screen.name === 'analytics');

    expect(analyticsScreen).toBeDefined();
  });

  it('does not render a custom app-level header', async () => {
    const { default: AppLayout } = require('../app/(app)/_layout') as typeof import('../app/(app)/_layout');
    await render(<AppLayout />);

    expect(mockAppHeader).not.toHaveBeenCalled();
  });
});
