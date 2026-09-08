import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import LaborDetailRoute from '@/app/(app)/(tabs)/analytics/labor/detail';
import OrderDetailRoute from '@/app/(app)/(tabs)/analytics/orders/detail';
import ProductTrendRoute from '@/app/(app)/(tabs)/analytics/products/trend';
import {
  getLabor,
  getLaborDetail,
  getLaborTrend,
  getOrderPeriodSnapshotRecords,
  getOrders,
  getRevenueTrend,
  readCachedOrderPeriodSnapshotRecords,
  getProducts,
  getProductTrend,
  listPlatformDim,
} from '@/services/api/analytics';
import { getOperationsLabor, getOperationsOverview } from '@/services/api/operationsAnalytics';
import { showToast } from '@/components/feedback/AppToast';
import { shareWorkbook } from '@/services/files/shareWorkbook';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { laborDashboardCacheScope, orderAnalyticsCacheScope, serializeAnalyticsFilters, type AnalyticsFilters } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';
import { LaborInsightScreen } from './LaborInsightScreen';
import { OrderInsightScreen } from './OrderInsightScreen';
import { ProductInsightScreen } from './ProductInsightScreen';

jest.mock('expo-router', () => ({ useNavigation: () => ({ setOptions: jest.fn() }), useRouter: jest.fn() }));
jest.mock('@/services/api/analytics', () => ({
  getLabor: jest.fn(),
  getLaborDetail: jest.fn(),
  getLaborTrend: jest.fn(),
  getOrderPeriodSnapshotRecords: jest.fn(),
  getOrders: jest.fn(),
  getRevenueTrend: jest.fn(),
  readCachedOrderPeriodSnapshotRecords: jest.fn(),
  getProducts: jest.fn(),
  getProductTrend: jest.fn(),
  listPlatformDim: jest.fn(),
}));
jest.mock('@/services/api/operationsAnalytics', () => ({ getOperationsLabor: jest.fn(), getOperationsOverview: jest.fn() }));
jest.mock('@/services/files/shareWorkbook', () => ({ shareWorkbook: jest.fn() }));
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('./analyticsStore', () => ({ useAnalyticsStore: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  clearCachedAnalytics: jest.fn(),
  readCachedAnalytics: jest.fn(),
  saveCachedAnalytics: jest.fn(),
}));

const mockGetLabor = jest.mocked(getLabor);
const mockGetLaborDetail = jest.mocked(getLaborDetail);
const mockGetLaborTrend = jest.mocked(getLaborTrend);
const mockGetOrderPeriodSnapshotRecords = jest.mocked(getOrderPeriodSnapshotRecords);
const mockGetOrders = jest.mocked(getOrders);
const mockGetRevenueTrend = jest.mocked(getRevenueTrend);
const mockReadCachedOrderPeriodSnapshotRecords = jest.mocked(readCachedOrderPeriodSnapshotRecords);
const mockGetOperationsOverview = jest.mocked(getOperationsOverview);
const mockGetOperationsLabor = jest.mocked(getOperationsLabor);
const mockShareWorkbook = jest.mocked(shareWorkbook);
const mockShowToast = jest.mocked(showToast);
const mockGetProducts = jest.mocked(getProducts);
const mockGetProductTrend = jest.mocked(getProductTrend);
const mockListPlatformDim = jest.mocked(listPlatformDim);
const mockReadCachedAnalytics = jest.mocked(readCachedAnalytics);
const mockSaveCachedAnalytics = jest.mocked(saveCachedAnalytics);
const mockClearCachedAnalytics = jest.mocked(clearCachedAnalytics);
const mockStore = useAnalyticsStore as unknown as jest.Mock;
const mockPush = jest.fn();
const mockBack = jest.fn();

type StoreState = {
  comparisonDisplayModeByModule: { orders: 'percentage' | 'difference' | 'previous' | 'all' };
  comparisonModeByModule: { orders: 'previous' | 'none' };
  filters: AnalyticsFilters;
  hiddenSeriesByChart: Record<string, string[]>;
  isOffline: boolean;
  lastSyncedAt: number | null;
  laborFilters: AnalyticsFilters;
  orderDimensions: Array<'shop' | 'platform' | 'channel'>;
  orderFilters: AnalyticsFilters;
  selectedProductKeys: string[];
  selectedPeriodByChart: Record<string, string>;
  selectedSeriesByChart: Record<string, string>;
  setFilters: jest.Mock;
  setComparisonDisplayMode: jest.Mock;
  setComparisonMode: jest.Mock;
  setOrderDimensions: jest.Mock;
  setOrderFilters: jest.Mock;
  setSelectedProductKeys: jest.Mock;
  setSelectedChartSelection: jest.Mock;
  syncSeriesVisibility: jest.Mock;
  toggleSeriesVisibility: jest.Mock;
  scopeTree: Array<{ key: string; type: 'department' | 'store'; label: string; store_key?: string; department_id?: string; children?: Array<{ key: string; type: 'store'; label: string; store_key: string; department_id?: string }> }>;
  stores: Array<{ key: string; label: string }>;
};

describe('insight screens', () => {
  const state: StoreState = {
    comparisonDisplayModeByModule: { orders: 'percentage' },
    comparisonModeByModule: { orders: 'previous' },
    filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
    hiddenSeriesByChart: {},
    isOffline: false,
    lastSyncedAt: null,
    laborFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
    orderDimensions: [],
    orderFilters: { dateFrom: '2026-07-16', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, orderDimensions: [], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
    selectedProductKeys: [],
    selectedPeriodByChart: {},
    selectedSeriesByChart: {},
    setFilters: jest.fn(),
    setComparisonDisplayMode: jest.fn(),
    setComparisonMode: jest.fn(),
    setOrderDimensions: jest.fn(),
    setOrderFilters: jest.fn(),
    setSelectedProductKeys: jest.fn(),
    setSelectedChartSelection: jest.fn(),
    syncSeriesVisibility: jest.fn(),
    toggleSeriesVisibility: jest.fn(),
    scopeTree: [],
    stores: [{ key: 's-1', label: '长安旗舰店' }],
  };

  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
    jest.mocked(useRouter).mockReturnValue({ back: mockBack, push: mockPush } as never);
    state.filters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] };
    state.orderFilters = { dateFrom: '2026-07-16', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, orderDimensions: [], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] };
    state.orderDimensions = [];
    state.selectedProductKeys = [];
    state.comparisonDisplayModeByModule = { orders: 'percentage' };
    state.comparisonModeByModule = { orders: 'previous' };
    state.laborFilters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] };
    state.scopeTree = [];
    state.isOffline = false;
    state.lastSyncedAt = null;
    state.hiddenSeriesByChart = {};
    state.selectedPeriodByChart = {};
    state.selectedSeriesByChart = {};
    state.setFilters = jest.fn((next) => { state.filters = next; });
    state.setComparisonDisplayMode = jest.fn((_module, mode) => { state.comparisonDisplayModeByModule = { orders: mode }; });
    state.setComparisonMode = jest.fn((_module, mode) => { state.comparisonModeByModule = { orders: mode }; });
    state.setOrderDimensions = jest.fn((dimensions) => { state.orderDimensions = dimensions; state.orderFilters = { ...state.orderFilters, orderDimensions: dimensions }; });
    state.setOrderFilters = jest.fn((next) => { state.orderFilters = next; state.orderDimensions = next.orderDimensions ?? []; });
    state.setSelectedProductKeys = jest.fn((keys: string[]) => { state.selectedProductKeys = [...new Set(keys.filter(Boolean))].slice(0, 5); });
    state.setSelectedChartSelection = jest.fn();
    state.syncSeriesVisibility = jest.fn();
    state.toggleSeriesVisibility = jest.fn();
    mockStore.mockImplementation((selector?: (value: StoreState) => unknown) => selector ? selector(state) : state);
    useInsightDetailStore.setState({ isReadOnly: false, labor: null, order: null, product: null, productScope: null, productTrend: null });
    mockBack.mockReset();
    mockPush.mockReset();
    mockGetLabor.mockReset();
    mockGetLaborDetail.mockReset();
    mockGetLaborTrend.mockReset().mockResolvedValue(emptyLaborTrend());
    mockGetOrderPeriodSnapshotRecords.mockReset().mockResolvedValue([]);
    mockGetOrders.mockReset();
    mockGetRevenueTrend.mockReset().mockResolvedValue(revenueTrend([]));
    mockReadCachedOrderPeriodSnapshotRecords.mockReset().mockResolvedValue([]);
    mockGetOperationsOverview.mockReset().mockResolvedValue(orderOverview());
    mockGetOperationsLabor.mockReset().mockResolvedValue(laborComparison());
    mockShareWorkbook.mockReset().mockResolvedValue(undefined);
    mockShowToast.mockReset();
    mockGetProducts.mockReset();
    mockGetProductTrend.mockReset().mockResolvedValue(emptyProductTrend());
    mockListPlatformDim.mockReset().mockResolvedValue([{ confirmed: true, platform_code: 2, platform_name: '美团' }]);
    mockReadCachedAnalytics.mockReset().mockResolvedValue(null);
    mockSaveCachedAnalytics.mockReset().mockResolvedValue(undefined);
    mockClearCachedAnalytics.mockReset().mockResolvedValue(undefined);
    useNetworkStore.setState({ status: 'online' });
  });

  it('prioritizes four order metrics, truncates long names in the fixed column, and opens a full-name detail route', async () => {
    const longName = '这是一个用于验证移动端订单洞察列表单行省略的超长门店名称'.repeat(2);
    mockGetOrders.mockResolvedValue({
      rows: [{ avg_order_value: 32.5, dim_key: 's-1', dim_label: longName, net_income: 1234.5, order_count: 40, refund_rate: 0.032 }],
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText(longName)).toBeTruthy());
    expect(screen.queryByText('与上期对比')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    expect(screen.getByText('与上期对比')).toBeTruthy();
    expect(screen.queryByText('1,200.00')).toBeNull();
    expect(screen.getAllByText('总计')).toHaveLength(3);
    expect(screen.getAllByText('订单数').length).toBeGreaterThan(0);
    expect(screen.getAllByText('净实收').length).toBeGreaterThan(0);
    expect(screen.getAllByText('客单价').length).toBeGreaterThan(0);
    expect(screen.getAllByText('退款率').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,234.50').length).toBeGreaterThan(0);
    expect(screen.getByText('3.2%')).toBeTruthy();
    expect(screen.getByText(longName).props.numberOfLines).toBe(1);
    expect(screen.getByText(longName).props.ellipsizeMode).toBe('tail');

    await fireEvent.press(screen.getByRole('button', { name: longName }));
    expect(mockPush).toHaveBeenCalledWith('/analytics/orders/detail');
    await screen.unmount();

    const detail = await render(<OrderDetailRoute />);
    expect(detail.getByText(longName).props.numberOfLines).toBeUndefined();
  });

  it('groups platform headers once and renders a store-specific previous-period percentage', async () => {
    state.orderDimensions = ['shop', 'platform'];
    state.orderFilters = { ...state.orderFilters, orderDimensions: ['shop', 'platform'] };
    mockGetOrders.mockResolvedValue({
      rows: [{
        avg_order_value: 20,
        dim_key: 's-1|0',
        dim_label: '长安旗舰店 · POS',
        income_amount: 200,
        net_income: 180,
        order_count: 10,
        paid_amount: 220,
        refund_amount: 20,
        refund_rate: 0.09,
      }],
    });
    mockGetOperationsOverview.mockResolvedValue({
      ...orderOverview(),
      store_platforms: [{
        dim_key: 's-1|0',
        dim_label: '长安旗舰店 · POS',
        metrics: {
          net_income: { current: 180, previous: 120, difference: 60, change_rate: 0.5, status: 'ok' },
        },
      }],
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('长安旗舰店')).toBeTruthy());
    expect(screen.getAllByText('POS')).toHaveLength(1);
    expect(screen.getByText('较上期 +50.00%')).toBeTruthy();
  });

  it('loads order detail trend through the dashboard revenue trend endpoint without widening order detail rows', async () => {
    state.orderFilters = {
      ...state.orderFilters,
      dateFrom: '2026-08-27',
      dateTo: '2026-08-27',
      granularity: 'day',
    };
    useInsightDetailStore.getState().selectOrder({
      avg_order_value: 16.29,
      dim_key: 's-1',
      dim_label: '三桥店',
      net_income: 6009.69,
      order_count: 369,
      refund_rate: 0.028,
    });
    mockGetOrderPeriodSnapshotRecords.mockResolvedValue([
      {
        data: { rows: [{ avg_order_value: 18, dim_key: 's-1', dim_label: '三桥店', net_income: 100, order_count: 5, refund_rate: 0 }] },
        dateFrom: '2026-08-23',
        dateTo: '2026-08-23',
        period: '2026-08-23',
        version: 'v1',
      },
      {
        data: { rows: [{ avg_order_value: 16.29, dim_key: 's-1', dim_label: '三桥店', net_income: 6009.69, order_count: 369, refund_rate: 0.028 }] },
        dateFrom: '2026-08-27',
        dateTo: '2026-08-27',
        period: '2026-08-27',
        version: 'v5',
      },
    ]);
    mockGetRevenueTrend.mockResolvedValue(revenueTrend([
      { ma7: 95, ma30: 90, ma180: 80, net_income: 100, order_count: 5, period: '2026-08-23' },
      { ma7: 6200, ma30: 5800, ma180: 5400, net_income: 6009.69, order_count: 369, period: '2026-08-27' },
    ], 'day', 's-1'));

    const screen = await render(<OrderDetailRoute />);

    await waitFor(() => expect(mockGetRevenueTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-23', dateTo: '2026-08-27', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.any(Object),
    ));
    expect(mockReadCachedOrderPeriodSnapshotRecords).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-23', dateTo: '2026-08-27', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    );
    await waitFor(() => expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(1));
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ dateFrom: '2026-08-23', dateTo: '2026-08-27', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    );
    expect(screen.getByText('2026-08-23 至 2026-08-27')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '详细数据' }));
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(1);
    expect(screen.getByText('374')).toBeTruthy();
    expect(screen.getByText('6,109.69')).toBeTruthy();
    expect(screen.getByText('08-23')).toBeTruthy();
    expect(screen.getByText('08-27')).toBeTruthy();
  });


  it('renders order detail trend before period snapshot prefetch finishes', async () => {
    state.orderFilters = {
      ...state.orderFilters,
      dateFrom: '2026-08-27',
      dateTo: '2026-08-31',
      granularity: 'day',
    };
    useInsightDetailStore.getState().selectOrder({
      avg_order_value: 18.09,
      dim_key: 's-12',
      dim_label: '凤十二',
      net_income: 37892.2,
      order_count: 2130,
      refund_rate: 0.011,
    });
    let resolveSnapshots: (value: Awaited<ReturnType<typeof getOrderPeriodSnapshotRecords>>) => void;
    mockGetOrderPeriodSnapshotRecords.mockReturnValue(new Promise((resolve) => { resolveSnapshots = resolve; }));
    mockGetRevenueTrend.mockResolvedValue(revenueTrend([
      { ma7: 7100, ma30: 7050, ma180: 6900, net_income: 7260.45, order_count: 423, period: '2026-08-27' },
      { ma7: 7200, ma30: 7100, ma180: 6950, net_income: 7800.1, order_count: 430, period: '2026-08-28' },
    ], 'day', 's-12'));

    const screen = await render(<OrderDetailRoute />);

    await waitFor(() => expect(mockGetRevenueTrend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('order-detail-echart')).toBeTruthy());
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSnapshots!([]);
    });
  });

  it('falls back to cached order records when a weekly revenue trend has no renderable points', async () => {
    state.orderFilters = {
      ...state.orderFilters,
      dateFrom: '2026-07-27',
      dateTo: '2026-08-30',
      granularity: 'week',
      includeCurrent: false,
    };
    useInsightDetailStore.getState().selectOrder({
      avg_order_value: 18.09,
      dim_key: 's-12',
      dim_label: '凤十二',
      net_income: 29326.75,
      order_count: 1621,
      refund_rate: 0.013,
    });
    const weeklySnapshots = [
      {
        data: { rows: [{ avg_order_value: 18.09, dim_key: 's-12', dim_label: '凤十二', net_income: 29326.75, order_count: 1621, refund_rate: 0.013 }] },
        dateFrom: '2026-08-24',
        dateTo: '2026-08-30',
        period: '2026-W35',
        version: 'week-v35',
      },
    ];
    mockReadCachedOrderPeriodSnapshotRecords.mockResolvedValue(weeklySnapshots);
    mockGetOrderPeriodSnapshotRecords.mockResolvedValue(weeklySnapshots);
    mockGetRevenueTrend.mockResolvedValue({
      date_from: '2026-07-27',
      date_to: '2026-08-30',
      granularity: 'week',
      metric: 'net_income',
      moving_averages: [
        { available: false, available_periods: 0, field: 'ma4', label: 'MA4', window: 4 },
        { available: false, available_periods: 0, field: 'ma12', label: 'MA12', window: 12 },
        { available: false, available_periods: 0, field: 'ma26', label: 'MA26', window: 26 },
      ],
      points: ['2026-W31', '2026-W32', '2026-W33', '2026-W34', '2026-W35'].map((period) => ({
        ma4: null,
        ma12: null,
        ma26: null,
        missing: true,
        net_income: 0,
        order_count: 0,
        period,
      })),
      source_type: 'all',
      store_key: 's-12',
      store_keys: ['s-12'],
    });

    const screen = await render(<OrderDetailRoute />);

    await waitFor(() => expect(mockGetRevenueTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-27', dateTo: '2026-08-30', granularity: 'week', storeKey: 's-12', storeKeys: ['s-12'] }),
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.getAllByText('29,326.75').length).toBeGreaterThan(1));
    expect(screen.getAllByText('MA4').length).toBeGreaterThan(0);
    expect(screen.queryByText('MA4（数据不足 0/4）')).toBeNull();
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('shows zero-filled order days in the store detail trend and data table', async () => {
    state.orderFilters = {
      ...state.orderFilters,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-03',
    };
    useInsightDetailStore.getState().selectOrder({
      avg_order_value: 30,
      dim_key: 's-1',
      dim_label: '唐城医院店',
      net_income: 90,
      order_count: 3,
      paid_amount: 100,
      refund_amount: 10,
      refund_rate: 0.1,
    });
    mockGetOrderPeriodSnapshotRecords.mockResolvedValue([
      {
        data: { rows: [{ avg_order_value: 30, dim_key: 's-1', dim_label: '唐城医院店', net_income: 60, order_count: 2, refund_rate: 0 }] },
        dateFrom: '2026-07-01',
        dateTo: '2026-07-01',
        period: '2026-07-01',
        version: 'v1',
      },
      {
        data: { rows: [{ avg_order_value: 30, dim_key: 's-1', dim_label: '唐城医院店', net_income: 30, order_count: 1, refund_rate: 0 }] },
        dateFrom: '2026-07-03',
        dateTo: '2026-07-03',
        period: '2026-07-03',
        version: 'v3',
      },
    ]);
    mockGetRevenueTrend.mockResolvedValue(revenueTrend([
      { ma7: 60, ma30: 60, ma180: 60, net_income: 60, order_count: 2, period: '2026-07-01' },
      { ma7: 45, ma30: 45, ma180: 45, net_income: 0, order_count: 0, period: '2026-07-02' },
      { ma7: 30, ma30: 30, ma180: 30, net_income: 30, order_count: 1, period: '2026-07-03' },
    ], 'day', 's-1'));

    const screen = await render(<OrderDetailRoute />);

    await waitFor(() => expect(mockGetRevenueTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-03', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.any(Object),
    ));
    expect(mockReadCachedOrderPeriodSnapshotRecords).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-03', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    );
    await waitFor(() => expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(1));
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-03', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    );
    expect(screen.getByTestId('order-detail-echart')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '详细数据' }));
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('order-period-fixed-column')).toBeTruthy();
    expect(screen.getByText('07-02')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '按周' }));
    await waitFor(() => expect(mockGetRevenueTrend).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: 'week', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.any(Object),
    ));
    await waitFor(() => expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: 'week', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    ));
    expect(mockGetOrderPeriodSnapshotRecords).toHaveBeenCalledTimes(2);
  });

  it('restores matching daily order records without a network request while offline', async () => {
    state.orderFilters = {
      ...state.orderFilters,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-03',
    };
    useInsightDetailStore.getState().selectOrder({
      avg_order_value: 30,
      dim_key: 's-1',
      dim_label: '唐城医院店',
      net_income: 90,
      order_count: 3,
      refund_rate: 0,
    }, true);
    mockReadCachedOrderPeriodSnapshotRecords.mockResolvedValue([{
      data: { rows: [{ avg_order_value: 30, dim_key: 's-1', dim_label: '唐城医院店', net_income: 60, order_count: 2, refund_rate: 0 }] },
      dateFrom: '2026-07-01',
      dateTo: '2026-07-01',
      period: '2026-07-01',
      version: 'v1',
    }]);
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<OrderDetailRoute />);

    await waitFor(() => expect(screen.getByTestId('order-detail-echart')).toBeTruthy());
    expect(mockGetOrderPeriodSnapshotRecords).not.toHaveBeenCalled();
    expect(mockReadCachedOrderPeriodSnapshotRecords).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-03', storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ dimensions: ['shop'] }),
    );
  });

  it('renders fixed store rows and reloads the table for channel display', async () => {
    mockGetOrders.mockImplementation((_filters, options) => {
      const dimensions = options?.dimensions?.join('_') ?? 'all';
      if (dimensions === 'shop_channel') {
        return Promise.resolve({
          rows: [
            { avg_order_value: 20, dim_key: 's-1|shop', dim_label: '长安旗舰店 · 堂食', net_income: 40, order_count: 2, refund_rate: 0 },
            { avg_order_value: 30, dim_key: 's-1|takeout', dim_label: '长安旗舰店 · 外卖', net_income: 60, order_count: 2, refund_rate: 0 },
          ],
        });
      }
      if (dimensions === 'shop') {
        return Promise.resolve({
          rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '长安旗舰店', net_income: 100, order_count: 4, refund_rate: 0 }],
        });
      }
      return Promise.resolve({
        rows: [{ avg_order_value: 25, dim_key: 'all', dim_label: '全部门店', net_income: 100, order_count: 4, refund_rate: 0 }],
      });
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByTestId('order-fixed-store-column')).toBeTruthy());
    expect(screen.getByTestId('order-scrollable-metrics')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    expect(screen.getByRole('button', { name: '展示维度 总计' }).props.accessibilityState)
      .toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: '展示维度 堂食外卖' }));

    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'all' }),
      expect.objectContaining({ dimensions: ['shop', 'channel'] }),
    ));
  });

  it('uses the independent order filters, renders every order metric, and exports comparison rows', async () => {
    mockGetOrders.mockResolvedValue({
      rows: [{ avg_order_value: 30, dim_key: 's-1', dim_label: '长安旗舰店', net_income: 1200, order_count: 40, paid_amount: 1400, refund_amount: 100, refund_rate: 0.0714 }],
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('长安旗舰店')).toBeTruthy());
    expect(mockGetOrders).toHaveBeenCalledWith(state.orderFilters, expect.objectContaining({ dimensions: ['shop'] }));
    expect(mockGetOperationsOverview).toHaveBeenCalledWith(expect.objectContaining({
      compare: 'previous',
      dateFrom: state.orderFilters.dateFrom,
      dateTo: state.orderFilters.dateTo,
    }));
    for (const label of ['营收', '实收', '退款', '净实收', '订单数', '客单价', '退款率']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('较上期 +20.00%').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    await fireEvent.press(screen.getByRole('button', { name: '差值' }));
    await screen.rerender(<OrderInsightScreen />);
    expect(screen.getAllByText('差值 +¥200.00').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    expect(screen.getByRole('button', { name: '按日' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按周' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按月' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '订单维度 分店铺' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));
    expect(state.setOrderFilters).toHaveBeenCalledWith(expect.objectContaining({ orderDimensions: ['shop'] }));

    await fireEvent.press(screen.getByRole('button', { name: '导出订单统计' }));
    await waitFor(() => expect(mockShareWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      fileName: expect.stringContaining('.xlsx'),
      sheets: [expect.objectContaining({ name: '订单统计' })],
      title: '订单统计',
    })));
  });

  it('keeps current order rows when the comparison request fails', async () => {
    mockGetOrders.mockResolvedValue({
      rows: [{ avg_order_value: 30, dim_key: 's-1', dim_label: '长安旗舰店', net_income: 1200, order_count: 40, refund_rate: 0 }],
    });
    mockGetOperationsOverview.mockRejectedValueOnce(new Error('comparison unavailable'));

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('长安旗舰店')).toBeTruthy());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('上期数据加载失败，已展示当前期数据', 'info'));
    expect(screen.getByText('长安旗舰店')).toBeTruthy();
  });

  it('uses the channel-neutral source for the channel table request', async () => {
    state.orderDimensions = ['channel'];
    state.orderFilters = { ...state.orderFilters, orderDimensions: ['channel'], sourceType: 'takeout' };
    mockGetOrders.mockResolvedValue({
      rows: [{ avg_order_value: 30, dim_key: 'takeout', dim_label: '外卖', net_income: 1200, order_count: 40, refund_rate: 0 }],
    });

    await render(<OrderInsightScreen />);

    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledTimes(1));
    expect(mockGetOrders).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'all' }),
      expect.objectContaining({ dimensions: ['shop', 'channel'] }),
    );
  });

  it('does not request an overview when order comparison is disabled', async () => {
    state.comparisonModeByModule = { orders: 'none' };
    mockGetOrders.mockResolvedValue({ rows: [] });

    await render(<OrderInsightScreen />);

    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled());
    expect(mockGetOperationsOverview).not.toHaveBeenCalled();
  });

  it('keeps the newest comparison when an older request resolves late', async () => {
    let resolveFirst: (value: ReturnType<typeof orderOverview>) => void;
    let resolveSecond: (value: ReturnType<typeof orderOverview>) => void;
    const first = new Promise<ReturnType<typeof orderOverview>>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<ReturnType<typeof orderOverview>>((resolve) => { resolveSecond = resolve; });
    mockGetOrders.mockResolvedValue({ rows: [] });
    mockGetOperationsOverview.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(mockGetOperationsOverview).toHaveBeenCalledTimes(1));
    state.orderFilters = { ...state.orderFilters, dateFrom: '2026-07-17', dateTo: '2026-07-17' };
    await screen.rerender(<OrderInsightScreen />);
    await waitFor(() => expect(mockGetOperationsOverview).toHaveBeenCalledTimes(2));
    resolveSecond!({ ...orderOverview(), previous_period: { date_from: '2026-07-16', date_to: '2026-07-16' } });
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    await waitFor(() => expect(screen.getByText('对比上期：2026-07-16 至 2026-07-16')).toBeTruthy());
    resolveFirst!({ ...orderOverview(), previous_period: { date_from: '2026-06-01', date_to: '2026-06-01' } });
    await waitFor(() => expect(screen.getByText('对比上期：2026-07-16 至 2026-07-16')).toBeTruthy());
  });

  it('shows the empty state when labor efficiency has no rows', async () => {
    mockGetLabor.mockResolvedValue({ rows: [] });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('暂无内容')).toBeTruthy());
  });

  it('shows the approved labor summary and trends without opening full-range rows', async () => {
    mockGetLabor.mockResolvedValue({
      rows: [
        { actual_hours: 8, headcount: 2, hours_gap: 2, net_revenue: 1600, planned_hours: 10, revenue_per_hour: 200, store_key: 's-1', store_label: '长安旗舰店', uncovered: false },
        { actual_hours: 10, headcount: 3, hours_gap: -2, net_revenue: 2600, planned_hours: 8, revenue_per_hour: 260, store_key: 's-2', store_label: '茅坡店', uncovered: false },
        { actual_hours: 5, headcount: 1, hours_gap: 1, net_revenue: 0, planned_hours: 6, revenue_per_hour: 0, store_key: 's-3', store_label: '零实收店', uncovered: false },
      ],
    });
    mockGetLaborTrend.mockResolvedValue({
      granularity: 'day',
      period: '2026-06-17_2026-07-16',
      points: [laborTrendPoint('2026-07-15'), laborTrendPoint('2026-07-16')],
      store_key: 'ALL',
      store_label: '全部门店',
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('人效分析')).toBeTruthy());
    expect(screen.getByText('人效 = 门店净实收 ÷ 实际工时（元/工时）')).toBeTruthy();
    for (const label of ['实际人效', '排班人效', '净实收', '实际工时', '排班工时']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const hoursChart = screen.getByText('工时趋势');
    const efficiencyChart = screen.getByText('人效趋势');
    expect(hoursChart).toBeTruthy();
    expect(efficiencyChart).toBeTruthy();
    expect(screen.getByTestId('labor-hours-echart')).toBeTruthy();
    expect(screen.getByTestId('labor-efficiency-echart')).toBeTruthy();
    expect(mockGetOperationsLabor).toHaveBeenCalledWith(expect.objectContaining({
      compare: 'previous',
      dateFrom: '2026-07-16',
      dateTo: '2026-07-16',
      granularity: 'day',
      signal: expect.any(AbortSignal),
    }));
    expect(screen.getByText('较上期 +20.00%')).toBeTruthy();
    const rankingRows = screen.getAllByTestId(/labor-ranking-row-/);
    expect(rankingRows[0].props.accessibilityLabel).toBeUndefined();
    expect(rankingRows[1].props.accessibilityLabel).toBeUndefined();
    expect(screen.queryByRole('button', { name: '茅坡店' })).toBeNull();
    expect(screen.queryByRole('button', { name: '长安旗舰店' })).toBeNull();
    expect(screen.getByText('1 项记录当前净实收为 0 或未映射，仅作为工时覆盖检查，不进入门店人效排名。')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '全屏查看工时趋势' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chart', params: expect.objectContaining({ laborMetric: 'hours', type: 'labor-hours' }) });
  });

  it('opens labor detail with the full store and employee names', async () => {
    const longStoreName = '这是一个用于验证餐段人效门店名称最多显示两行的超长中文门店名称'.repeat(2);
    const employeeName = '王小明（外店支援，超长员工姓名用于验证详情完整展示）'.repeat(2);
    const displayName = longStoreName;
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['shop:s-1'], storeKey: 's-1', storeKeys: ['s-1'] };
    state.scopeTree = [{ key: 'shop:s-1', type: 'store', label: longStoreName, store_key: 's-1', department_id: '111' }];
    mockGetLabor.mockResolvedValue({
      rows: [{ actual_hours: 12.5, headcount: 4, hours_gap: 0, net_revenue: 2000, planned_hours: 12.5, revenue_per_hour: 160, store_key: '111', store_label: longStoreName, uncovered: false }],
    });
    mockGetLaborDetail.mockResolvedValue({
      granularity: 'range',
      period: '2026-06-17_2026-07-16',
      store_key: 's-1',
      store_label: longStoreName,
      labor: {
        actual_hours: 12.5,
        employees: [{ actual_hours: 8, anomaly_count: 1, hours_gap: 0, missing_count: 0, name: employeeName, planned_hours: 8, segment_count: 2, support_type: '本店', user_id: 'u-1' }],
        headcount: 1,
        hours_gap: 0,
        planned_hours: 12.5,
      },
      revenue: {
        daily: [{ business_date: '2026-07-16', income_amount: 2100, net_income: 2000, order_count: 40, paid_amount: 2200, refund_amount: 100 }],
        income_amount: 2100,
        net_income: 2000,
        order_count: 40,
        paid_amount: 2200,
        refund_amount: 100,
        shops: [],
      },
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText(displayName)).toBeTruthy());
    expect(screen.getByText('实际 12.5h · 排班 12.5h')).toBeTruthy();
    expect(screen.getByText(displayName).props.numberOfLines).toBe(2);
    await fireEvent.press(screen.getByRole('button', { name: displayName }));
    expect(mockPush).toHaveBeenCalledWith('/analytics/labor/detail');
    await screen.unmount();

    const detail = await render(<LaborDetailRoute />);
    await waitFor(() => expect(detail.getByText(employeeName)).toBeTruthy());
    expect(detail.getByText(longStoreName).props.numberOfLines).toBeUndefined();
    expect(detail.getByText(employeeName).props.numberOfLines).toBeUndefined();
    expect(detail.getByRole('button', { name: '工时明细' })).toBeTruthy();
    expect(detail.getByText('本店')).toBeTruthy();
    await fireEvent.press(detail.getByRole('button', { name: '净实收明细' }));
    expect(detail.getByText('2026-07-16')).toBeTruthy();
    expect(detail.getByText('净实收').parent).toHaveStyle({ width: '50%' });
    expect(detail.getAllByText('40 单').length).toBeGreaterThan(0);
    expect(detail.getAllByText('¥ 2,000.00').length).toBeGreaterThan(0);
  });

  it('uses the shared filter sheet and reloads products after applying filters', async () => {
    mockGetProducts.mockResolvedValue({ bottom: [], top: [{ order_count: 12, product_key: 'p-1', product_name: '招牌牛肉面', quantity: 15, sales_amount: 390, sales_share: 0.25 }] });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getAllByText('招牌牛肉面').length).toBeGreaterThan(0));
    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await waitFor(() => expect(screen.getByText('筛选条件')).toBeTruthy());
    expect(screen.getByText('分析维度')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '选择分析维度 分店铺' }));
    expect(screen.getByRole('button', { name: '选择门店 长安旗舰店' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '近10日' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 长安旗舰店' }));
    await fireEvent.press(screen.getByText('确定'));

    await waitFor(() => expect(mockGetProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: expect.any(String), storeKey: 's-1', storeKeys: ['s-1'] }),
      expect.objectContaining({ signal: expect.anything() }),
    ));
  });

  it('shows the approved product summary, two default product trends, and sales ranking', async () => {
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [
        { order_count: 1406, product_key: 'p-1', product_name: '鲜肉小馄饨（大份）', quantity: 1842, sales_amount: 62840, sales_share: 0.128 },
        { order_count: 1182, product_key: 'p-2', product_name: '虾仁鲜肉小馄饨', quantity: 1504, sales_amount: 50960, sales_share: 0.104 },
      ],
      total: 126,
    });
    mockGetProductTrend.mockImplementation(async (productKey) => productTrend(
      productKey,
      productKey === 'p-2' ? '虾仁鲜肉小馄饨' : '鲜肉小馄饨（大份）',
    ));

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText('多产品销量趋势')).toBeTruthy());
    expect(screen.getByText('商品销额按订单商品原价或销售额统计，不扣优惠、退款和平台佣金，不等同财务净实收。')).toBeTruthy();
    expect(screen.getByText('126')).toBeTruthy();
    expect(screen.getAllByText('鲜肉小馄饨（大份）').length).toBeGreaterThan(0);
    expect(screen.getByTestId('product-echart')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 鲜肉小馄饨（大份）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 虾仁鲜肉小馄饨' })).toBeTruthy();
    const rows = screen.getAllByTestId(/product-ranking-row-/);
    expect(rows[0].props.accessibilityLabel).toBe('鲜肉小馄饨（大份）');
    expect(rows[1].props.accessibilityLabel).toBe('虾仁鲜肉小馄饨');
    await fireEvent.press(screen.getByRole('button', { name: '全屏查看单品销量趋势' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chart',
      params: expect.objectContaining({
        dateFrom: '2026-06-17',
        dateTo: '2026-07-16',
        dimKey: 'ALL',
        dimType: 'all',
        granularity: 'day',
        productKey: 'p-1',
        selectedProductKeys: 'p-1,p-2',
        cacheKey: expect.stringMatching(/^product-dashboard-v4:.*comparison_mode=previous/),
        type: 'product',
      }),
    });
    expect(useInsightDetailStore.getState().productTrend?.product_key).toBe('p-1');
  });

  it('supports multiple trend selections and keeps the remaining valid product after a filter refresh', async () => {
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [
        { order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
        { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
      ],
      total: 2,
    });
    mockGetProductTrend.mockImplementation(async (productKey) => productTrend(productKey, productKey === 'p-2' ? '虾仁小馄饨' : '鲜肉小馄饨'));

    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(state.selectedProductKeys).toEqual(['p-1', 'p-2']));
    await fireEvent.press(screen.getByRole('button', { name: '选择趋势产品 鲜肉小馄饨' }));
    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 鲜肉小馄饨' }));
    await waitFor(() => expect(state.selectedProductKeys).toEqual(['p-2']));
    await waitFor(() => expect(mockGetProductTrend).toHaveBeenLastCalledWith(
      'p-2',
      state.filters,
      expect.objectContaining({ dimKey: 'ALL', dimType: 'all', signal: expect.anything() }),
    ));

    await fireEvent.press(screen.getByRole('button', { name: '关闭产品选择' }));
    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '选择分析维度 堂食/外卖' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择堂食/外卖 外卖' }));
    await fireEvent.press(screen.getByText('确定'));
    await waitFor(() => expect(mockGetProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-16', dateTo: '2026-07-16' }),
      expect.objectContaining({ dimKey: 'takeout', dimType: 'channel', limit: 0, signal: expect.anything() }),
    ));
    await waitFor(() => expect(state.selectedProductKeys).toEqual(['p-2']));
    await waitFor(() => expect(mockGetProductTrend).toHaveBeenLastCalledWith(
      'p-2',
      state.filters,
      expect.objectContaining({ dimKey: 'takeout', dimType: 'channel', signal: expect.anything() }),
    ));

    await fireEvent.press(screen.getByTestId('product-ranking-row-p-1'));
    expect(mockPush).toHaveBeenLastCalledWith('/analytics/products/trend');
    await screen.unmount();
    const detail = await render(<ProductTrendRoute />);
    await waitFor(() => expect(mockGetProductTrend).toHaveBeenLastCalledWith(
      'p-1',
      state.filters,
      expect.objectContaining({ dimKey: 'takeout', dimType: 'channel', signal: expect.anything() }),
    ));
    await detail.unmount();
  });

  it('keeps the successful product trend and ranking visible when another selected trend fails', async () => {
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [
        { order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
        { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
      ],
      total: 2,
    });
    mockGetProductTrend.mockImplementation(async (productKey) => {
      if (productKey === 'p-2') throw new Error('趋势请求失败');
      return productTrend(productKey, '鲜肉小馄饨');
    });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText('部分产品趋势加载失败')).toBeTruthy());
    expect(screen.getByText('多产品销量趋势')).toBeTruthy();
    expect(screen.getByTestId('product-echart')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 鲜肉小馄饨' })).toBeTruthy();
    expect(screen.getAllByText('虾仁小馄饨').length).toBeGreaterThan(0);
  });

  it('clears product trends when the last selected product is removed during a pending request', async () => {
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [
        { order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
        { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
      ],
      total: 2,
    });
    let secondProductCalls = 0;
    mockGetProductTrend.mockImplementation((productKey, _filters, options) => {
      if (productKey !== 'p-2') return Promise.resolve(productTrend(productKey, '鲜肉小馄饨'));
      secondProductCalls += 1;
      if (secondProductCalls === 1) return Promise.resolve(productTrend('p-2', '虾仁小馄饨'));
      return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    });

    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getByTestId('product-echart')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '选择趋势产品 鲜肉小馄饨' }));
    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 鲜肉小馄饨' }));
    await waitFor(() => expect(secondProductCalls).toBe(2));
    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 虾仁小馄饨' }));

    await waitFor(() => {
      expect(state.selectedProductKeys).toEqual([]);
      expect(screen.queryByText('正在加载')).toBeNull();
      expect(screen.queryByTestId('product-echart')).toBeNull();
    });
    expect(screen.getByText('当前筛选暂无单品趋势数据')).toBeTruthy();
  });

  it('removes unavailable selected products while retaining valid selections after a refresh', async () => {
    mockGetProducts
      .mockResolvedValueOnce({
        bottom: [],
        top: [
          { order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
          { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        bottom: [],
        top: [
          { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.5 },
          { order_count: 8, product_key: 'p-3', product_name: '香菇小馄饨', quantity: 16, sales_amount: 480, sales_share: 0.4 },
        ],
        total: 2,
      });
    mockGetProductTrend.mockImplementation(async (productKey) => productTrend(
      productKey,
      productKey === 'p-3' ? '香菇小馄饨' : productKey === 'p-2' ? '虾仁小馄饨' : '鲜肉小馄饨',
    ));

    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(state.selectedProductKeys).toEqual(['p-1', 'p-2']));
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    await waitFor(() => expect(state.selectedProductKeys).toEqual(['p-2', 'p-3']));
    expect(screen.getByText('多产品销量趋势')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '隐藏 鲜肉小馄饨' })).toBeNull();
    expect(screen.getByRole('button', { name: '隐藏 虾仁小馄饨' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 香菇小馄饨' })).toBeTruthy();
  });

  it('keeps successful trends visible when a refresh only fails for one selected product', async () => {
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [
        { order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
        { order_count: 10, product_key: 'p-2', product_name: '虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
      ],
      total: 2,
    });
    let secondProductCalls = 0;
    mockGetProductTrend.mockImplementation(async (productKey) => {
      if (productKey === 'p-2') {
        secondProductCalls += 1;
        if (secondProductCalls > 1) throw new Error('趋势刷新失败');
        return productTrend(productKey, '虾仁小馄饨');
      }
      return productTrend(productKey, '鲜肉小馄饨');
    });

    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getByTestId('product-echart')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    await waitFor(() => expect(screen.getByText('部分产品趋势加载失败')).toBeTruthy());
    expect(screen.getByText('多产品销量趋势')).toBeTruthy();
    expect(screen.getByTestId('product-echart')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 鲜肉小馄饨' })).toBeTruthy();
    expect(mockSaveCachedAnalytics).toHaveBeenCalledWith(
      'products',
      expect.stringMatching(/^product-dashboard-v4:.*comparison_mode=previous/),
      expect.objectContaining({
        selectedProductKeys: ['p-1', 'p-2'],
        trends: expect.objectContaining({ 'p-1': expect.objectContaining({ product_key: 'p-1' }) }),
      }),
      expect.any(Number),
    );
  });

  it('restores the v4 multi-product cache while the device is offline', async () => {
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        comparison: null,
        comparisonMode: 'previous',
        filters: state.filters,
        ranking: {
          bottom: [],
          top: [
            { order_count: 20, product_key: 'p-1', product_name: '缓存鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 },
            { order_count: 10, product_key: 'p-2', product_name: '缓存虾仁小馄饨', quantity: 20, sales_amount: 600, sales_share: 0.4 },
          ],
          total: 2,
        },
        selectedProductKeys: ['p-1', 'p-2'],
        scope: { dimKey: 'ALL', dimType: 'all' },
        trends: {
          'p-1': productTrend('p-1', '缓存鲜肉小馄饨'),
          'p-2': productTrend('p-2', '缓存虾仁小馄饨'),
        },
      },
      lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00'),
    });
    useInsightDetailStore.setState({ product: { order_count: 20, product_key: 'p-1', product_name: '缓存鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 0.6 } });
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getAllByText('缓存鲜肉小馄饨').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: '选择趋势产品 缓存鲜肉小馄饨' })).toBeNull();
    expect(screen.getByText('多产品销量趋势')).toBeTruthy();
    expect(screen.getByTestId('product-echart')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 缓存鲜肉小馄饨' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 缓存虾仁小馄饨' })).toBeTruthy();
    expect(state.selectedProductKeys).toEqual(['p-1', 'p-2']);
    expect(mockReadCachedAnalytics).toHaveBeenCalledWith(
      'products',
      expect.stringMatching(/^product-dashboard-v4:.*comparison_mode=previous/),
      expect.any(Number),
    );
    expect(mockGetProducts).not.toHaveBeenCalled();
  });

  it('clears prior product rows when a changed offline scope has no exact cache hit', async () => {
    mockGetProducts.mockResolvedValueOnce({
      bottom: [],
      top: [{ order_count: 20, product_key: 'p-1', product_name: '旧商品范围', quantity: 30, sales_amount: 900, sales_share: 1 }],
      total: 1,
    });
    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getAllByText('旧商品范围').length).toBeGreaterThan(0));

    state.filters = { ...state.filters, dateFrom: '2026-07-17', dateTo: '2026-07-17' };
    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
    });
    await screen.rerender(<ProductInsightScreen />);

    await waitFor(() => expect(screen.queryAllByText('旧商品范围')).toHaveLength(0));
    expect(screen.getByText('当前处于离线状态')).toBeTruthy();
  });

  it('aborts active product trends as soon as force refresh starts', async () => {
    mockGetProducts
      .mockResolvedValueOnce({
        bottom: [],
        top: [{ order_count: 20, product_key: 'p-1', product_name: '强刷趋势商品', quantity: 30, sales_amount: 900, sales_share: 1 }],
        total: 1,
      })
      .mockReturnValueOnce(new Promise(() => {}));
    let trendAborted = false;
    mockGetProductTrend.mockImplementation((_key, _filters, options) => new Promise((_, reject) => {
      options?.signal?.addEventListener('abort', () => {
        trendAborted = true;
        reject(new Error('aborted'));
      });
    }));

    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(mockGetProductTrend).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    await waitFor(() => expect(trendAborted).toBe(true));
  });

  it('opens a real product trend drill-down with a full product name and formatted points', async () => {
    const longProductName = '招牌秘制牛肉拌面超大份商品名称用于验证两行截断与详情完整展示'.repeat(2);
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [{ order_count: 12, product_key: 'name:招牌秘制牛肉拌面', product_name: longProductName, quantity: 15, sales_amount: 390, sales_share: 0.25 }],
    });
    mockGetProductTrend.mockResolvedValue({
      date_from: '2026-06-17',
      date_to: '2026-07-16',
      dim_key: 'ALL',
      dim_type: 'all',
      metric: 'quantity',
      points: [{ ma7: 12.5, ma30: null, ma180: null, missing: false, order_count: 12, period: '2026-07-16', quantity: 15, sales_amount: 390 }],
      product_key: 'name:招牌秘制牛肉拌面',
      product_name: longProductName,
    });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getAllByText(longProductName).length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('product-ranking-row-name:招牌秘制牛肉拌面')).getByText(longProductName).props.numberOfLines).toBe(2);
    await fireEvent.press(screen.getByRole('button', { name: longProductName }));
    expect(mockPush).toHaveBeenCalledWith('/analytics/products/trend');
    await screen.unmount();

    const detail = await render(<ProductTrendRoute />);
    await waitFor(() => expect(detail.getByText('2026-07-16')).toBeTruthy());
    expect(mockGetProductTrend).toHaveBeenCalledWith(
      'name:招牌秘制牛肉拌面',
      state.filters,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(detail.getByText(longProductName).props.numberOfLines).toBeUndefined();
    expect(detail.getAllByText('390.00')).toHaveLength(2);
  });

  it('keeps cached data interactive after a temporary fallback while the device is online', async () => {
    mockGetOrders.mockResolvedValue({
      rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '长安旗舰店', net_income: 1000, order_count: 40, refund_rate: 0 }],
    });
    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(screen.getByText('长安旗舰店')).toBeTruthy());

    state.isOffline = true;
    state.lastSyncedAt = Date.parse('2026-07-16T15:05:00+08:00');
    await screen.rerender(<OrderInsightScreen />);

    expect(screen.getByText('离线查看 · 上次同步 2026-07-16 15:05')).toBeTruthy();
    expect(screen.getByText('长安旗舰店')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    expect(screen.getByText('筛选条件')).toBeTruthy();
    expect(mockGetOrders).toHaveBeenCalledTimes(2);
  });

  it('reads cached insight data without starting a request when the device is offline', async () => {
    const rows = [{ avg_order_value: 25, dim_key: 's-1', dim_label: '设备离线门店', net_income: 1000, order_count: 40, refund_rate: 0 }];
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
        comparison: orderOverview(),
        data: { rows },
        summary: { rows },
      },
      lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00'),
    });
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('设备离线门店')).toBeTruthy());
    expect(mockGetOrders).not.toHaveBeenCalled();
    expect(screen.getByText('离线查看 · 上次同步 2026-07-16 15:05')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    expect(screen.getByText('对比上期：2026-07-15 至 2026-07-15')).toBeTruthy();
    expect(screen.getByRole('button', { name: '强制刷新' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows the exact cached order snapshot while an online revalidation is pending', async () => {
    const cachedRow = { avg_order_value: 25, dim_key: 's-1', dim_label: '缓存订单门店', net_income: 1000, order_count: 40, refund_rate: 0 };
    const updatedRow = { avg_order_value: 30, dim_key: 's-2', dim_label: '最新订单门店', net_income: 1200, order_count: 45, refund_rate: 0 };
    mockReadCachedAnalytics.mockResolvedValueOnce({
      data: {
        cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
        comparison: null,
        data: { rows: [cachedRow] },
        summary: { rows: [cachedRow] },
      },
      lastSyncedAt: Date.parse('2026-08-14T09:00:00+08:00'),
    });
    let resolveRequest: ((value: { rows: typeof updatedRow[] }) => void) | undefined;
    mockGetOrders.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('缓存订单门店')).toBeTruthy());
    expect(screen.getByText('正在读取最新数据')).toBeTruthy();
    resolveRequest?.({ rows: [updatedRow] });
    await waitFor(() => expect(screen.getByText('最新订单门店')).toBeTruthy());
  });

  it('does not revalidate a fresh exact order snapshot', async () => {
    const cacheContext = `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`;
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext,
        comparison: null,
        data: { rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '缓存订单门店', net_income: 1000, order_count: 40, refund_rate: 0 }] },
      },
      lastSyncedAt: Date.now() - 60_000,
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('缓存订单门店')).toBeTruthy());
    expect(mockGetOrders).not.toHaveBeenCalled();
    expect(mockGetOperationsOverview).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it.each([
    ['403 Forbidden'],
    ['500 Internal Server Error'],
  ])('removes a cached order snapshot after an online %s revalidation failure', async (message) => {
    const cachedRow = { avg_order_value: 25, dim_key: 's-1', dim_label: '不应继续展示的订单缓存', net_income: 1000, order_count: 40, refund_rate: 0 };
    mockReadCachedAnalytics.mockResolvedValueOnce({
      data: {
        cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
        comparison: null,
        data: { rows: [cachedRow] },
        summary: { rows: [cachedRow] },
      },
      lastSyncedAt: Date.parse('2026-08-14T09:00:00+08:00'),
    });
    mockGetOrders.mockRejectedValueOnce(new Error(message));

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('加载失败')).toBeTruthy());
    expect(screen.queryByText('不应继续展示的订单缓存')).toBeNull();
  });

  it('clears prior order rows when a changed scope has no exact cache hit', async () => {
    mockGetOrders
      .mockResolvedValueOnce({ rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '旧订单范围', net_income: 1000, order_count: 40, refund_rate: 0 }] })
      .mockReturnValueOnce(new Promise(() => {}));
    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(screen.getByText('旧订单范围')).toBeTruthy());

    state.orderFilters = { ...state.orderFilters, dateFrom: '2026-07-17', dateTo: '2026-07-17' };
    await screen.rerender(<OrderInsightScreen />);

    await waitFor(() => expect(screen.queryByText('旧订单范围')).toBeNull());
    expect(screen.getByText('正在加载')).toBeTruthy();
  });

  it('does not restore the old snapshot after a forced refresh fails', async () => {
    const cachedRow = { avg_order_value: 25, dim_key: 's-1', dim_label: '旧订单缓存', net_income: 1000, order_count: 40, refund_rate: 0 };
    const currentRow = { avg_order_value: 30, dim_key: 's-2', dim_label: '当前订单门店', net_income: 1200, order_count: 45, refund_rate: 0 };
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
        comparison: null,
        data: { rows: [cachedRow] },
        summary: { rows: [cachedRow] },
      },
      lastSyncedAt: Date.parse('2026-08-14T09:00:00+08:00'),
    });
    mockGetOrders
      .mockResolvedValueOnce({ rows: [currentRow] })
      .mockRejectedValueOnce(new Error(NETWORK_ERROR_MESSAGE));

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('当前订单门店')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.getByText('当前订单门店')).toBeTruthy();
    expect(screen.queryByText('旧订单缓存')).toBeNull();
    expect(mockClearCachedAnalytics).toHaveBeenCalledWith('orders', orderAnalyticsCacheScope(state.orderFilters, 'previous'));
    expect(mockReadCachedAnalytics).toHaveBeenCalledTimes(1);
  });

  it('rejects an order snapshot with a mismatched cache context', async () => {
    const staleRow = { avg_order_value: 25, dim_key: 's-1', dim_label: '错误范围缓存', net_income: 1000, order_count: 40, refund_rate: 0 };
    const currentRow = { avg_order_value: 30, dim_key: 's-2', dim_label: '当前范围订单', net_income: 1200, order_count: 45, refund_rate: 0 };
    mockReadCachedAnalytics.mockResolvedValueOnce({
      data: {
        cacheContext: 'different-order-scope',
        comparison: null,
        data: { rows: [staleRow] },
        summary: { rows: [staleRow] },
      },
      lastSyncedAt: Date.parse('2026-08-14T09:00:00+08:00'),
    });
    mockGetOrders.mockResolvedValueOnce({ rows: [currentRow] });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('当前范围订单')).toBeTruthy());
    expect(screen.queryByText('错误范围缓存')).toBeNull();
  });

  it('rejects a malformed order snapshot without crashing', async () => {
    const currentRow = { avg_order_value: 30, dim_key: 's-2', dim_label: '完整订单结果', net_income: 1200, order_count: 45, refund_rate: 0 };
    mockReadCachedAnalytics.mockResolvedValueOnce({
      data: { cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`, comparison: null, data: null, summary: null } as never,
      lastSyncedAt: Date.parse('2026-08-14T09:00:00+08:00'),
    });
    mockGetOrders.mockResolvedValueOnce({ rows: [currentRow] });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('完整订单结果')).toBeTruthy());
  });

  it('treats the legacy bare orders scope as a miss when offline', async () => {
    const legacyScope = serializeAnalyticsFilters(state.orderFilters);
    mockReadCachedAnalytics.mockImplementation(async (_module, scope) => scope === legacyScope ? {
      data: { rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '旧订单缓存', net_income: 1000, order_count: 40, refund_rate: 0 }] },
      lastSyncedAt: Date.now(),
    } as never : null);
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(mockReadCachedAnalytics).toHaveBeenCalledWith('orders', orderAnalyticsCacheScope(state.orderFilters, 'previous'), expect.any(Number)));
    expect(screen.queryByText('旧订单缓存')).toBeNull();
    await screen.unmount();
  });

  it('blocks force refresh on every insight screen until connectivity is confirmed', async () => {
    useNetworkStore.setState({ status: 'unknown' });
    mockGetOrders.mockResolvedValue({ rows: [] });
    mockGetLabor.mockResolvedValue({ rows: [] });
    mockGetProducts.mockResolvedValue({ bottom: [], top: [] });

    for (const Screen of [OrderInsightScreen, LaborInsightScreen, ProductInsightScreen]) {
      const screen = await render(<Screen />);
      expect(screen.getByRole('button', { name: '强制刷新' }).props.accessibilityState).toMatchObject({ disabled: true });
      await screen.unmount();
    }
  });

  it('shows a distinct state while forcing a refresh', async () => {
    let resolveRefresh: ((value: { rows: [] }) => void) | undefined;
    mockGetOrders
      .mockResolvedValueOnce({ rows: [] })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(screen.getByText('暂无内容')).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    expect(screen.getByText('正在强制刷新')).toBeTruthy();

    resolveRefresh?.({ rows: [] });
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledTimes(2));
  });

  it('does not start drill-down requests when the device loses connectivity', async () => {
    mockGetLaborDetail.mockReturnValue(new Promise(() => {}));
    mockGetProductTrend.mockReturnValue(new Promise(() => {}));
    useInsightDetailStore.setState({
      isReadOnly: false,
      labor: { actual_hours: 10, headcount: 2, hours_gap: 0, net_revenue: 1000, planned_hours: 10, revenue_per_hour: 100, store_key: 's-1', store_label: '离线人效门店', uncovered: false },
      order: null,
      product: { order_count: 12, product_key: 'p-1', product_name: '离线商品', quantity: 15, sales_amount: 390, sales_share: 0.25 },
    });
    useNetworkStore.setState({ status: 'offline' });

    const labor = await render(<LaborDetailRoute />);
    expect(labor.getByText('离线状态下仅显示已加载汇总')).toBeTruthy();
    expect(mockGetLaborDetail).not.toHaveBeenCalled();
    await labor.unmount();

    const product = await render(<ProductTrendRoute />);
    expect(product.getByText('离线状态下仅显示已加载汇总')).toBeTruthy();
    expect(mockGetProductTrend).not.toHaveBeenCalled();
  });

  it('writes successful order, labor, and product results to their analytics cache modules', async () => {
    mockGetOrders.mockResolvedValue({ rows: [] });
    mockGetLabor.mockResolvedValue({ rows: [] });
    mockGetProducts.mockResolvedValue({
      bottom: [],
      top: [{ order_count: 20, product_key: 'p-1', product_name: '鲜肉小馄饨', quantity: 30, sales_amount: 900, sales_share: 1 }],
      total: 1,
    });
    mockGetProductTrend.mockResolvedValue(productTrend('p-1', '鲜肉小馄饨'));

    const orders = await render(<OrderInsightScreen />);
    await waitFor(() => expect(mockSaveCachedAnalytics).toHaveBeenCalledWith('orders', orderAnalyticsCacheScope(state.orderFilters, 'previous'), expect.objectContaining({
      cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
      comparison: orderOverview(),
      data: { rows: [] },
    }), expect.any(Number)));
    await orders.unmount();
    const labor = await render(<LaborInsightScreen />);
    const laborDetailFilters = { ...state.laborFilters, dateFrom: '2026-07-16', dateTo: '2026-07-16' };
    await waitFor(() => expect(mockSaveCachedAnalytics).toHaveBeenCalledWith('labor', laborDashboardCacheScope(laborDetailFilters, 'ALL::', 'previous'), expect.objectContaining({
      cacheContext: { comparisonMode: 'previous', departmentKeys: [], filters: serializeAnalyticsFilters(laborDetailFilters), scopeKey: 'ALL::' },
      comparison: laborComparison(),
      summary: { rows: [] },
      trend: emptyLaborTrend(),
    }), expect.any(Number)));
    await labor.unmount();
    const products = await render(<ProductInsightScreen />);
    await waitFor(() => expect(mockSaveCachedAnalytics).toHaveBeenCalledWith(
      'products',
      expect.stringMatching(/^product-dashboard-v4:.*comparison_mode=previous.*product_keys=p-1/),
      expect.objectContaining({
        ranking: expect.objectContaining({ top: [expect.objectContaining({ product_key: 'p-1' })] }),
        comparisonMode: 'previous',
        selectedProductKeys: ['p-1'],
        trends: expect.objectContaining({ 'p-1': expect.objectContaining({ product_key: 'p-1' }) }),
      }),
      expect.any(Number),
    ));
    await products.unmount();
  });

  it('does not save an old comparison into a new order cache scope when the new comparison fails', async () => {
    const first = { rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '旧范围门店', net_income: 1000, order_count: 40, refund_rate: 0 }] };
    const second = { rows: [{ avg_order_value: 30, dim_key: 's-2', dim_label: '新范围门店', net_income: 1200, order_count: 40, refund_rate: 0 }] };
    const firstScope = orderAnalyticsCacheScope(state.orderFilters, 'previous');
    mockGetOrders.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    mockGetOperationsOverview.mockResolvedValueOnce(orderOverview()).mockRejectedValueOnce(new Error('comparison unavailable'));

    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(mockSaveCachedAnalytics).toHaveBeenCalledWith('orders', firstScope, expect.objectContaining({ comparison: orderOverview(), data: first }), expect.any(Number)));

    state.orderFilters = { ...state.orderFilters, dateFrom: '2026-07-17', dateTo: '2026-07-17' };
    const nextScope = orderAnalyticsCacheScope(state.orderFilters, 'previous');
    await screen.rerender(<OrderInsightScreen />);

    await waitFor(() => expect(mockSaveCachedAnalytics).toHaveBeenCalledWith('orders', nextScope, expect.objectContaining({ comparison: null, data: second }), expect.any(Number)));
    expect(mockShowToast).toHaveBeenCalledWith('上期数据加载失败，已展示当前期数据', 'info');
    await screen.unmount();
  });

  it('clears prior aggregate data when the table filters change', async () => {
    state.comparisonModeByModule = { orders: 'none' };
    const oldSummary = {
      rows: [{ avg_order_value: 50, dim_key: 'ALL', dim_label: '旧范围汇总', net_income: 4000, order_count: 99, paid_amount: 5000, refund_rate: 0 }],
    };
    const nextRows = {
      rows: [{ avg_order_value: 30, dim_key: 's-2', dim_label: '新范围门店', net_income: 1200, order_count: 40, paid_amount: 1400, refund_rate: 0 }],
    };
    mockGetOrders
      .mockResolvedValueOnce(oldSummary)
      .mockResolvedValueOnce(nextRows);

    const screen = await render(<OrderInsightScreen />);
    await waitFor(() => expect(screen.getAllByText('5,000.00').length).toBeGreaterThan(0));

    state.orderDimensions = ['shop'];
    state.orderFilters = { ...state.orderFilters, dateFrom: '2026-07-17', dateTo: '2026-07-17', orderDimensions: ['shop'] };
    const nextScope = orderAnalyticsCacheScope(state.orderFilters, 'none');
    await screen.rerender(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('新范围门店')).toBeTruthy());
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledTimes(2));
    expect(screen.queryAllByText('5,000.00')).toHaveLength(0);
    expect(mockSaveCachedAnalytics).toHaveBeenCalledWith('orders', nextScope, expect.objectContaining({ data: nextRows }), expect.any(Number));
    await screen.unmount();
  });

  it('falls back to the matching cached order scope and can retry after a transient network error', async () => {
    const lastSyncedAt = Date.parse('2026-07-16T15:05:00+08:00');
    mockGetOrders
      .mockRejectedValueOnce(new Error(NETWORK_ERROR_MESSAGE))
      .mockResolvedValueOnce({
        rows: [{ avg_order_value: 30, dim_key: 's-2', dim_label: '在线门店', net_income: 1200, order_count: 40, refund_rate: 0 }],
      });
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: `${serializeAnalyticsFilters(state.orderFilters)}:comparison_mode=previous`,
        comparison: null,
        data: { rows: [{ avg_order_value: 25, dim_key: 's-1', dim_label: '离线门店', net_income: 1000, order_count: 40, refund_rate: 0 }] },
        summary: null,
      },
      lastSyncedAt,
    });

    const screen = await render(<OrderInsightScreen />);

    await waitFor(() => expect(screen.getByText('离线门店')).toBeTruthy());
    expect(screen.getByText('离线查看 · 上次同步 2026-07-16 15:05')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '展开筛选条件' }));
    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    expect(screen.getByText('筛选条件')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('在线门店')).toBeTruthy());
    expect(screen.queryByText('离线查看 · 上次同步 2026-07-16 15:05')).toBeNull();
    expect(mockGetOrders).toHaveBeenCalledTimes(2);
    expect(mockReadCachedAnalytics).toHaveBeenCalledWith('orders', orderAnalyticsCacheScope(state.orderFilters, 'previous'), expect.any(Number));
  });

  it('loads a cached labor drill-down from the server when the device remains online', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['shop:s-1'], storeKey: 's-1', storeKeys: ['s-1'] };
    state.scopeTree = [{ key: 'shop:s-1', type: 'store', label: '离线人效门店', store_key: 's-1', department_id: '111' }];
    const detailFilters = { ...state.laborFilters, dateFrom: '2026-07-16', dateTo: '2026-07-16' };
    mockGetLabor.mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    mockGetLaborDetail.mockResolvedValue({
      granularity: 'range',
      period: '2026-06-17_2026-07-16',
      store_key: 's-1',
      store_label: '离线人效门店',
      labor: { actual_hours: 10, employees: [], headcount: 2, hours_gap: 0, planned_hours: 10 },
      revenue: { daily: [], income_amount: 1000, net_income: 1000, order_count: 40, paid_amount: 1000, refund_amount: 0, shops: [] },
    });
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: {
          comparisonMode: 'previous',
          departmentKeys: ['111'],
          filters: serializeAnalyticsFilters(detailFilters),
          scopeKey: 'shop:s-1:s-1:111',
        },
        summary: { rows: [{ actual_hours: 10, headcount: 2, hours_gap: 0, net_revenue: 1000, planned_hours: 10, revenue_per_hour: 100, store_key: '111', store_label: '离线人效门店', uncovered: false }] },
        trend: emptyLaborTrend(),
      },
      lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00'),
    });

    const screen = await render(<LaborInsightScreen />);
    await waitFor(() => expect(screen.getByText('离线人效门店')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '离线人效门店' }));
    await screen.unmount();

    const detail = await render(<LaborDetailRoute />);
    await waitFor(() => expect(mockGetLaborDetail).toHaveBeenCalled());
    expect(detail.queryByText('离线状态下仅显示已加载汇总')).toBeNull();
  });
});

function laborTrendPoint(period: string) {
  return {
    actual_hours: 10,
    actual_hours_ma7: 9.5,
    actual_hours_ma30: 9,
    actual_hours_ma180: 8.5,
    actual_revenue_per_hour: 220,
    actual_revenue_per_hour_ma7: 215,
    actual_revenue_per_hour_ma30: 210,
    actual_revenue_per_hour_ma180: 205,
    headcount: 3,
    missing: false,
    net_revenue: 2200,
    period,
    planned_hours: 12,
    planned_hours_ma7: 11.5,
    planned_hours_ma30: 11,
    planned_hours_ma180: 10.5,
    planned_revenue_per_hour: 200,
    planned_revenue_per_hour_ma7: 198,
    planned_revenue_per_hour_ma30: 196,
    planned_revenue_per_hour_ma180: 194,
  };
}

function emptyProductTrend() {
  return productTrend('', null);
}

function productTrend(productKey: string, productName: string | null, scope = { dimKey: 'ALL', dimType: 'all' }) {
  return {
    date_from: '2026-06-17',
    date_to: '2026-07-16',
    dim_key: scope.dimKey,
    dim_type: scope.dimType,
    metric: 'quantity' as const,
    points: [{ ma7: 12.5, ma30: 11.8, ma180: 10.2, missing: false, order_count: 12, period: '2026-07-16', quantity: 15, sales_amount: 390 }],
    product_key: productKey,
    product_name: productName,
  };
}


function revenueTrend(points: Array<Partial<{ ma7: number | null; ma30: number | null; ma180: number | null; net_income: number; order_count: number; period: string }>>, granularity: 'day' | 'week' | 'month' = 'day', storeKey = 'ALL') {
  return {
    date_from: points[0]?.period ?? '2026-06-17',
    date_to: points.at(-1)?.period ?? '2026-07-16',
    granularity,
    metric: 'net_income',
    moving_averages: [
      { available: points.some((point) => typeof point.ma7 === 'number'), available_periods: points.length, field: 'ma7', label: 'MA7', window: 7 },
      { available: points.some((point) => typeof point.ma30 === 'number'), available_periods: points.length, field: 'ma30', label: 'MA30', window: 30 },
      { available: points.some((point) => typeof point.ma180 === 'number'), available_periods: points.length, field: 'ma180', label: 'MA180', window: 180 },
    ],
    points: points.map((point) => ({
      ma7: point.ma7 ?? null,
      ma30: point.ma30 ?? null,
      ma180: point.ma180 ?? null,
      missing: false,
      net_income: point.net_income ?? 0,
      order_count: point.order_count ?? 0,
      period: point.period ?? '2026-06-17',
    })),
    source_type: 'all',
    store_key: storeKey,
  };
}

function emptyLaborTrend() {
  return {
    granularity: 'day',
    period: '2026-06-17_2026-07-16',
    points: [],
    store_key: 'ALL',
    store_label: '全部门店',
  };
}

function laborComparison() {
  return {
    data_status: 'ready',
    excluded_dates: [],
    granularity: 'day' as const,
    points: [],
    previous_period: { date_from: '2026-05-18', date_to: '2026-06-16' },
    summary: {
      actual_hours: 20, planned_hours: 22, net_revenue: 3800, headcount: 5,
      actual_revenue_per_hour: 190, planned_revenue_per_hour: 172.73,
      comparison: {
        actual_revenue_per_hour: { current: 190, previous: 158.33, difference: 31.67, change_rate: 0.2, status: 'comparable' },
      },
    },
  };
}

function orderOverview() {
  return {
    period: { date_from: '2026-07-16', date_to: '2026-07-16' },
    previous_period: { date_from: '2026-07-15', date_to: '2026-07-15' },
    metrics: {
      net_income: { current: 1200, previous: 1000, difference: 200, change_rate: 0.2, status: 'ok' },
    },
    channels: [],
    platforms: [],
    stores: [{ dim_key: 's-1', dim_label: '长安旗舰店', metrics: {
      net_income: { current: 1200, previous: 1000, difference: 200, change_rate: 0.2, status: 'ok' },
    } }],
    store_channels: [],
  };
}
