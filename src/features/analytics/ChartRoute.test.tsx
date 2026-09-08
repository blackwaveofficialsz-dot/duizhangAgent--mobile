import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChartRoute from '@/app/chart';
import { getLaborTrend, getMealPeriodTrend, getMealPeriodTurnover, getProductTrend, getRevenueTrend } from '@/services/api/analytics';
import { readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { shareChartWorkbook } from '@/services/files/shareChart';
import { useNetworkStore } from '@/services/network/networkStore';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { laborAnalyticsCacheKey, laborDashboardCacheScope, productAnalyticsCacheKey, serializeAnalyticsFilters } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';

const mockBack = jest.fn();
let mockParams: { cacheKey?: string; comparisonDateFrom?: string; comparisonDateTo?: string; comparisonMode?: string; dashboardCacheKey?: string; dateFrom?: string; dateTo?: string; departmentKeys?: string; dimKey?: string; dimType?: string; granularity?: string; includeCurrent?: string; laborMetric?: string; laborScopes?: string; periodKey?: string; productKey?: string; productScopes?: string; revenueMode?: string; scopeKeys?: string; scopeLabel?: string; selectedProductKeys?: string; sourceType?: string; storeKeys?: string; type?: string } = { revenueMode: 'net', type: 'revenue' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack }),
}));
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 6, PORTRAIT_UP: 2 },
  getOrientationLockAsync: jest.fn().mockResolvedValue(2),
  lockAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./analyticsStore', () => ({ useAnalyticsStore: jest.fn() }));
jest.mock('@/services/api/analytics', () => ({
  getMealPeriodTrend: jest.fn(),
  getMealPeriodTurnover: jest.fn(),
  getLaborTrend: jest.fn(),
  getProductTrend: jest.fn(),
  getRevenueTrend: jest.fn(),
}));
jest.mock('@/services/cache/offlineCache', () => ({
  readCachedAnalytics: jest.fn(),
  saveCachedAnalytics: jest.fn(),
}));
jest.mock('@/services/files/shareChart', () => ({
  ...jest.requireActual('@/services/files/shareChart'),
  shareChartWorkbook: jest.fn().mockResolvedValue(undefined),
}));

const safeAreaMetrics = {
  frame: { height: 390, width: 844, x: 0, y: 0 },
  insets: { bottom: 21, left: 0, right: 0, top: 0 },
};
const laborPortraitFilters = { dateFrom: '2026-06-29', dateTo: '2026-07-19', granularity: 'week' as const, includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['ALL'] };

function laborCacheContext(departmentKeys: string[] = [], comparisonMode: 'none' | 'previous' = 'previous', scopeKey = 'ALL::') {
  return { comparisonMode, departmentKeys, filters: serializeAnalyticsFilters(laborPortraitFilters), scopeKey };
}

function laborTrendCacheKey(metric: 'efficiency' | 'hours', departmentKeys: string[] = [], comparisonMode: 'none' | 'previous' = 'previous') {
  return laborAnalyticsCacheKey(laborPortraitFilters, metric, departmentKeys, comparisonMode);
}

function laborPortraitDashboardCacheKey(comparisonMode: 'none' | 'previous' = 'previous') {
  return laborDashboardCacheScope(laborPortraitFilters, 'ALL::', comparisonMode);
}

const revenuePoint = { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false };
const setFilters = jest.fn();
const setDashboardFilters = jest.fn();
const setLaborFilters = jest.fn();
const refresh = jest.fn();

describe('ChartRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { revenueMode: 'net', type: 'revenue' };
    useInsightDetailStore.setState({
      isReadOnly: false,
      labor: null,
      order: null,
      product: { order_count: 110, product_key: 'p-1', product_name: '虾仁鲜肉小馄饨', quantity: 141, sales_amount: 4820, sales_share: 0.12 },
      productScope: null,
      productTrend: null,
    });
    useNetworkStore.setState({ status: 'online' });
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);
    jest.mocked(saveCachedAnalytics).mockResolvedValue(undefined);
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
    jest.mocked(useAnalyticsStore).mockReturnValue({
      data: {
        mealPeriods: { business_date: '2026-07-16', periods: [], store_key: 'ALL' },
        mealTrend: { date_from: '2026-06-17', date_to: '2026-07-16', points: [], store_key: 'ALL' },
        revenue: { date_from: '2026-06-17', date_to: '2026-07-16', points: [revenuePoint], store_key: 'ALL' },
        revenueSources: {
          shop: { date_from: '2026-06-17', date_to: '2026-07-16', points: [revenuePoint], store_key: 'ALL' },
          takeout: { date_from: '2026-06-17', date_to: '2026-07-16', points: [revenuePoint], store_key: 'ALL' },
        },
        turnover: { data_status: 'ok', eligible_store_count: 2, points: [], summary: [], table_count: 18 },
      },
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      laborFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      refresh,
      setDashboardFilters,
      setFilters,
      setLaborFilters,
      stores: [{ key: '101', label: '茅坡店' }],
    } as never);
    jest.mocked(getRevenueTrend).mockImplementation(async (filters) => ({
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      points: [{ ...revenuePoint, net_income: filters.sourceType === 'shop' ? 1100 : 700 }],
      source_type: filters.sourceType,
      store_key: filters.storeKey,
    }));
    jest.mocked(getMealPeriodTrend).mockResolvedValue({ date_from: '2026-06-17', date_to: '2026-07-16', points: [], store_key: 'ALL' } as never);
    jest.mocked(getMealPeriodTurnover).mockResolvedValue({
      data_status: 'ok', eligible_store_count: 2, table_count: 18,
      points: [{ date: '2026-07-16', lunch: { ma7: 1.4, ma30: 1.3, ma180: 1.2, shop_order_count: 30, turnover: 1.67 } }],
      summary: [{ avg_daily_turnover: 1.67, period_key: 'lunch', period_label: '午餐', shop_order_count: 30 }],
    } as never);
    jest.mocked(getLaborTrend).mockResolvedValue({
      granularity: 'day',
      period: '2026-06-17_2026-07-16',
      points: [laborTrendPoint],
      store_key: 'ALL',
      store_label: '全部门店',
    });
    jest.mocked(getProductTrend).mockResolvedValue({
      date_from: '2026-06-17',
      date_to: '2026-07-16',
      dim_key: 'takeout',
      dim_type: 'channel',
      metric: 'quantity',
      points: [{ ma7: 136.5, ma30: 134, ma180: 130, missing: false, order_count: 110, period: '2026-07-16', quantity: 141, sales_amount: 4820 }],
      product_key: 'p-1',
      product_name: '虾仁鲜肉小馄饨',
    });
  });

  it('loads both revenue sources and keeps filtering inside the landscape route', async () => {
    mockParams = { revenueMode: 'sources', type: 'revenue' };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getRevenueTrend).toHaveBeenCalledTimes(2));
    expect(screen.getByText('堂食/外卖净实收趋势')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    expect(screen.getByTestId('fullscreen-filter-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '近10日' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择门店 茅坡店' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 茅坡店' }));
    await fireEvent.press(screen.getByRole('button', { name: '应用图表筛选' }));
    expect(setDashboardFilters).toHaveBeenCalledWith(expect.objectContaining({ storeKey: '101', storeKeys: ['101'] }));

    await fireEvent.press(screen.getByRole('button', { name: '关闭全屏趋势' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('loads one aggregate revenue result for the net mode', async () => {
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getRevenueTrend).toHaveBeenCalledTimes(1));
    expect(screen.getByText('净实收趋势')).toBeTruthy();
  });

  it('exports a dashboard comparison period passed as stable route identifiers', async () => {
    mockParams = {
      comparisonDateFrom: '2026-07-13',
      comparisonDateTo: '2026-07-19',
      comparisonMode: 'previous',
      revenueMode: 'net',
      type: 'revenue',
    };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getRevenueTrend).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole('button', { name: /导出净实收趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));

    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      previousPeriod: { date_from: '2026-07-13', date_to: '2026-07-19' },
    })));
  });

  it('reuses the current same-filter dashboard data without another request', async () => {
    const dashboardFilters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['ALL'] };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      data: {
        mealPeriods: { business_date: '2026-07-16', periods: [], store_key: 'ALL' },
        mealTrend: { date_from: '2026-06-17', date_to: '2026-07-16', points: [], store_key: 'ALL' },
        revenue: { date_from: '2026-06-17', date_to: '2026-07-16', points: [revenuePoint], store_key: 'ALL' },
        revenueSources: {
          shop: { date_from: '2026-06-17', date_to: '2026-07-16', points: [{ ...revenuePoint, net_income: 1100 }], store_key: 'ALL' },
          takeout: { date_from: '2026-06-17', date_to: '2026-07-16', points: [{ ...revenuePoint, net_income: 700 }], store_key: 'ALL' },
        },
        turnover: { data_status: 'ok', eligible_store_count: 2, points: [], summary: [], table_count: 18 },
      },
      dataFilterKey: serializeAnalyticsFilters(dashboardFilters),
      dataSource: 'offline-cache',
      dashboardFilters,
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      laborFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      refresh,
      setDashboardFilters,
      setFilters,
      setLaborFilters,
      stores: [{ key: '101', label: '茅坡店' }],
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByText('区间净实收 1,800.00 · 1 天')).toBeTruthy());
    expect(getRevenueTrend).not.toHaveBeenCalled();
  });

  it('does not reuse dashboard data loaded for a previous filter', async () => {
    const currentFilters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['ALL'] };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      data: {
        mealPeriods: { business_date: '2026-07-10', periods: [], store_key: 'ALL' },
        mealTrend: { date_from: '2026-06-10', date_to: '2026-07-10', points: [], store_key: 'ALL' },
        revenue: { date_from: '2026-06-10', date_to: '2026-07-10', points: [{ ...revenuePoint, net_income: 99 }], store_key: 'ALL' },
        revenueSources: {
          shop: { date_from: '2026-06-10', date_to: '2026-07-10', points: [], store_key: 'ALL' },
          takeout: { date_from: '2026-06-10', date_to: '2026-07-10', points: [], store_key: 'ALL' },
        },
        turnover: { data_status: 'ok', eligible_store_count: 2, points: [], summary: [], table_count: 18 },
      },
      dataFilterKey: serializeAnalyticsFilters({ ...currentFilters, dateTo: '2026-07-10' }),
      dataSource: 'network',
      dashboardFilters: currentFilters,
      filters: currentFilters,
      refresh,
      setDashboardFilters,
      setFilters,
      stores: [{ key: '101', label: '茅坡店' }],
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getRevenueTrend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('区间净实收 700.00 · 1 天')).toBeTruthy());
  });

  it('loads the real meal-period trend for the shared fullscreen chart', async () => {
    mockParams = { periodKey: 'lunch', type: 'meal-business' };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getMealPeriodTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-06-17', dateTo: '2026-07-16' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(screen.getByText('餐段经营趋势')).toBeTruthy();
  });

  it('keeps department and store scopes as two business lines in landscape', async () => {
    mockParams = { periodKey: 'lunch', type: 'meal-business' };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', scopeKeys: ['dept:business-1', 'shop:201'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['101', '102', '201'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', scopeKeys: ['dept:business-1', 'shop:201'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['101', '102', '201'] },
      refresh,
      setDashboardFilters,
      setFilters,
      scopeTree: [{
        children: [
          { key: 'shop:101', label: '茅坡店', store_key: '101', type: 'store' },
          { key: 'shop:102', label: '凤十二店', store_key: '102', type: 'store' },
        ],
        key: 'dept:business-1',
        label: '事业一部',
        type: 'department',
      }, { key: 'shop:201', label: '南坪店', store_key: '201', type: 'store' }],
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }, { key: '201', label: '南坪店' }],
    } as never);
    jest.mocked(getMealPeriodTrend).mockResolvedValue({
      date_from: '2026-06-17',
      date_to: '2026-07-16',
      points: [],
      store_key: 'MULTI',
      store_trends: {
        '101': [mealTrendPoint('2026-07-16', 1000, 80)],
        '102': [mealTrendPoint('2026-07-16', 800, 60)],
        '201': [mealTrendPoint('2026-07-16', 700, 50)],
      },
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getAllByText('事业一部').length).toBeGreaterThan(1));
    expect(screen.getAllByText('南坪店').length).toBeGreaterThan(1);
  });

  it('loads turnover points from the existing turnover endpoint', async () => {
    mockParams = { periodKey: 'lunch', type: 'meal-turnover' };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getMealPeriodTurnover).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-06-17', dateTo: '2026-07-16' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(screen.getByText('餐段翻台率趋势')).toBeTruthy();
    expect(await screen.findByText('有效 2 家门店 · 桌台总数 18 张 · 排除 0 家门店')).toBeTruthy();
  });

  it('keeps the turnover chart empty when every selected store is excluded', async () => {
    mockParams = { periodKey: 'lunch', type: 'meal-turnover' };
    jest.mocked(getMealPeriodTurnover).mockResolvedValue({
      data_status: 'missing',
      eligible_store_count: 0,
      excluded_stores: [{ reason: '缺少桌台数', store_key: '101', store_label: '茅坡店' }],
      table_count: 0,
      points: [{ date: '2026-07-16', lunch: { ma7: 1.4, ma30: 1.3, ma180: 1.2, shop_order_count: 30, turnover: 1.67 } }],
      summary: [],
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    expect(await screen.findByText('有效 0 家门店 · 桌台总数 0 张 · 排除 1 家门店')).toBeTruthy();
    expect(screen.getByText('当前筛选暂无趋势数据')).toBeTruthy();
  });

  it('keeps department and store turnover scopes as recalculated lines in landscape', async () => {
    mockParams = { periodKey: 'lunch', type: 'meal-turnover' };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', scopeKeys: ['dept:business-1', 'shop:201'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['101', '102', '201'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', scopeKeys: ['dept:business-1', 'shop:201'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['101', '102', '201'] },
      refresh,
      setDashboardFilters,
      setFilters,
      scopeTree: [{
        children: [
          { key: 'shop:101', label: '茅坡店', store_key: '101', type: 'store' },
          { key: 'shop:102', label: '凤十二店', store_key: '102', type: 'store' },
        ],
        key: 'dept:business-1',
        label: '事业一部',
        type: 'department',
      }, { key: 'shop:201', label: '南坪店', store_key: '201', type: 'store' }],
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }, { key: '201', label: '南坪店' }],
    } as never);
    jest.mocked(getMealPeriodTurnover).mockResolvedValue({
      data_status: 'ok',
      eligible_store_count: 2,
      table_count: 22,
      points: [],
      summary: [],
      store_summaries: [
        { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] },
        { store_key: '102', store_label: '凤十二店', table_count: 0, summary: [] },
        { store_key: '201', store_label: '南坪店', table_count: 12, summary: [] },
      ],
      store_trends: {
        '101': [turnoverTrendPoint('2026-07-16', 100)],
        '102': [turnoverTrendPoint('2026-07-16', 500)],
        '201': [turnoverTrendPoint('2026-07-16', 36)],
      },
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getAllByText('事业一部').length).toBeGreaterThan(1));
    expect(screen.getAllByText('南坪店').length).toBeGreaterThan(1);
    expect(screen.getByText(/10.00 次\/桌/)).toBeTruthy();
    expect(screen.getByText(/3.00 次\/桌/)).toBeTruthy();
  });

  it.each([
    ['labor-hours', '工时趋势', 'labor-hours-chart-side-detail'],
    ['labor-efficiency', '人效趋势', 'labor-efficiency-chart-side-detail'],
  ])('loads %s in landscape with detail on the right', async (type, title, detailTestID) => {
    mockParams = { type };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getLaborTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-06-17', dateTo: '2026-07-16' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByTestId(detailTestID)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    expect(screen.getByRole('button', { name: '选择门店 茅坡店' })).toBeTruthy();
    expect(screen.queryByText('餐段指标')).toBeNull();
    expect(screen.queryByText('营收图表')).toBeNull();
  });

  it('uses labor navigation filters, department keys, dynamic averages, export, and module filter persistence', async () => {
    mockParams = {
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      departmentKeys: 'dept-1',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      scopeKeys: 'dept:business-1',
      sourceType: 'all',
      storeKeys: '801,802',
      type: 'labor-hours',
    };
    jest.mocked(getLaborTrend).mockResolvedValueOnce({
      date_from: '2026-06-29',
      date_to: '2026-07-19',
      granularity: 'week',
      moving_averages: [
        { available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 },
        { available: true, available_periods: 5, field: 'planned_hours_ma4', label: 'MA4', window: 4 },
      ],
      period: '2026-06-29_2026-07-19',
      points: [{ ...laborTrendPoint, actual_hours_ma4: 9.5, period: '2026-W28', period_end: '2026-07-12', period_start: '2026-07-06', planned_hours_ma4: 11.5 }],
      store_key: 'MULTI',
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getLaborTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-06-29', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false, sourceType: 'all', storeKey: 'ALL', storeKeys: ['801', '802'] }),
      expect.objectContaining({ granularity: 'week', includeCurrent: false, signal: expect.any(AbortSignal), storeKeys: ['dept-1'] }),
    ));
    expect(screen.getByText(/按周/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 实际 MA4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /导出工时趋势/ })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    await fireEvent.press(screen.getByRole('button', { name: '应用图表筛选' }));
    expect(setLaborFilters).toHaveBeenCalledWith(expect.objectContaining({ granularity: 'week' }));
  });

  it('keeps explicit labor ranges as comparison lines in landscape', async () => {
    mockParams = {
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '111,112', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', scopeKeys: 'shop:801,shop:803', type: 'labor-hours',
    };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      hiddenSeriesByChart: {},
      laborFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'week', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      scopeTree: [{ key: 'dept:ops', label: '运营部', type: 'department', children: [
        { department_id: '111', key: 'shop:801', label: '北大街', store_key: '801', type: 'store' },
        { department_id: '112', key: 'shop:803', label: '科技路', store_key: '803', type: 'store' },
      ] }],
      selectedPeriodByChart: {},
      setLaborFilters,
      stores: [],
    } as never);
    jest.mocked(getLaborTrend).mockResolvedValueOnce({
      granularity: 'week',
      period: '2026-06-29_2026-07-19',
      points: [{ ...laborTrendPoint, actual_hours: 30, net_revenue: 4000, period: '2026-W29', planned_hours: 33 }],
      store_key: 'MULTI',
      store_trends: {
        '111': [{ ...laborTrendPoint, actual_hours: 10, net_revenue: 1000, period: '2026-W29', planned_hours: 11 }],
        '112': [{ ...laborTrendPoint, actual_hours: 20, net_revenue: 3000, period: '2026-W29', planned_hours: 22 }],
      },
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: '隐藏 北大街 实际' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '隐藏 科技路 排班' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '隐藏 实际 MA4' })).toBeNull();
    expect(screen.getByTestId('labor-hours-chart-side-detail')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      comparisonSummaryRows: undefined,
      extraColumns: undefined,
      series: expect.arrayContaining([
        expect.objectContaining({ id: 'scope:shop:801:actual', label: '北大街 实际' }),
        expect.objectContaining({ id: 'scope:shop:803:planned', label: '科技路 排班' }),
        expect.objectContaining({ label: '北大街 净实收' }),
        expect.objectContaining({ label: '科技路 人数' }),
      ]),
    })));
  });

  it('restores the exact labor trend cache while offline without requesting the server', async () => {
    const filters = { ...laborPortraitFilters, storeKey: '801', storeKeys: ['801'] };
    const cacheKey = laborAnalyticsCacheKey(filters, 'efficiency', ['dept-1'], 'previous');
    mockParams = {
      cacheKey, dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: 'dept-1', granularity: 'week', includeCurrent: 'false', laborMetric: 'efficiency', sourceType: 'all', storeKeys: '801', type: 'labor-efficiency',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockResolvedValueOnce({
      data: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: 'dept-1' },
      lastSyncedAt: Date.now(),
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith('laborTrend', cacheKey, expect.any(Number)));
    expect(getLaborTrend).not.toHaveBeenCalled();
    expect(screen.getByTestId('labor-efficiency-chart-side-detail')).toBeTruthy();
  });

  it.each(['labor-dashboard-v3', 'labor-dashboard-v4'])('treats a legacy %s labor trend scope as a cache miss while offline', async (legacyPrefix) => {
    const legacyCacheKey = `${legacyPrefix}:exact-navigation-cache-key`;
    mockParams = {
      cacheKey: legacyCacheKey, dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: 'dept-1', granularity: 'week', includeCurrent: 'false', laborMetric: 'efficiency', sourceType: 'all', storeKeys: '801', type: 'labor-efficiency',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (_module, scope) => scope === legacyCacheKey ? {
      data: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: 'dept-1' },
      lastSyncedAt: Date.now(),
    } as never : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByText('离线状态下暂无同条件人效趋势')).toBeTruthy());
    expect(readCachedAnalytics).not.toHaveBeenCalledWith('laborTrend', legacyCacheKey, expect.any(Number));
  });

  it('rejects a same-version labor trend cache key from another store scope while offline', async () => {
    const activeFilters = { ...laborPortraitFilters, storeKey: '801', storeKeys: ['801'] };
    const foreignCacheKey = laborAnalyticsCacheKey({ ...activeFilters, storeKey: '802', storeKeys: ['802'] }, 'efficiency', ['dept-1'], 'previous');
    mockParams = {
      cacheKey: foreignCacheKey,
      dateFrom: activeFilters.dateFrom,
      dateTo: activeFilters.dateTo,
      departmentKeys: 'dept-1',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'efficiency',
      sourceType: 'all',
      storeKeys: '801',
      type: 'labor-efficiency',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (_module, scope) => scope === foreignCacheKey ? {
      data: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: 'dept-1' },
      lastSyncedAt: Date.now(),
    } as never : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByText('离线状态下暂无同条件人效趋势')).toBeTruthy());
    expect(readCachedAnalytics).not.toHaveBeenCalledWith('laborTrend', foreignCacheKey, expect.any(Number));
  });

  it('falls back to the portrait labor dashboard cache while offline', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours'),
      dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(),
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: 'ALL' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith('labor', laborPortraitDashboardCacheKey(), expect.any(Number)));
    expect(getLaborTrend).not.toHaveBeenCalled();
    expect(screen.getByTestId('labor-hours-chart-side-detail')).toBeTruthy();
  });

  it('prefers a matching portrait comparison over the labor trend cache while offline', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111']),
      dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      departmentKeys: '111',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => {
      if (category === 'laborTrend') return {
        data: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
        lastSyncedAt: Date.now(),
      } as never;
      if (category === 'labor') return {
        data: {
          cacheContext: laborCacheContext(['111']),
          comparison: {
            data_status: 'ready',
            excluded_dates: ['2026-07-13'],
            granularity: 'week',
            points: [],
            previous_period: { date_from: '2026-06-08', date_to: '2026-06-28' },
            summary: {
              actual_hours: 30,
              planned_hours: 33,
              net_revenue: 4000,
              headcount: 3,
              actual_revenue_per_hour: 133.33,
              planned_revenue_per_hour: 121.21,
              comparison: {
                actual_hours: { current: 30, previous: 27, difference: 3, change_rate: 0.1111, status: 'comparable' },
                planned_hours: { current: 33, previous: 30, difference: 3, change_rate: 0.1, status: 'comparable' },
              },
            },
          },
          summary: { rows: [] },
          trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
        },
        lastSyncedAt: Date.now(),
      } as never;
      return null;
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith('labor', laborPortraitDashboardCacheKey(), expect.any(Number)));
    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      comparisonSummaryRows: [
        { 统计范围: '统计区间汇总', 指标: '实际工时', 本期: 30, 上期: 27, 差额: 3, 变动率: 0.1111 },
        { 统计范围: '统计区间汇总', 指标: '排班工时', 本期: 33, 上期: 30, 差额: 3, 变动率: 0.1 },
      ],
      excludedDates: ['2026-07-13'],
      previousPeriod: { date_from: '2026-06-08', date_to: '2026-06-28' },
    })));
    expect(getLaborTrend).not.toHaveBeenCalled();
  });

  it('rejects an ALL-scope portrait cache when URL overrides department keys', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111', '112']),
      dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      departmentKeys: '111,112',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      scopeKeys: 'ALL',
      type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(),
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: 'ALL' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith('labor', laborPortraitDashboardCacheKey(), expect.any(Number)));
    expect(getLaborTrend).not.toHaveBeenCalled();
    expect(screen.getByText('离线状态下暂无同条件人效趋势')).toBeTruthy();
  });

  it('exports a cached labor comparison in a dedicated summary sheet', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111']),
      dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      departmentKeys: '111',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(['111']),
            comparison: {
              data_status: 'ready',
              excluded_dates: ['2026-07-13'],
              granularity: 'week',
              points: [],
              previous_period: { date_from: '2026-06-08', date_to: '2026-06-28' },
              summary: {
                actual_hours: 30, planned_hours: 33, net_revenue: 4000, headcount: 3,
                actual_revenue_per_hour: 133.33, planned_revenue_per_hour: 121.21,
                comparison: {
                  actual_hours: { current: 30, previous: 27, difference: 3, change_rate: 0.1111, status: 'comparable' },
                  planned_hours: { current: 33, previous: 30, difference: 3, change_rate: 0.1, status: 'comparable' },
                },
              },
            },
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      comparisonSummaryRows: [
        { 统计范围: '统计区间汇总', 指标: '实际工时', 本期: 30, 上期: 27, 差额: 3, 变动率: 0.1111 },
        { 统计范围: '统计区间汇总', 指标: '排班工时', 本期: 33, 上期: 30, 差额: 3, 变动率: 0.1 },
      ],
      excludedDates: ['2026-07-13'],
      extraColumns: [{ field: 'headcount', label: '人数' }],
      previousPeriod: { date_from: '2026-06-08', date_to: '2026-06-28' },
      series: expect.arrayContaining([expect.objectContaining({
        points: [expect.not.objectContaining({ actual_hours_current: 30 })],
      })]),
    })));
  });

  it('retains validated portrait comparison while refreshing the fullscreen trend online', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111']), dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '111', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', type: 'labor-hours',
    };
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(['111']),
            comparison: {
              data_status: 'ready', excluded_dates: ['2026-07-13'], granularity: 'week', points: [],
              previous_period: { date_from: '2026-06-08', date_to: '2026-06-28' },
              summary: { actual_hours: 30, planned_hours: 33, net_revenue: 4000, headcount: 3, actual_revenue_per_hour: 133.33, planned_revenue_per_hour: 121.21, comparison: {} },
            },
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getLaborTrend).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      excludedDates: ['2026-07-13'],
      previousPeriod: { date_from: '2026-06-08', date_to: '2026-06-28' },
    })));
  });

  it('does not export stale portrait comparison when fullscreen comparison is disabled', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111'], 'none'), comparisonMode: 'none', dashboardCacheKey: laborPortraitDashboardCacheKey('none'),
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '111', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(['111'], 'none'),
            comparison: {
              data_status: 'ready', excluded_dates: ['2026-07-13'], granularity: 'week', points: [],
              previous_period: { date_from: '2026-06-08', date_to: '2026-06-28' },
              summary: { actual_hours: 30, planned_hours: 33, net_revenue: 4000, headcount: 3, actual_revenue_per_hour: 133.33, planned_revenue_per_hour: 121.21, comparison: {} },
            },
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalled());
    const input = jest.mocked(shareChartWorkbook).mock.calls.at(-1)?.[0];
    expect(input?.comparisonSummaryRows).toBeUndefined();
    expect(input?.excludedDates).toBeUndefined();
    expect(input?.previousPeriod).toBeUndefined();
  });

  it.each(['online', 'offline'] as const)('does not reuse a same-period portrait cache from another department while %s', async (network) => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['112']), dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '112', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', type: 'labor-hours',
    };
    useNetworkStore.setState({ status: network });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            cacheContext: laborCacheContext(['111']),
            comparison: {
              data_status: 'ready', excluded_dates: ['2026-07-13'], granularity: 'week', points: [],
              previous_period: { date_from: '2026-06-08', date_to: '2026-06-28' },
              summary: { actual_hours: 30, planned_hours: 33, net_revenue: 4000, headcount: 3, actual_revenue_per_hour: 133.33, planned_revenue_per_hour: 121.21, comparison: {} },
            },
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    if (network === 'offline') {
      await waitFor(() => expect(screen.getByText('离线状态下暂无同条件人效趋势')).toBeTruthy());
      expect(getLaborTrend).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(getLaborTrend).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: /导出工时趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalled());
    const input = jest.mocked(shareChartWorkbook).mock.calls.at(-1)?.[0];
    expect(input?.comparisonSummaryRows).toBeUndefined();
    expect(input?.excludedDates).toBeUndefined();
    expect(input?.previousPeriod).toBeUndefined();
  });

  it('rejects a legacy portrait cache without cache context while offline', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111']), dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '111', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', type: 'labor-hours',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (category) => category === 'labor'
      ? {
          data: {
            comparison: {
              data_status: 'ready', excluded_dates: [], granularity: 'week', points: [], previous_period: null,
              summary: { actual_hours: 30, planned_hours: 33, net_revenue: 4000, headcount: 3, actual_revenue_per_hour: 133.33, planned_revenue_per_hour: 121.21, comparison: {} },
            },
            summary: { rows: [] },
            trend: { granularity: 'week', period: '2026-06-29_2026-07-19', points: [{ ...laborTrendPoint, period: '2026-W28' }], store_key: '111' },
          },
          lastSyncedAt: Date.now(),
        } as never
      : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByText('离线状态下暂无同条件人效趋势')).toBeTruthy());
  });

  it('drops the incoming portrait cache key after changing fullscreen labor filters', async () => {
    mockParams = {
      cacheKey: laborTrendCacheKey('hours', ['111']), dashboardCacheKey: laborPortraitDashboardCacheKey(),
      dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: '111', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours', type: 'labor-hours',
    };
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getLaborTrend).toHaveBeenCalledTimes(1));
    jest.mocked(readCachedAnalytics).mockClear();
    await fireEvent.press(screen.getByRole('button', { name: '修改图表筛选' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 茅坡店' }));
    await fireEvent.press(screen.getByRole('button', { name: '应用图表筛选' }));
    await waitFor(() => expect(getLaborTrend).toHaveBeenCalledTimes(2));
    expect(readCachedAnalytics).not.toHaveBeenCalled();
  });

  it('restores explicit labor comparison scopes from a cold-start deep link', async () => {
    mockParams = {
      dateFrom: '2026-06-29',
      dateTo: '2026-07-19',
      departmentKeys: '111,112',
      granularity: 'week',
      includeCurrent: 'false',
      laborMetric: 'hours',
      laborScopes: JSON.stringify([
        { departmentKeys: ['111'], key: 'shop:801', label: '北大街', storeKeys: ['801'], type: 'store' },
        { departmentKeys: ['112'], key: 'shop:803', label: '科技路', storeKeys: ['803'], type: 'store' },
      ]),
      scopeKeys: 'shop:801,shop:803',
      scopeLabel: '北大街 · 科技路',
      storeKeys: '801,803',
      type: 'labor-hours',
    };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      hiddenSeriesByChart: {},
      laborFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'week', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      scopeTree: [],
      selectedPeriodByChart: {},
      setLaborFilters,
      stores: [],
    } as never);
    jest.mocked(getLaborTrend).mockResolvedValueOnce({
      granularity: 'week',
      period: '2026-06-29_2026-07-19',
      points: [{ ...laborTrendPoint, actual_hours: 30, net_revenue: 4000, period: '2026-W29', planned_hours: 33 }],
      store_key: 'MULTI',
      store_trends: {
        '111': [{ ...laborTrendPoint, actual_hours: 10, net_revenue: 1000, period: '2026-W29', planned_hours: 11 }],
        '112': [{ ...laborTrendPoint, actual_hours: 20, net_revenue: 3000, period: '2026-W29', planned_hours: 22 }],
      },
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: '隐藏 北大街 实际' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '隐藏 科技路 排班' })).toBeTruthy();
    expect(screen.getAllByText(/北大街 · 科技路/).length).toBeGreaterThan(0);
  });

  it('opens a labor chart from laborMetric when type is absent', async () => {
    mockParams = { dateFrom: '2026-06-29', dateTo: '2026-07-19', departmentKeys: 'dept-1', granularity: 'week', includeCurrent: 'false', laborMetric: 'hours' };

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getLaborTrend).toHaveBeenCalled());
    expect(screen.getByText('工时趋势')).toBeTruthy();
  });

  it('does not count or render an unsynced labor date in fullscreen', async () => {
    mockParams = { type: 'labor-hours' };
    jest.mocked(getLaborTrend).mockResolvedValue({
      granularity: 'day',
      period: '2026-06-17_2026-07-16',
      points: [
        laborTrendPoint,
        { ...laborTrendPoint, actual_hours: 2, hours_synced: false, period: '2026-07-17' },
      ],
      store_key: 'ALL',
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    expect(await screen.findByText(/全部门店 · 1 天/)).toBeTruthy();
    expect(screen.queryByTestId('labor-hours-chart-point-2026-07-17')).toBeNull();
  });

  it('restores the selected product key from the analytics store when fullscreen has no explicit product key', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', type: 'product' };
    useInsightDetailStore.setState({ product: null, productTrend: null });
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      productFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      selectedProductKeys: ['p-2', 'p-1'],
      stores: [],
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-2', expect.anything(), expect.anything()));
    expect(screen.getByText('多产品销量趋势')).toBeTruthy();
  });

  it('keeps URL selected products when the normal fullscreen entry also provides a detail product key', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', productKey: 'p-1', selectedProductKeys: 'p-1,p-2', type: 'product' };
    jest.mocked(getProductTrend).mockImplementation(async (key) => ({
      date_from: '2026-06-17', date_to: '2026-07-16', dim_key: 'takeout', dim_type: 'channel', metric: 'quantity', points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 2, period: '2026-07-16', quantity: 3, sales_amount: 90 }], product_key: key, product_name: key === 'p-1' ? '招牌牛肉面' : '鲜肉馄饨',
    }));

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-2', expect.anything(), expect.anything()));
    expect(screen.getByRole('button', { name: '隐藏 招牌牛肉面' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 鲜肉馄饨' })).toBeTruthy();
  });

  it('uses a URL product key ahead of stale store multi-selection', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', productKey: 'p-3', type: 'product' };
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      productFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      selectedProductKeys: ['p-1', 'p-2'],
      stores: [],
    } as never);
    jest.mocked(getProductTrend).mockResolvedValueOnce({
      date_from: '2026-06-17', date_to: '2026-07-16', dim_key: 'takeout', dim_type: 'channel', metric: 'quantity', points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 2, period: '2026-07-16', quantity: 3, sales_amount: 90 }], product_key: 'p-3', product_name: '红油抄手',
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-3', expect.anything(), expect.anything()));
    expect(getProductTrend).not.toHaveBeenCalledWith('p-1', expect.anything(), expect.anything());
    expect(getProductTrend).not.toHaveBeenCalledWith('p-2', expect.anything(), expect.anything());
    expect(screen.getByText(/红油抄手/)).toBeTruthy();
  });

  it('restores all v4 cached trends before falling back to the detail-store trend', async () => {
    const filters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day' as const, includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['ALL'] };
    mockParams = {
      cacheKey: productAnalyticsCacheKey(filters, { dimKey: 'takeout', dimType: 'channel' }, ['p-1', 'p-2'], 'previous'),
      dimKey: 'takeout',
      dimType: 'channel',
      productKey: 'p-1',
      selectedProductKeys: 'p-1,p-2',
      type: 'product',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      productFilters: filters,
      selectedProductKeys: [],
      stores: [],
    } as never);
    useInsightDetailStore.setState({ productTrend: { date_from: '2026-06-17', date_to: '2026-07-16', dim_key: 'takeout', dim_type: 'channel', metric: 'quantity', points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 1, period: '2026-07-16', quantity: 1, sales_amount: 30 }], product_key: 'p-1', product_name: '详情缓存产品' } });
    jest.mocked(readCachedAnalytics).mockResolvedValueOnce({
      data: {
        selectedProductKeys: ['p-1', 'p-2'],
        trends: {
          'p-1': { date_from: '2026-06-17', date_to: '2026-07-16', dim_key: 'takeout', dim_type: 'channel', metric: 'quantity', points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 2, period: '2026-07-16', quantity: 3, sales_amount: 90 }], product_key: 'p-1', product_name: '招牌牛肉面' },
          'p-2': { date_from: '2026-06-17', date_to: '2026-07-16', dim_key: 'takeout', dim_type: 'channel', metric: 'quantity', points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 2, period: '2026-07-16', quantity: 4, sales_amount: 120 }], product_key: 'p-2', product_name: '鲜肉馄饨' },
        },
      },
      lastSyncedAt: Date.now(),
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: '隐藏 招牌牛肉面' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '隐藏 鲜肉馄饨' })).toBeTruthy();
    expect(getProductTrend).not.toHaveBeenCalled();
  });

  it('rejects a same-version product cache key from another store scope while offline', async () => {
    const activeFilters = { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'day' as const, includeCurrent: false, sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['ALL'] };
    const foreignCacheKey = productAnalyticsCacheKey({ ...activeFilters, storeKey: '101', storeKeys: ['101'] }, { dimKey: 'takeout', dimType: 'channel' }, ['p-1'], 'previous');
    mockParams = {
      cacheKey: foreignCacheKey,
      dateFrom: activeFilters.dateFrom,
      dateTo: activeFilters.dateTo,
      dimKey: 'takeout',
      dimType: 'channel',
      granularity: 'day',
      includeCurrent: 'false',
      productKey: 'p-1',
      selectedProductKeys: 'p-1',
      sourceType: 'all',
      storeKeys: 'ALL',
      type: 'product',
    };
    useNetworkStore.setState({ status: 'offline' });
    jest.mocked(readCachedAnalytics).mockImplementation(async (_module, scope) => scope === foreignCacheKey ? {
      data: {
        selectedProductKeys: ['p-1'],
        trends: {
          'p-1': {
            date_from: activeFilters.dateFrom,
            date_to: activeFilters.dateTo,
            dim_key: 'takeout',
            dim_type: 'channel',
            granularity: 'day',
            metric: 'quantity',
            points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 8, period: '2026-07-16', quantity: 10, sales_amount: 260 }],
            product_key: 'p-1',
            product_name: '错误范围产品',
          },
        },
      },
      lastSyncedAt: Date.now(),
    } as never : null);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(screen.getByText('离线状态下暂无已加载趋势')).toBeTruthy());
    expect(readCachedAnalytics).not.toHaveBeenCalledWith('products', foreignCacheKey, expect.any(Number));
  });

  it('exports a product comparison period passed as stable route identifiers', async () => {
    mockParams = {
      comparisonDateFrom: '2026-06-10',
      comparisonDateTo: '2026-06-16',
      comparisonMode: 'previous',
      dimKey: 'takeout',
      dimType: 'channel',
      productKey: 'p-1',
      selectedProductKeys: 'p-1',
      type: 'product',
    };
    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-1', expect.anything(), expect.anything()));
    await fireEvent.press(screen.getByRole('button', { name: /导出单品销量趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));

    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      previousPeriod: { date_from: '2026-06-10', date_to: '2026-06-16' },
    })));
  });

  it('loads the selected product trend with a fixed right-side detail column', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', type: 'product' };
    jest.mocked(getProductTrend).mockResolvedValueOnce({
      date_from: '2026-06-17',
      date_to: '2026-07-16',
      dim_key: 'takeout',
      dim_type: 'channel',
      metric: 'quantity',
      moving_averages: [{ available: true, available_periods: 1, field: 'ma7', label: 'MA7', window: 7 }],
      points: [
        { ma7: 120, ma30: 118, ma180: 115, missing: false, order_count: 90, period: '2026-W27', period_start: '2026-06-29', period_end: '2026-07-05', quantity: 125, sales_amount: 4200 },
        { ma7: 136.5, ma30: 134, ma180: 130, missing: false, order_count: 110, period: '2026-W28', period_start: '2026-07-06', period_end: '2026-07-12', quantity: 141, sales_amount: 4820 },
      ],
      product_key: 'p-1',
      product_name: '虾仁鲜肉小馄饨',
    });
    jest.mocked(useAnalyticsStore).mockReturnValue({
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      hiddenSeriesByChart: {},
      productFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'week', includeCurrent: false, scopeKeys: ['ALL'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      refresh,
      setDashboardFilters,
      setFilters,
      setSelectedChartPeriod: jest.fn(),
      setSelectedChartSelection: jest.fn(),
      selectedPeriodByChart: { 'product:trend': '2026-W27' },
      selectedSeriesByChart: { 'product:trend': 'product:ma7' },
      scopeTree: [],
      stores: [{ key: '101', label: '茅坡店' }],
      syncSeriesVisibility: jest.fn(),
      toggleSeriesVisibility: jest.fn(),
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ dateFrom: '2026-06-17', dateTo: '2026-07-16', granularity: 'week' }),
      expect.objectContaining({ dimKey: 'takeout', dimType: 'channel', signal: expect.any(AbortSignal) }),
    ));
    expect(screen.getByText('单品销量趋势')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出单品销量趋势-全部门店' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 MA7' })).toBeTruthy();
    expect(screen.getByText(/按周 · 外卖$/)).toBeTruthy();
    expect(screen.getByText('虾仁鲜肉小馄饨 · 2 周')).toBeTruthy();
    expect(screen.getByTestId('product-chart-side-layout')).toHaveStyle({ flexDirection: 'row' });
    const detail = screen.getByTestId('product-chart-side-detail');
    expect(detail).toHaveStyle({ position: 'relative', width: 208 });
    expect(within(detail).getByText('2026-W27')).toBeTruthy();
    expect(within(detail).getByText('范围 MA7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '修改图表筛选' })).toBeNull();
  });

  it('loads a product cold-start deep link with its own period and scope parameters', async () => {
    mockParams = {
      cacheKey: 'product-dashboard-v3:deep-link',
      dateFrom: '2026-05-04',
      dateTo: '2026-07-19',
      dimKey: 'takeout',
      dimType: 'channel',
      granularity: 'month',
      includeCurrent: 'true',
      productKey: 'p-deep',
      productScopes: JSON.stringify([
        { key: 'shop:101', label: '茅坡店', storeKeys: ['101'], type: 'store' },
        { key: 'shop:102', label: '凤十二店', storeKeys: ['102'], type: 'store' },
      ]),
      scopeKeys: 'shop:101,shop:102',
      sourceType: 'takeout',
      storeKeys: '101,102',
      type: 'product',
    };
    useInsightDetailStore.getState().reset();
    jest.mocked(getProductTrend).mockResolvedValueOnce({
      date_from: '2026-05-04',
      date_to: '2026-07-19',
      dim_key: 'takeout',
      dim_type: 'channel',
      granularity: 'month',
      metric: 'quantity',
      points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 25, period: '2026-06', quantity: 30, sales_amount: 900 }],
      product_key: 'p-deep',
      product_name: '冷启动产品',
      store_trends: {
        '101': [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 10, period: '2026-06', quantity: 12, sales_amount: 360 }],
        '102': [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 15, period: '2026-06', quantity: 18, sales_amount: 540 }],
      },
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith(
      'p-deep',
      expect.objectContaining({ dateFrom: '2026-05-04', dateTo: '2026-07-19', granularity: 'month', includeCurrent: true, sourceType: 'takeout', storeKey: 'ALL', storeKeys: ['101', '102'] }),
      expect.objectContaining({ dimKey: 'takeout', dimType: 'channel', granularity: 'month', includeCurrent: true, signal: expect.any(AbortSignal), storeKeys: ['101', '102'] }),
    ));
    expect(screen.getByRole('button', { name: '隐藏 茅坡店' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 凤十二店' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /导出单品销量趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));
    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({ granularity: 'month' })));
  });

  it('reads the portrait product cache on an offline cold-start deep link', async () => {
    const filters = { dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week' as const, includeCurrent: false, sourceType: 'all' as const, storeKey: 'ALL', storeKeys: ['101', '102'] };
    const cacheKey = productAnalyticsCacheKey(filters, { dimKey: 'ALL', dimType: 'all' }, ['p-cache'], 'previous');
    mockParams = {
      cacheKey,
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      dimKey: 'ALL',
      dimType: 'all',
      granularity: 'week',
      includeCurrent: 'false',
      productKey: 'p-cache',
      storeKeys: '101,102',
      type: 'product',
    };
    useNetworkStore.setState({ status: 'offline' });
    useInsightDetailStore.getState().reset();
    jest.mocked(readCachedAnalytics).mockResolvedValueOnce({
      data: {
        ranking: { bottom: [], top: [], total: 0 },
        trend: {
          date_from: '2026-06-15',
          date_to: '2026-07-19',
          dim_key: 'ALL',
          dim_type: 'all',
          granularity: 'week',
          metric: 'quantity',
          points: [{ ma7: null, ma30: null, ma180: null, missing: false, order_count: 8, period: '2026-W28', quantity: 10, sales_amount: 260 }],
          product_key: 'p-cache',
          product_name: '缓存产品',
        },
      },
      lastSyncedAt: Date.now(),
    } as never);

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith('products', cacheKey, expect.any(Number)));
    expect(getProductTrend).not.toHaveBeenCalled();
    expect(screen.getByText('销量 10 份')).toBeTruthy();
  });

  it('uses the selected cached product trend in offline fullscreen without another request', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', type: 'product' };
    useNetworkStore.setState({ status: 'offline' });
    useInsightDetailStore.setState({
      productTrend: {
        date_from: '2026-06-17',
        date_to: '2026-07-16',
        dim_key: 'takeout',
        dim_type: 'channel',
        metric: 'quantity',
        points: [{ ma7: 136.5, ma30: 134, ma180: 130, missing: false, order_count: 110, period: '2026-07-16', quantity: 141, sales_amount: 4820 }],
        product_key: 'p-1',
        product_name: '虾仁鲜肉小馄饨',
      },
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    expect(getProductTrend).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-chart-side-detail')).toBeTruthy();
    expect(screen.getByText('销量 141 份')).toBeTruthy();
  });

  it('rejects an offline product trend cached for a different date range', async () => {
    mockParams = { dimKey: 'takeout', dimType: 'channel', type: 'product' };
    useNetworkStore.setState({ status: 'offline' });
    useInsightDetailStore.setState({
      productTrend: {
        date_from: '2026-05-01',
        date_to: '2026-05-31',
        dim_key: 'takeout',
        dim_type: 'channel',
        metric: 'quantity',
        points: [{ ma7: 90, ma30: 85, ma180: 80, missing: false, order_count: 60, period: '2026-05-31', quantity: 100, sales_amount: 3200 }],
        product_key: 'p-1',
        product_name: '虾仁鲜肉小馄饨',
      },
    });

    const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><ChartRoute /></SafeAreaProvider>);

    expect(getProductTrend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('product-chart-side-detail')).toBeNull();
    expect(screen.getByText('离线状态下暂无已加载趋势')).toBeTruthy();
  });
});

const laborTrendPoint = {
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
  period: '2026-07-16',
  planned_hours: 12,
  planned_hours_ma7: 11.5,
  planned_hours_ma30: 11,
  planned_hours_ma180: 10.5,
  planned_revenue_per_hour: 200,
  planned_revenue_per_hour_ma7: 198,
  planned_revenue_per_hour_ma30: 196,
  planned_revenue_per_hour_ma180: 194,
};

function mealTrendPoint(date: string, netIncome: number, orderCount: number) {
  const row = (period_key: 'breakfast' | 'lunch' | 'afternoon_tea' | 'dinner' | 'late_night', period_label: string) => ({
    avg_order_value: 0,
    income_amount: period_key === 'lunch' ? netIncome : 0,
    ma180: netIncome - 300,
    ma30: netIncome - 200,
    ma7: netIncome - 100,
    net_income: period_key === 'lunch' ? netIncome : 0,
    order_count: period_key === 'lunch' ? orderCount : 0,
    paid_amount: period_key === 'lunch' ? netIncome : 0,
    period_key,
    period_label,
    refund_amount: 0,
  });
  return {
    afternoon_tea: row('afternoon_tea', '下午茶'),
    breakfast: row('breakfast', '早餐'),
    date,
    dinner: row('dinner', '晚餐'),
    late_night: row('late_night', '夜宵'),
    lunch: row('lunch', '午餐'),
  };
}

function turnoverTrendPoint(date: string, lunchOrders: number) {
  const empty = { ma180: null, ma30: null, ma7: null, shop_order_count: 0, turnover: 0 };
  return {
    afternoon_tea: empty,
    breakfast: empty,
    date,
    dinner: empty,
    late_night: empty,
    lunch: { ma180: null, ma30: null, ma7: null, shop_order_count: lunchOrders, turnover: 0 },
  };
}
