import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

const mockAppHeader = jest.fn((_props: unknown) => null);
const mockReplace = jest.fn();
const mockScaffold = jest.fn(({ children }: { children?: ReactNode }) => children ?? null);
const mockStackScreen = jest.fn((_props: unknown) => null);
let mockAnalyticsScreenOptions: ((args: {
  navigation: {
    getParent: () => { openDrawer: () => void } | undefined;
    getState: () => { index: number };
    goBack: () => void;
  };
  route: { name: string };
}) => Record<string, unknown>) | null = null;

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children, screenOptions }: { children?: ReactNode; screenOptions: typeof mockAnalyticsScreenOptions }) => {
    mockAnalyticsScreenOptions = screenOptions;
    return React.createElement(React.Fragment, null, children);
  };
  Stack.Screen = (props: unknown) => mockStackScreen(props);
  return { Redirect: (props: { href: string }) => mockReplace(props.href), Stack, useRouter: () => ({ replace: mockReplace }) };
});
jest.mock('@/components/layout/AppHeader', () => ({
  AppHeader: (props: unknown) => mockAppHeader(props),
}));
jest.mock('@/features/analytics/AnalyticsModuleScaffold', () => ({
  AnalyticsModuleScaffold: (props: { children?: ReactNode }) => mockScaffold(props),
}));
jest.mock('@/features/analytics/DashboardScreen', () => ({ DashboardScreen: () => null }));
jest.mock('@/features/analytics/OrderInsightScreen', () => ({ OrderInsightScreen: () => null }));
jest.mock('@/features/analytics/ProductInsightScreen', () => ({ ProductInsightScreen: () => null }));
jest.mock('@/features/analytics/LaborInsightScreen', () => ({ LaborInsightScreen: () => null }));
jest.mock('@/features/analytics/RevenueAlertScreen', () => ({ RevenueAlertScreen: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');

  return {
    SafeAreaView: ({ children, ...props }: { children?: ReactNode }) => React.createElement(View, { ...props, testID: 'analytics-route-safe-area' }, children),
  };
});
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: { background: { canvas: '#ffffff' } } }),
}));

describe('AnalyticsLayout navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnalyticsScreenOptions = null;
  });

  it('registers five modules and three detail routes in one Stack', async () => {
    const { default: AnalyticsLayout } = require('../app/(app)/(tabs)/analytics/_layout') as typeof import('../app/(app)/(tabs)/analytics/_layout');
    await render(<AnalyticsLayout />);

    const screens = mockStackScreen.mock.calls.map(([props]) => props as {
      name: string;
      options?: { title?: string };
    });
    expect(screens.map((screen) => screen.name)).toEqual([
      'index',
      'dashboard',
      'orders',
      'products',
      'labor',
      'alerts',
      'orders/detail',
      'products/trend',
      'labor/detail',
    ]);
    expect(screens.find((screen) => screen.name === 'orders/detail')?.options?.title).toBe('订单详情');
    expect(screens.find((screen) => screen.name === 'products/trend')?.options?.title).toBe('商品趋势');
    expect(screens.find((screen) => screen.name === 'labor/detail')?.options?.title).toBe('人效详情');
  });

  it('uses order statistics as the default analytics entry', async () => {
    const { default: AnalyticsIndex } = require('../app/(app)/(tabs)/analytics/index') as typeof import('../app/(app)/(tabs)/analytics/index');

    await render(<AnalyticsIndex />);

    expect(mockReplace).toHaveBeenCalledWith('/analytics/orders');
  });

  it('hides the Stack header and transition animation on module routes', async () => {
    const { default: AnalyticsLayout } = require('../app/(app)/(tabs)/analytics/_layout') as typeof import('../app/(app)/(tabs)/analytics/_layout');
    await render(<AnalyticsLayout />);
    const openDrawer = jest.fn();
    const options = mockAnalyticsScreenOptions?.({
      navigation: { getParent: () => ({ openDrawer }), getState: () => ({ index: 0 }), goBack: jest.fn() },
      route: { name: 'products' },
    });

    expect(options?.headerShown).toBe(false);
    expect(options?.animation).toBe('none');
    expect(mockAppHeader).not.toHaveBeenCalled();
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('goes back one level from a detail route and uses a module fallback for a direct link', async () => {
    const { default: AnalyticsLayout } = require('../app/(app)/(tabs)/analytics/_layout') as typeof import('../app/(app)/(tabs)/analytics/_layout');
    await render(<AnalyticsLayout />);
    const goBack = jest.fn();
    const stackedOptions = mockAnalyticsScreenOptions?.({
      navigation: { getParent: () => undefined, getState: () => ({ index: 1 }), goBack },
      route: { name: 'orders/detail' },
    });
    expect(stackedOptions?.headerShown).toBe(true);
    expect(stackedOptions).not.toHaveProperty('animation');
    const stackedHeader = stackedOptions?.header as ((props: { options: { title?: string } }) => ReactElement);
    await render(stackedHeader({ options: { title: '订单详情' } }));
    (mockAppHeader.mock.calls.at(-1)?.[0] as { leadingAction: { onPress: () => void } }).leadingAction.onPress();
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    const directOptions = mockAnalyticsScreenOptions?.({
      navigation: { getParent: () => undefined, getState: () => ({ index: 0 }), goBack },
      route: { name: 'orders/detail' },
    });
    const directHeader = directOptions?.header as ((props: { options: { title?: string } }) => ReactElement);
    await render(directHeader({ options: { title: '订单详情' } }));
    (mockAppHeader.mock.calls.at(-1)?.[0] as { leadingAction: { onPress: () => void } }).leadingAction.onPress();
    expect(mockReplace).toHaveBeenCalledWith('/analytics/orders');
  });

  it.each([
    ['../app/(app)/(tabs)/analytics/dashboard', 'dashboard'],
    ['../app/(app)/(tabs)/analytics/orders', 'orders'],
    ['../app/(app)/(tabs)/analytics/products', 'products'],
    ['../app/(app)/(tabs)/analytics/labor', 'labor'],
    ['../app/(app)/(tabs)/analytics/alerts', 'alerts'],
  ])('marks %s with the matching active module', async (modulePath, activeModule) => {
    const Route = (require(modulePath) as { default: () => ReactElement }).default;
    const screen = await render(<Route />);

    expect(mockScaffold).toHaveBeenLastCalledWith(expect.objectContaining({ activeModule }));
    expect(screen.getByTestId('analytics-route-safe-area').props.edges).toEqual(['top', 'left', 'right']);
  });
});
