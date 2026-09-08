import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { getLabor, getLaborTrend } from '@/services/api/analytics';
import { getOperationsLabor } from '@/services/api/operationsAnalytics';
import { showToast } from '@/components/feedback/AppToast';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { clearCachedAnalytics, readCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import type { LaborTrendPoint } from '@/services/api/analytics';
import { laborDashboardCacheScope, serializeAnalyticsFilters, type AnalyticsFilters } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { LaborInsightScreen } from './LaborInsightScreen';
import type { StoreScopeNode } from './storeScope';
import type { TrendMovingAverageMeta } from './trendPeriod';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/services/api/analytics', () => ({ getLabor: jest.fn(), getLaborTrend: jest.fn() }));
jest.mock('@/services/api/operationsAnalytics', () => ({ getOperationsLabor: jest.fn() }));
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({ clearCachedAnalytics: jest.fn(), readCachedAnalytics: jest.fn(), saveCachedAnalytics: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./analyticsStore', () => ({ useAnalyticsStore: jest.fn() }));

const mockStore = useAnalyticsStore as unknown as jest.Mock;
const mockGetLabor = jest.mocked(getLabor);
const mockGetLaborTrend = jest.mocked(getLaborTrend);
const mockGetOperationsLabor = jest.mocked(getOperationsLabor);
const mockShowToast = jest.mocked(showToast);
const mockClearCachedAnalytics = jest.mocked(clearCachedAnalytics);
const mockReadCachedAnalytics = jest.mocked(readCachedAnalytics);
const mockPush = jest.fn();

const sharedDepartmentTree = [{
  key: 'dept:ops', type: 'department' as const, label: '运营部', children: [
    { key: 'shop:801', type: 'store' as const, label: '北大街', store_key: '801', department_id: '111' },
    { key: 'shop:802', type: 'store' as const, label: '南大街', store_key: '802', department_id: '111' },
    { key: 'shop:803', type: 'store' as const, label: '科技路', store_key: '803', department_id: '112' },
  ],
}];
const movingAverageCases: Array<[string, TrendMovingAverageMeta[] | undefined, boolean]> = [
  ['missing metadata', undefined, true],
  ['explicitly empty metadata', [], false],
];

function trendPoint(overrides: Partial<LaborTrendPoint> = {}): LaborTrendPoint {
  return {
    actual_hours: 10,
    actual_hours_ma7: null,
    actual_hours_ma30: null,
    actual_hours_ma180: null,
    actual_revenue_per_hour: 100,
    actual_revenue_per_hour_ma7: null,
    actual_revenue_per_hour_ma30: null,
    actual_revenue_per_hour_ma180: null,
    headcount: 2,
    missing: false,
    net_revenue: 1_000,
    period: '2026-W29',
    planned_hours: 10,
    planned_hours_ma7: null,
    planned_hours_ma30: null,
    planned_hours_ma180: null,
    planned_revenue_per_hour: 100,
    planned_revenue_per_hour_ma7: null,
    planned_revenue_per_hour_ma30: null,
    planned_revenue_per_hour_ma180: null,
    ...overrides,
  };
}

function operationsLabor(overrides: Partial<Awaited<ReturnType<typeof getOperationsLabor>>> = {}) {
  return {
    data_status: 'ready',
    excluded_dates: ['2026-07-18'],
    granularity: 'week' as const,
    points: [],
    previous_period: { date_from: '2026-05-11', date_to: '2026-06-14' },
    summary: {
      actual_hours: 120,
      planned_hours: 110,
      net_revenue: 36_000,
      headcount: 20,
      actual_revenue_per_hour: 300,
      planned_revenue_per_hour: 327.27,
      comparison: {
        actual_hours: { change_rate: 0.2, current: 120, difference: 20, previous: 100, status: 'comparable' },
        actual_revenue_per_hour: { change_rate: 0.2, current: 300, difference: 50, previous: 250, status: 'comparable' },
        net_revenue: { change_rate: 0.2, current: 36_000, difference: 6_000, previous: 30_000, status: 'comparable' },
        planned_hours: { change_rate: 0.1, current: 110, difference: 10, previous: 100, status: 'comparable' },
        planned_revenue_per_hour: { change_rate: 0.1, current: 327.27, difference: 29.75, previous: 297.52, status: 'comparable' },
      },
    },
    ...overrides,
  };
}

function laborCacheContext(filters: AnalyticsFilters, departmentKeys: string[], scopeKey: string, comparisonMode: 'none' | 'previous' = 'previous') {
  return { comparisonMode, departmentKeys, filters: serializeAnalyticsFilters(filters), scopeKey };
}

describe('LaborInsightScreen scopes', () => {
  const state: {
    comparisonModeByModule: { labor: 'none' | 'previous' };
    filters: AnalyticsFilters;
    hiddenSeriesByChart: Record<string, string[]>;
    isOffline: boolean;
    laborFilters: AnalyticsFilters;
    lastSyncedAt: number | null;
    loadScopes: jest.Mock;
    scopeTree: StoreScopeNode[];
    selectedPeriodByChart: Record<string, string>;
    setSelectedChartPeriod: jest.Mock;
    setComparisonMode: jest.Mock;
    setLaborFilters: jest.Mock;
    stores: Array<{ key: string; label: string }>;
    toggleSeriesVisibility: jest.Mock;
  } = {
    comparisonModeByModule: { labor: 'previous' },
    filters: { dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false, sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
    hiddenSeriesByChart: {},
    isOffline: false,
    laborFilters: { dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false, scopeKeys: ['shop:801', 'shop:802'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['801', '802'] },
    lastSyncedAt: null,
    loadScopes: jest.fn(),
    scopeTree: sharedDepartmentTree,
    selectedPeriodByChart: {},
    setSelectedChartPeriod: jest.fn(),
    setComparisonMode: jest.fn(),
    setLaborFilters: jest.fn(),
    stores: [],
    toggleSeriesVisibility: jest.fn(),
  };

  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({ hydrated: true, mode: 'light', resolvedMode: 'light', setMode: async () => {}, theme: semanticThemes.light });
    jest.mocked(useRouter).mockReturnValue({ push: mockPush } as never);
    mockPush.mockReset();
    mockGetLabor.mockReset().mockResolvedValue({ rows: [{ actual_hours: 10, headcount: 2, hours_gap: 1, net_revenue: 1000, planned_hours: 11, revenue_per_hour: 100, store_key: '111', store_label: '北区人效部', uncovered: false }] });
    mockGetLaborTrend.mockReset().mockResolvedValue({ granularity: 'week', period: '2026-06-15_2026-07-19', points: [], store_key: 'ALL', store_label: '全部门店' });
    mockGetOperationsLabor.mockReset().mockResolvedValue(operationsLabor());
    mockShowToast.mockReset();
    mockClearCachedAnalytics.mockReset().mockResolvedValue(undefined);
    mockReadCachedAnalytics.mockReset().mockResolvedValue(null);
    state.laborFilters = { dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false, scopeKeys: ['shop:801', 'shop:802'], sourceType: 'all', storeKey: 'ALL', storeKeys: ['801', '802'] };
    state.comparisonModeByModule = { labor: 'previous' };
    state.hiddenSeriesByChart = {};
    state.selectedPeriodByChart = {};
    state.setSelectedChartPeriod.mockReset();
    state.setComparisonMode.mockReset().mockImplementation((_module: string, mode: 'none' | 'previous') => {
      state.comparisonModeByModule = { labor: mode };
    });
    state.scopeTree = sharedDepartmentTree;
    state.toggleSeriesVisibility.mockReset();
    mockStore.mockImplementation((selector?: (value: typeof state) => unknown) => selector ? selector(state) : state);
    useNetworkStore.setState({ status: 'online' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests a shared department once and only shows a scope summary', async () => {
    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(mockGetLabor).toHaveBeenCalledWith(
      expect.objectContaining({ storeKeys: ['111'], storeKey: '111' }),
      expect.objectContaining({ signal: expect.anything() }),
    ));
    expect(mockGetLaborTrend).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKeys: ['shop:801', 'shop:802'] }),
      expect.objectContaining({ granularity: 'week', includeCurrent: false, signal: expect.anything(), storeKeys: ['111'] }),
    );
    expect(screen.getByText('门店共用人效部门，暂无法拆分')).toBeTruthy();
    expect(screen.getByText('人效范围汇总')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '北区人效部' })).toBeNull();
  });

  it.each([
    ['day', '2026-07-19', '2026-07-19'],
    ['week', '2026-07-13', '2026-07-19'],
    ['month', '2026-07-01', '2026-07-19'],
  ] as const)('loads %s summary and operations comparison for the latest detail period only', async (granularity, dateFrom, dateTo) => {
    state.laborFilters = { ...state.laborFilters, granularity };

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(mockGetOperationsLabor).toHaveBeenCalledWith({
      compare: 'previous',
      dateFrom,
      dateTo,
      granularity,
      signal: expect.any(AbortSignal),
      storeKeys: ['111'],
    }));
    expect(mockGetLabor).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom, dateTo, storeKeys: ['111'], storeKey: '111' }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mockGetLaborTrend).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-06-15', dateTo: '2026-07-19' }),
      expect.objectContaining({ granularity, includeCurrent: false, signal: expect.anything(), storeKeys: ['111'] }),
    );
    const periodLabel = granularity === 'month' ? '2026年07月' : `${dateFrom}${dateFrom === dateTo ? '' : ` 至 ${dateTo}`}`;
    expect(screen.getByText(`当前周期：${periodLabel}`)).toBeTruthy();
    expect(screen.getByText('较排班 +10.0%')).toBeTruthy();
    expect(screen.getByText('较上期 +20.00%')).toBeTruthy();
  });

  it('keeps the current labor dashboard when operations comparison fails', async () => {
    mockGetOperationsLabor.mockRejectedValueOnce(new Error('comparison unavailable'));

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('人效分析')).toBeTruthy());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('上期数据加载失败，已展示当前期数据', 'info'));
    expect(screen.queryByText(/较上期/)).toBeNull();
  });

  it('hides stale comparison immediately after disabling comparison', async () => {
    const screen = await render(<View testID="comparison-previous"><LaborInsightScreen /></View>);

    await waitFor(() => expect(screen.getByText('较上期 +20.00%')).toBeTruthy());
    expect(screen.getByText(/对比上期：/)).toBeTruthy();
    expect(screen.getByText(/已排除日期：/)).toBeTruthy();
    mockGetLabor.mockImplementationOnce(() => new Promise(() => {}));
    mockGetLaborTrend.mockImplementationOnce(() => new Promise(() => {}));

    await fireEvent.press(screen.getByRole('button', { name: '不对比' }));
    await screen.rerender(<View testID="comparison-none"><LaborInsightScreen /></View>);

    expect(state.setComparisonMode).toHaveBeenCalledWith('labor', 'none');
    expect(state.comparisonModeByModule.labor).toBe('none');
    expect(screen.getByRole('button', { name: '不对比' }).props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText(/较上期/)).toBeNull();
    expect(screen.queryByText(/对比上期：/)).toBeNull();
    expect(screen.queryByText(/已排除日期：/)).toBeNull();
  });

  it('renders an unavailable schedule delta when planned hours are zero', async () => {
    mockGetLabor.mockResolvedValue({ rows: [{ actual_hours: 10, headcount: 2, hours_gap: 10, net_revenue: 1000, planned_hours: 0, revenue_per_hour: 100, store_key: '111', store_label: '北区人效部', uncovered: false }] });
    mockGetLaborTrend.mockResolvedValue({
      granularity: 'week', period: '2026-06-15_2026-07-19',
      points: [trendPoint({ planned_hours: 0, planned_revenue_per_hour: null })], store_key: 'ALL',
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByLabelText('人效汇总')).toBeTruthy());
    expect(screen.getByText('较排班 -')).toBeTruthy();
  });

  it('restores the cached comparison while offline without requesting operations data', async () => {
    useNetworkStore.setState({ status: 'offline' });
    const detailFilters = { ...state.laborFilters, dateFrom: '2026-07-13', dateTo: '2026-07-19' };
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: laborCacheContext(detailFilters, ['111'], 'shop:801,shop:802:801,802:111'),
        comparison: operationsLabor(),
        summary: { rows: [{ actual_hours: 10, headcount: 2, hours_gap: 1, net_revenue: 1000, planned_hours: 11, revenue_per_hour: 100, store_key: '111', store_label: '北区人效部', uncovered: false }] },
        trend: { granularity: 'week', period: '2026-06-15_2026-07-19', points: [trendPoint()], store_key: '111' },
      },
      lastSyncedAt: Date.now(),
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('较上期 +20.00%')).toBeTruthy());
    expect(mockGetOperationsLabor).not.toHaveBeenCalled();
    expect(mockReadCachedAnalytics).toHaveBeenCalledWith('labor', expect.stringContaining('comparison_mode=previous'), expect.any(Number));
  });

  it('clears prior labor data when a new offline scope has no exact cache snapshot', async () => {
    const screen = await render(<LaborInsightScreen />);
    await waitFor(() => expect(screen.getByText('北区人效部')).toBeTruthy());

    state.laborFilters = { ...state.laborFilters, dateTo: '2026-07-20' };
    await act(async () => { useNetworkStore.setState({ status: 'offline' }); });
    await screen.rerender(<LaborInsightScreen />);

    await waitFor(() => expect(screen.queryByText('北区人效部')).toBeNull());
    await screen.unmount();
  });

  it('keeps the exact stale labor snapshot after a network failure', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['ALL'], storeKey: 'ALL', storeKeys: ['ALL'] };
    state.scopeTree = [];
    const filters = state.laborFilters;
    const detailFilters = { ...filters, dateFrom: '2026-07-13', dateTo: '2026-07-19' };
    const cachedLaborDashboard = {
      cacheContext: laborCacheContext(detailFilters, [], 'ALL::', 'previous'),
      comparison: null,
      summary: { rows: [{ actual_hours: 10, headcount: 2, hours_gap: 0, net_revenue: 1000, planned_hours: 10, revenue_per_hour: 100, store_key: 's-1', store_label: '缓存人效门店', uncovered: false }] },
      trend: { granularity: 'day' as const, period: `${filters.dateFrom}_${filters.dateTo}`, points: [], store_key: 'ALL' },
    };
    mockReadCachedAnalytics.mockResolvedValue({ data: cachedLaborDashboard, lastSyncedAt: Date.now() - 301_000 });
    mockGetLabor.mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText(/离线查看/)).toBeTruthy());
    expect(screen.getByText('缓存人效门店')).toBeTruthy();
    await screen.unmount();
  });

  it('clears the exact stale labor snapshot after a business error', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['ALL'], storeKey: 'ALL', storeKeys: ['ALL'] };
    state.scopeTree = [];
    const filters = state.laborFilters;
    const detailFilters = { ...filters, dateFrom: '2026-07-13', dateTo: '2026-07-19' };
    mockReadCachedAnalytics.mockResolvedValue({
      data: {
        cacheContext: laborCacheContext(detailFilters, [], 'ALL::', 'previous'),
        comparison: null,
        summary: { rows: [{ actual_hours: 10, headcount: 2, hours_gap: 0, net_revenue: 1000, planned_hours: 10, revenue_per_hour: 100, store_key: 's-1', store_label: '错误人效缓存', uncovered: false }] },
        trend: { granularity: 'day' as const, period: `${filters.dateFrom}_${filters.dateTo}`, points: [], store_key: 'ALL' },
      },
      lastSyncedAt: Date.now() - 301_000,
    });
    mockGetLabor.mockRejectedValue(new Error('403 Forbidden'));

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('加载失败')).toBeTruthy());
    expect(mockClearCachedAnalytics).toHaveBeenCalledWith(
      'labor',
      laborDashboardCacheScope(detailFilters, 'ALL::', 'previous'),
      expect.any(Number),
    );
    expect(screen.queryByText('错误人效缓存')).toBeNull();
    await screen.unmount();
  });

  it('clears only the exact labor scope on force refresh', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['ALL'], storeKey: 'ALL', storeKeys: ['ALL'] };
    state.scopeTree = [];
    const detailFilters = { ...state.laborFilters, dateFrom: '2026-07-13', dateTo: '2026-07-19' };
    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(mockGetLabor).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    await waitFor(() => expect(mockClearCachedAnalytics).toHaveBeenCalledWith(
      'labor',
      laborDashboardCacheScope(detailFilters, 'ALL::', 'previous'),
      expect.any(Number),
    ));
    await screen.unmount();
  });

  it('renders distinguishable explicit scopes as separate actual and planned lines', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['shop:801', 'shop:803'], storeKeys: ['801', '803'] };
    mockGetLabor.mockResolvedValue({ rows: [
      { actual_hours: 10, headcount: 2, hours_gap: 1, net_revenue: 1000, planned_hours: 11, revenue_per_hour: 100, store_key: '111', store_label: '北大街', uncovered: false },
      { actual_hours: 20, headcount: 3, hours_gap: 2, net_revenue: 3000, planned_hours: 22, revenue_per_hour: 150, store_key: '112', store_label: '科技路', uncovered: false },
    ] });
    mockGetLaborTrend.mockResolvedValue({
      granularity: 'week',
      period: '2026-06-15_2026-07-19',
      points: [trendPoint({ actual_hours: 30, net_revenue: 4000, planned_hours: 33 })],
      store_key: 'MULTI',
      store_trends: {
        '111': [trendPoint({ actual_hours: 10, net_revenue: 1000, planned_hours: 11 })],
        '112': [trendPoint({ actual_hours: 20, net_revenue: 3000, planned_hours: 22 })],
      },
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getAllByText('2 个范围 · 实际 / 排班')).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: '隐藏 北大街 实际' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '隐藏 实际 MA7' })).toBeNull();
    await fireEvent.press(screen.getAllByRole('button', { name: '隐藏 科技路 排班' })[0]);
    expect(state.toggleSeriesVisibility).toHaveBeenCalledWith('labor-hours', expect.arrayContaining(['scope:shop:801:actual', 'scope:shop:803:planned']), 'scope:shop:803:planned');

    await fireEvent.press(screen.getByRole('button', { name: '全屏查看工时趋势' }));
    const navigation = mockPush.mock.calls.at(-1)?.[0];
    expect(navigation).toEqual({
      pathname: '/chart',
      params: expect.objectContaining({
        dashboardCacheKey: expect.stringContaining('labor-dashboard-v5'),
        laborScopes: expect.any(String),
        scopeLabel: '北大街 · 科技路',
      }),
    });
    expect(JSON.parse(navigation.params.laborScopes)).toEqual([
      expect.objectContaining({ departmentKeys: ['111'], key: 'shop:801', label: '北大街' }),
      expect.objectContaining({ departmentKeys: ['112'], key: 'shop:803', label: '科技路' }),
    ]);
  });

  it.each(movingAverageCases)('propagates %s from the model to daily chart fallback', async (_, movingAverages, expectsLegacyAverage) => {
    state.laborFilters = {
      ...state.laborFilters,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-19',
      granularity: 'day',
    };
    mockGetLaborTrend.mockResolvedValue({
      date_from: '2026-07-01',
      date_to: '2026-07-19',
      granularity: 'day',
      ...(movingAverages === undefined ? {} : { moving_averages: movingAverages }),
      period: '2026-07-01_2026-07-19',
      points: [trendPoint({ period: '2026-07-19' })],
      store_key: 'ALL',
      store_label: '全部门店',
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('工时趋势')).toBeTruthy());
    const legacyAverages = screen.queryAllByRole('button', { name: '隐藏 实际 MA7' });
    expect(legacyAverages).toHaveLength(expectsLegacyAverage ? 2 : 0);
  });

  it('does not request labor data for an unmapped explicit scope', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['shop:999'], storeKey: '999', storeKeys: ['999'] };
    state.scopeTree = [{ key: 'shop:999', type: 'store', label: '未映射门店', store_key: '999' }];

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('所选经营范围未映射钉钉部门，无法纳入人效统计。')).toBeTruthy());
    expect(mockGetLabor).not.toHaveBeenCalled();
    expect(mockGetLaborTrend).not.toHaveBeenCalled();
  });

  it('opens detail for a uniquely mapped store scope', async () => {
    state.laborFilters = { ...state.laborFilters, scopeKeys: ['shop:803'], storeKey: '803', storeKeys: ['803'] };
    mockGetLabor.mockResolvedValue({ rows: [{ actual_hours: 10, headcount: 2, hours_gap: 1, net_revenue: 1000, planned_hours: 11, revenue_per_hour: 100, store_key: '112', store_label: '科技路', uncovered: false }] });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByRole('button', { name: '科技路' })).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '科技路' }));
    expect(mockPush).toHaveBeenCalledWith('/analytics/labor/detail');
  });

  it('ranks each selected department once when the summary repeats it', async () => {
    mockGetLabor.mockResolvedValue({ rows: [
      { actual_hours: 10, headcount: 2, hours_gap: 1, net_revenue: 1000, planned_hours: 11, revenue_per_hour: 100, store_key: '111', store_label: '北区人效部', uncovered: false },
      { actual_hours: 20, headcount: 3, hours_gap: 2, net_revenue: 2000, planned_hours: 22, revenue_per_hour: 100, store_key: '111', store_label: '北区人效部', uncovered: false },
    ] });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByText('1 个范围')).toBeTruthy());
    expect(screen.getAllByTestId('labor-ranking-row-111')).toHaveLength(1);
    expect(screen.getByText('实际 30.0h · 排班 33.0h')).toBeTruthy();
  });

  it('renders zero-hour range efficiency as empty instead of a misleading zero', async () => {
    mockGetLabor.mockResolvedValue({ rows: [{ actual_hours: 0, headcount: 2, hours_gap: 0, net_revenue: 1000, planned_hours: 0, revenue_per_hour: 0, store_key: '111', store_label: '北区人效部', uncovered: false }] });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByLabelText('人效汇总')).toBeTruthy());
    expect(within(screen.getByLabelText('人效汇总')).getAllByText('¥ -')).toHaveLength(2);
  });

  it('keeps hours and efficiency chart state in separate store keys', async () => {
    state.hiddenSeriesByChart = { 'labor-hours': ['actual_hours'] };
    state.selectedPeriodByChart = { 'labor-hours': '2026-W29' };
    mockGetLaborTrend.mockResolvedValue({
      granularity: 'week',
      period: '2026-06-15_2026-07-19',
      points: [trendPoint()],
      store_key: 'ALL',
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(screen.getByRole('button', { name: '显示 实际工时' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '隐藏 实际人效' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('labor-hours-chart-point-2026-W29'));
    expect(state.setSelectedChartPeriod).toHaveBeenCalledWith('labor-hours', '2026-W29');
  });

  it('builds the top range summary from latest detail rows instead of full trend periods', async () => {
    mockGetLabor.mockResolvedValue({ rows: [{ actual_hours: 1, headcount: 1, hours_gap: 0, net_revenue: 1_000, planned_hours: 1, revenue_per_hour: 1_000, store_key: '111', store_label: '北区人效部', uncovered: false }] });
    mockGetLaborTrend.mockResolvedValue({
      granularity: 'week',
      period: '2026-06-15_2026-07-19',
      points: [
        trendPoint(),
        trendPoint({ actual_hours: 2, actual_revenue_per_hour: 500, headcount: 1, hours_synced: true, period: '2026-W30', planned_hours: 100, planned_revenue_per_hour: 10 }),
      ],
      store_key: 'ALL',
      store_label: '全部门店',
    });

    const screen = await render(<LaborInsightScreen />);

    await waitFor(() => expect(within(screen.getByLabelText('人效汇总')).getAllByText('¥ 1,000.0')).toHaveLength(2));
  });
});
