import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getRevenueAlerts, type RevenueAlert } from '@/services/api/analytics';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useAnalyticsStore } from './analyticsStore';
import { RevenueAlertScreen } from './RevenueAlertScreen';

jest.mock('@/services/api/analytics', () => ({ getRevenueAlerts: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({ clearCachedAnalytics: jest.fn(), readCachedAnalytics: jest.fn(), saveCachedAnalytics: jest.fn() }));
jest.mock('./analyticsStore', () => ({ useAnalyticsStore: jest.fn() }));
jest.mock('./RevenueAlertChart', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    RevenueAlertChart: ({ alerts }: { alerts: RevenueAlert[] }) => React.createElement(
      Text,
      { testID: 'revenue-alert-chart' },
      '图表 ',
      alerts.length,
    ),
  };
});

const alertRows: RevenueAlert[] = [
  { actual_amount: 1120, baseline_amount: 1000, business_date: '2026-07-16', deviation_pct: 0.12, direction: 'over', shop_key: 's-1', shop_label: '门店一', status: 'open' },
  { actual_amount: 700, baseline_amount: 1000, business_date: '2026-07-16', deviation_pct: -0.3, direction: 'under', shop_key: 's-2', shop_label: '门店二', status: 'open' },
];

const mockStore = useAnalyticsStore as unknown as jest.Mock;
let state: Record<string, unknown>;

describe('RevenueAlertScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNetworkStore.setState({ status: 'online' });
    state = {
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL' },
      setFilters: jest.fn((filters) => { state.filters = filters; }),
      stores: [{ key: 's-1', label: '门店一' }, { key: 's-2', label: '门店二' }],
    };
    mockStore.mockImplementation((selector?: (value: typeof state) => unknown) => selector ? selector(state) : state);
    jest.mocked(getRevenueAlerts).mockResolvedValue(alertRows);
    jest.mocked(clearCachedAnalytics).mockResolvedValue(undefined);
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);
    jest.mocked(saveCachedAnalytics).mockResolvedValue(undefined);
  });

  it('loads the selected detection date and renders a read-only chart and alert list', async () => {
    const screen = await render(<RevenueAlertScreen />);

    await waitFor(() => expect(screen.getByText('门店二')).toBeTruthy());
    expect(getRevenueAlerts).toHaveBeenCalledWith('2026-07-16', expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByTestId('revenue-alert-chart').props.children).toEqual(['图表 ', 2]);
    expect(screen.getByText('偏低 30.0%')).toBeTruthy();
    expect(screen.getByText('偏高 12.0%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '手动检测' })).toBeNull();
    expect(screen.queryByRole('button', { name: '报警设置' })).toBeNull();
    expect(saveCachedAnalytics).toHaveBeenCalledWith('revenueAlerts', '2026-07-16', alertRows, expect.any(Number));
  });

  it('filters the returned alerts by the shared store selection without another request', async () => {
    state.filters = { ...(state.filters as object), storeKey: 's-1' };
    const screen = await render(<RevenueAlertScreen />);

    await waitFor(() => expect(screen.getByText('门店一')).toBeTruthy());
    expect(screen.queryByText('门店二')).toBeNull();
    expect(screen.getByTestId('revenue-alert-chart').props.children).toEqual(['图表 ', 1]);
    expect(getRevenueAlerts).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when the selected date has no alerts', async () => {
    jest.mocked(getRevenueAlerts).mockResolvedValue([]);
    const screen = await render(<RevenueAlertScreen />);

    expect(await screen.findByText('当前日期暂无营收报警')).toBeTruthy();
  });

  it('retries after a request error', async () => {
    jest.mocked(getRevenueAlerts).mockRejectedValueOnce(new Error('报警加载失败')).mockResolvedValueOnce(alertRows);
    const screen = await render(<RevenueAlertScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '重新加载' }));

    expect(await screen.findByText('门店二')).toBeTruthy();
    expect(getRevenueAlerts).toHaveBeenCalledTimes(2);
  });

  it('reads the matching date cache without starting a request while offline', async () => {
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: alertRows, lastSyncedAt: 100 });
    const screen = await render(<RevenueAlertScreen />);

    expect(await screen.findByText('门店二')).toBeTruthy();
    expect(readCachedAnalytics).toHaveBeenCalledWith('revenueAlerts', '2026-07-16', expect.any(Number));
    expect(getRevenueAlerts).not.toHaveBeenCalled();
  });

  it('clears prior alerts when a new offline date has no exact cache snapshot', async () => {
    const screen = await render(<RevenueAlertScreen />);
    await waitFor(() => expect(screen.getByText('门店二')).toBeTruthy());

    state.filters = { ...(state.filters as object), dateTo: '2026-07-17' };
    await act(async () => { useNetworkStore.setState({ status: 'offline' }); });
    await screen.rerender(<RevenueAlertScreen />);

    await waitFor(() => expect(screen.queryByText('门店二')).toBeNull());
    await screen.unmount();
  });

  it('uses a fresh alert snapshot without requesting the server', async () => {
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: alertRows, lastSyncedAt: Date.now() - 60_000 });
    const screen = await render(<RevenueAlertScreen />);

    await waitFor(() => expect(screen.getByText(alertRows[0].shop_label!)).toBeTruthy());
    expect(getRevenueAlerts).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('clears the selected stale alert snapshot after a business error', async () => {
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: alertRows, lastSyncedAt: Date.now() - 301_000 });
    jest.mocked(getRevenueAlerts).mockRejectedValue(new Error('403 Forbidden'));

    const screen = await render(<RevenueAlertScreen />);

    await waitFor(() => expect(screen.getByText('403 Forbidden')).toBeTruthy());
    expect(clearCachedAnalytics).toHaveBeenCalledWith('revenueAlerts', '2026-07-16');
    expect(screen.queryByText('门店一')).toBeNull();
    await screen.unmount();
  });

  it('clears only the selected alert date on force refresh', async () => {
    const screen = await render(<RevenueAlertScreen />);
    await screen.findByText('门店一');
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    expect(clearCachedAnalytics).toHaveBeenCalledWith('revenueAlerts', '2026-07-16');
    expect(getRevenueAlerts).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });
});
