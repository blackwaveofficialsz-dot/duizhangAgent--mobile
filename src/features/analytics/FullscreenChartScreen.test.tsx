import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ReactNative from 'react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { FullscreenChartScreen } from './FullscreenChartScreen';

const mockGetOrientationLockAsync = jest.fn();
const mockLockAsync = jest.fn();
let mockWindowDimensions = { fontScale: 1, height: 390, scale: 3, width: 844 };
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 6, PORTRAIT_UP: 2 },
  getOrientationLockAsync: (...args: unknown[]) => mockGetOrientationLockAsync(...args),
  lockAsync: (...args: unknown[]) => mockLockAsync(...args),
}));

const safeAreaMetrics = {
  frame: { height: 390, width: 844, x: 0, y: 0 },
  insets: { bottom: 21, left: 0, right: 0, top: 0 },
};

describe('FullscreenChartScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowDimensions = { fontScale: 1, height: 390, scale: 3, width: 844 };
    ReactNative.Dimensions.set({ screen: mockWindowDimensions, window: mockWindowDimensions });
    mockGetOrientationLockAsync.mockResolvedValue(2);
    mockLockAsync.mockResolvedValue(undefined);
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  it('uses the side detail layout and closes from the landscape route', async () => {
    const onClose = jest.fn();
    const onOpenFilters = jest.fn();
    const screen = await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FullscreenChartScreen
          onClose={onClose}
          filterSummary="2026-06-17 至 2026-07-16 · 全部门店"
          onOpenFilters={onOpenFilters}
          points={[{ period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false }]}
          title="全部净实收趋势"
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('revenue-chart-side-layout')).toBeTruthy();
    expect(screen.getByText('2026-06-17 至 2026-07-16 · 全部门店')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: '关闭全屏趋势' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens a fixed-width filter panel over the right side without resizing the chart', async () => {
    const screen = await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FullscreenChartScreen {...({
          filterPanel: <ReactNative.Text>横屏筛选内容</ReactNative.Text>,
          filterSummary: '2026-06-17 至 2026-07-16 · 全部门店',
          onClose: jest.fn(),
          onOpenFilters: jest.fn(),
          points: [{ period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false }],
          title: '全部净实收趋势',
        } as unknown as React.ComponentProps<typeof FullscreenChartScreen>)} />
      </SafeAreaProvider>,
    );

    const chart = screen.getByTestId('fullscreen-chart-content');
    expect(chart).toHaveStyle({ flex: 1 });
    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    expect(screen.getByTestId('fullscreen-filter-panel')).toHaveStyle({ position: 'absolute', width: 280 });
    expect(screen.getByText('横屏筛选内容')).toBeTruthy();
    expect(chart).toHaveStyle({ flex: 1 });
  });

  it('renders a custom chart inside the shared landscape shell', async () => {
    const screen = await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FullscreenChartScreen
          chart={<ReactNative.Text testID="custom-landscape-chart">人效趋势图</ReactNative.Text>}
          onClose={jest.fn()}
          points={[]}
          title="人效趋势"
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('custom-landscape-chart')).toBeTruthy();
    expect(screen.queryByTestId('revenue-chart-side-layout')).toBeNull();
  });

  it('locks landscape while mounted and restores the previous orientation', async () => {
    const screen = await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FullscreenChartScreen onClose={jest.fn()} points={[]} title="全部净实收趋势" />
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(mockLockAsync).toHaveBeenCalledWith(6));
    screen.unmount();
    await waitFor(() => expect(mockLockAsync).toHaveBeenLastCalledWith(2));
  });

  it('keeps the fullscreen side-detail layout when landscape locking is delayed', async () => {
    mockWindowDimensions = { fontScale: 1, height: 844, scale: 3, width: 390 };
    ReactNative.Dimensions.set({ screen: mockWindowDimensions, window: mockWindowDimensions });
    mockLockAsync.mockRejectedValueOnce(new Error('orientation unavailable'));
    const screen = await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <FullscreenChartScreen
          onClose={jest.fn()}
          points={[{ period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false }]}
          title="全部净实收趋势"
        />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('revenue-chart-side-layout')).toBeTruthy();
    expect(screen.getByTestId('revenue-chart-side-detail')).toBeTruthy();
    expect(screen.queryByTestId('revenue-chart-detail')).toBeNull();
  });
});
