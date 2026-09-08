import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import * as analyticsApi from '@/services/api/analytics';
import * as operationsAnalytics from '@/services/api/operationsAnalytics';
import { showToast } from '@/components/feedback/AppToast';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { createAnalyticsFilters, createDashboardAnalyticsFilters, dashboardAnalyticsCacheScope, orderAnalyticsCacheScope, productAnalyticsCacheKey, laborAnalyticsCacheKey, serializeAnalyticsFilters, type AnalyticsFilters } from './analyticsFilters';
import { createOrderAnalyticsFilters } from './orderAnalytics';
import { useAnalyticsStore } from './analyticsStore';
import { DEFAULT_COMPARISON_DISPLAY_MODES, DEFAULT_COMPARISON_MODES } from './periodComparison';

jest.mock('@/services/api/analytics');
jest.mock('@/services/api/operationsAnalytics');
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  clearCachedAnalytics: jest.fn(),
  readCachedAnalytics: jest.fn(),
  saveCachedAnalytics: jest.fn(),
}));
jest.mock('@/utils/time', () => ({
  ...jest.requireActual<typeof import('@/utils/time')>('@/utils/time'),
  beijingToday: () => '2026-07-21',
}));

const revenue = { date_from: '2026-07-15', date_to: '2026-07-16', points: [], store_key: 'ALL' };
const revenueSources = { shop: revenue, takeout: revenue };
const mealPeriods = { business_date: '2026-07-16', periods: [], store_key: 'ALL' };
const mealTrend = {
  date_from: '2026-07-15',
  date_to: '2026-07-16',
  points: [mealTrendPoint('2026-07-15'), mealTrendPoint('2026-07-16')],
  store_key: 'ALL',
};
const turnover = { data_status: 'ok', eligible_store_count: 0, summary: [], table_count: 0 };
const comparison = {
  period: { date_from: '2026-07-15', date_to: '2026-07-16' },
  previous_period: { date_from: '2026-07-13', date_to: '2026-07-14' },
  metrics: { net_income: { current: 3000, previous: 2800, difference: 200, change_rate: 0.0714, status: 'comparable' } },
  latest_metrics: { order_count: { current: 120, previous: 100, difference: 20, change_rate: 0.2, status: 'comparable' } },
  channels: [],
  platforms: [],
  stores: [],
  store_channels: [],
};

describe('analyticsStore', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(clearCachedAnalytics).mockResolvedValue(undefined);
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);
    jest.mocked(saveCachedAnalytics).mockResolvedValue(undefined);
    jest.mocked(operationsAnalytics.getOperationsOverview).mockResolvedValue(comparison);
    jest.mocked(analyticsApi.getDashboardAnalytics).mockImplementation(async (filters, options) => {
      const [nextRevenue, shop, takeout, nextMealPeriods, nextMealTrend, nextTurnover] = await Promise.all([
        analyticsApi.getRevenueTrend({ ...filters, sourceType: 'all' }, options),
        analyticsApi.getRevenueTrend({ ...filters, sourceType: 'shop' }, options),
        analyticsApi.getRevenueTrend({ ...filters, sourceType: 'takeout' }, options),
        analyticsApi.getMealPeriods(filters, options),
        analyticsApi.getMealPeriodTrend(filters, options),
        analyticsApi.getMealPeriodTurnover(filters, options),
      ]);
      return {
        mealPeriods: nextMealPeriods,
        mealTrend: nextMealTrend,
        revenue: nextRevenue,
        revenueSources: { shop, takeout },
        turnover: nextTurnover,
      };
    });
    useNetworkStore.setState({ status: 'online' });
    useAnalyticsStore.setState({ comparisonDisplayModeByModule: { ...DEFAULT_COMPARISON_DISPLAY_MODES }, comparisonModeByModule: { ...DEFAULT_COMPARISON_MODES }, dashboardFilters: createDashboardAnalyticsFilters('2026-07-17'), data: null, dataFilterKey: null, error: null, filters: createAnalyticsFilters('2026-07-17'), hiddenSeriesByChart: {}, isOffline: false, laborFilters: createAnalyticsFilters('2026-07-17'), lastSyncedAt: null, mealStatus: 'idle', orderDimensions: [], orderFilters: createOrderAnalyticsFilters('2026-07-17'), productFilters: createAnalyticsFilters('2026-07-17'), scopeTree: [], selectedMealDate: null, selectedPeriodByChart: {}, selectedSeriesByChart: {}, status: 'idle', stores: [] });
  });

  it('stores comparison settings independently by analytics module and resets them to defaults', () => {
    useAnalyticsStore.getState().setComparisonMode('orders', 'none');
    useAnalyticsStore.getState().setComparisonDisplayMode('products', 'all');

    expect(useAnalyticsStore.getState().comparisonModeByModule).toMatchObject({
      dashboard: 'previous',
      orders: 'none',
    });
    expect(useAnalyticsStore.getState().comparisonDisplayModeByModule).toMatchObject({
      orders: 'percentage',
      products: 'all',
    });

    useAnalyticsStore.getState().reset();

    expect(useAnalyticsStore.getState().comparisonModeByModule).toEqual(DEFAULT_COMPARISON_MODES);
    expect(useAnalyticsStore.getState().comparisonDisplayModeByModule).toEqual(DEFAULT_COMPARISON_DISPLAY_MODES);
  });

  it('keeps the product trend selection as an ordered bounded store value', () => {
    const state = useAnalyticsStore.getState() as unknown as { selectedProductKeys?: string[]; setSelectedProductKeys?: (keys: string[]) => void };

    expect(state.selectedProductKeys).toEqual([]);
    state.setSelectedProductKeys?.(['p-2', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6']);

    expect(useAnalyticsStore.getState().selectedProductKeys).toEqual(['p-2', 'p-1', 'p-3', 'p-4', 'p-5']);
  });

  it('selects an already loaded meal date without replacing the revenue range', async () => {
    const revenue = { date_from: '2026-07-15', date_to: '2026-07-16', points: [], store_key: 'ALL' };
    const currentMealPeriods = { business_date: '2026-07-16', periods: [], store_key: 'ALL' };
    const turnover = { data_status: 'ok', eligible_store_count: 0, summary: [], table_count: 0 };
    useAnalyticsStore.setState({
      data: { comparison: null, mealPeriods: currentMealPeriods, mealTrend, revenue, revenueSources, turnover },
      dashboardFilters: { dateFrom: '2026-07-15', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
    });

    await useAnalyticsStore.getState().selectMealDate('2026-07-15');

    expect(analyticsApi.getMealPeriods).not.toHaveBeenCalled();
    expect(useAnalyticsStore.getState()).toMatchObject({
      data: { mealPeriods: { business_date: '2026-07-15', periods: expect.any(Array) }, mealTrend, revenue, revenueSources, turnover },
      mealStatus: 'idle',
      selectedMealDate: '2026-07-15',
    });
  });

  it('loads current dashboard metrics through the combined daily-fact facade', async () => {
    jest.mocked(analyticsApi.getDashboardAnalytics).mockResolvedValue({
      mealPeriods,
      mealTrend,
      revenue,
      revenueSources,
      turnover,
    });

    await useAnalyticsStore.getState().refresh();

    expect(analyticsApi.getDashboardAnalytics).toHaveBeenCalledTimes(1);
    expect(analyticsApi.getDashboardAnalytics).toHaveBeenCalledWith(
      useAnalyticsStore.getState().dashboardFilters,
      expect.objectContaining({ forceRefresh: false, signal: expect.any(AbortSignal) }),
    );
    expect(analyticsApi.getRevenueTrend).not.toHaveBeenCalled();
    expect(useAnalyticsStore.getState().data).toMatchObject({ mealPeriods, mealTrend, revenue, revenueSources, turnover });
  });

  it('uses the current user cached dashboard only when the network is unavailable', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    const revenue = { date_from: '2026-07-15', date_to: '2026-07-16', points: [], store_key: 'ALL' };
    const mealPeriods = { business_date: '2026-07-16', periods: [], store_key: 'ALL' };
    const turnover = { data_status: 'ok', eligible_store_count: 0, summary: [], table_count: 0 };
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: module === 'revenue' ? revenue : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover,
      lastSyncedAt: cachedAt,
    }) as never);
    for (const request of [analyticsApi.getRevenueTrend, analyticsApi.getMealPeriods, analyticsApi.getMealPeriodTrend, analyticsApi.getMealPeriodTurnover]) {
      jest.mocked(request).mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    }

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState()).toMatchObject({
      data: { revenue, revenueSources, mealPeriods, mealTrend, turnover }, dataFilterKey: serializeAnalyticsFilters(useAnalyticsStore.getState().dashboardFilters), isOffline: true, lastSyncedAt: cachedAt, status: 'idle',
    });
    const scope = dashboardAnalyticsCacheScope(useAnalyticsStore.getState().dashboardFilters, 'previous');
    expect(readCachedAnalytics).toHaveBeenCalledWith('revenue', scope, expect.any(Number));
    expect(readCachedAnalytics).toHaveBeenCalledWith('revenueSources', scope, expect.any(Number));
    expect(readCachedAnalytics).toHaveBeenCalledWith('mealPeriods', scope, expect.any(Number));
    expect(readCachedAnalytics).toHaveBeenCalledWith('mealPeriodTrend', scope, expect.any(Number));
    expect(readCachedAnalytics).toHaveBeenCalledWith('mealPeriodTurnover', scope, expect.any(Number));
  });

  it('uses an exact fresh dashboard snapshot without starting network requests', async () => {
    const cachedAt = Date.now() - 60_000;
    const cachedByModule = { revenue, revenueSources, mealPeriods, mealPeriodTrend: mealTrend, mealPeriodTurnover: turnover };
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: cachedByModule[module as keyof typeof cachedByModule],
      lastSyncedAt: cachedAt,
    }) as never);

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState()).toMatchObject({ dataSource: 'local-cache', isOffline: false, status: 'idle' });
    expect(analyticsApi.getRevenueTrend).not.toHaveBeenCalled();
  });

  it('revalidates when any dashboard module snapshot is stale', async () => {
    const cachedAt = Date.now() - 60_000;
    const staleAt = Date.now() - 301_000;
    const cachedByModule = { revenue, revenueSources, mealPeriods, mealPeriodTrend: mealTrend, mealPeriodTurnover: turnover };
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: cachedByModule[module as keyof typeof cachedByModule],
      lastSyncedAt: module === 'revenue' ? cachedAt : staleAt,
    }) as never);
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);

    await useAnalyticsStore.getState().refresh();

    expect(analyticsApi.getRevenueTrend).toHaveBeenCalled();
  });

  it('shows an old snapshot while revalidating and replaces it with network data', async () => {
    const cachedAt = Date.now() - 301_000;
    const cachedByModule = { revenue, revenueSources, mealPeriods, mealPeriodTrend: mealTrend, mealPeriodTurnover: turnover };
    let resolveRevenue: ((value: typeof revenue) => void) | undefined;
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: cachedByModule[module as keyof typeof cachedByModule],
      lastSyncedAt: cachedAt,
    }) as never);
    jest.mocked(analyticsApi.getRevenueTrend).mockReturnValue(new Promise((resolve) => { resolveRevenue = resolve; }));
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);

    const refresh = useAnalyticsStore.getState().refresh();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(useAnalyticsStore.getState()).toMatchObject({ data: { revenue, revenueSources, mealPeriods, mealTrend, turnover }, dataSource: 'local-cache', isOffline: false, status: 'refreshing' });
    expect(analyticsApi.getRevenueTrend).toHaveBeenCalled();

    resolveRevenue?.(revenue);
    await refresh;

    expect(useAnalyticsStore.getState()).toMatchObject({ dataSource: 'network', isOffline: false, status: 'idle' });
  });

  it('bypasses snapshots for a force refresh', async () => {
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);

    await useAnalyticsStore.getState().refresh(true);

    expect(readCachedAnalytics).not.toHaveBeenCalled();
    expect(analyticsApi.getRevenueTrend).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ forceRefresh: true }));
  });

  it('clears exact dashboard snapshots before a failed force refresh cannot restore them', async () => {
    const cachedAt = Date.now() - 60_000;
    const cachedByModule = { revenue, revenueSources, mealPeriods, mealPeriodTrend: mealTrend, mealPeriodTurnover: turnover };
    let snapshotsCleared = false;
    useAnalyticsStore.setState({ dataSource: null });
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => snapshotsCleared ? null : {
      data: cachedByModule[module as keyof typeof cachedByModule],
      lastSyncedAt: cachedAt,
    } as never);
    jest.mocked(clearCachedAnalytics).mockImplementation(async () => { snapshotsCleared = true; });
    for (const request of [analyticsApi.getRevenueTrend, analyticsApi.getMealPeriods, analyticsApi.getMealPeriodTrend, analyticsApi.getMealPeriodTurnover]) {
      jest.mocked(request).mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    }

    await useAnalyticsStore.getState().refresh(true);

    const scope = dashboardAnalyticsCacheScope(useAnalyticsStore.getState().dashboardFilters, 'previous');
    for (const module of ['revenue', 'revenueSources', 'mealPeriods', 'mealPeriodTrend', 'mealPeriodTurnover'] as const) {
      expect(clearCachedAnalytics).toHaveBeenCalledWith(module, scope, expect.any(Number));
    }
    expect(useAnalyticsStore.getState()).toMatchObject({ data: null, dataSource: null, isOffline: false, status: 'error' });
  });

  it('clears stale dashboard snapshots and display state after a non-network refresh failure', async () => {
    const cachedAt = Date.now() - 301_000;
    const cachedByModule = { revenue, revenueSources, mealPeriods, mealPeriodTrend: mealTrend, mealPeriodTurnover: turnover };
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: cachedByModule[module as keyof typeof cachedByModule],
      lastSyncedAt: cachedAt,
    }) as never);
    for (const request of [analyticsApi.getRevenueTrend, analyticsApi.getMealPeriods, analyticsApi.getMealPeriodTrend, analyticsApi.getMealPeriodTurnover]) {
      jest.mocked(request).mockRejectedValue(new Error('请求失败（403）'));
    }

    await useAnalyticsStore.getState().refresh();

    const scope = dashboardAnalyticsCacheScope(useAnalyticsStore.getState().dashboardFilters, 'previous');
    for (const module of ['revenue', 'revenueSources', 'mealPeriods', 'mealPeriodTrend', 'mealPeriodTurnover'] as const) {
      expect(clearCachedAnalytics).toHaveBeenCalledWith(module, scope, expect.any(Number));
    }
    expect(useAnalyticsStore.getState()).toMatchObject({ data: null, dataFilterKey: null, dataSource: null, error: '请求失败（403）', isOffline: false, lastSyncedAt: null, status: 'error' });
  });

  it('writes all dashboard modules with the exact active filter scope', async () => {
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);

    await useAnalyticsStore.getState().refresh();

    const scope = dashboardAnalyticsCacheScope(useAnalyticsStore.getState().dashboardFilters, 'previous');
    expect(analyticsApi.getRevenueTrend).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'all' }), expect.any(Object));
    expect(analyticsApi.getRevenueTrend).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'shop' }), expect.any(Object));
    expect(analyticsApi.getRevenueTrend).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'takeout' }), expect.any(Object));
    expect(saveCachedAnalytics).toHaveBeenCalledWith('revenue', scope, {
      ...revenue,
      dashboardComparison: null,
      dashboardComparisonContext: {
        comparisonMode: 'previous',
        dateFrom: useAnalyticsStore.getState().dashboardFilters.dateFrom,
        dateTo: useAnalyticsStore.getState().dashboardFilters.dateTo,
      },
    }, expect.any(Number));
    expect(saveCachedAnalytics).toHaveBeenCalledWith('revenueSources', scope, revenueSources, expect.any(Number));
    expect(saveCachedAnalytics).toHaveBeenCalledWith('mealPeriods', scope, mealPeriods, expect.any(Number));
    expect(saveCachedAnalytics).toHaveBeenCalledWith('mealPeriodTrend', scope, mealTrend, expect.any(Number));
    expect(saveCachedAnalytics).toHaveBeenCalledWith('mealPeriodTurnover', scope, turnover, expect.any(Number));
  });

  it('requests comparison with the selected concrete revenue period and resolved stores', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [
        { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false },
        { period: '2026-W30', period_start: '2026-07-20', period_end: '2026-07-26', net_income: 0, order_count: 0, missing: true },
      ],
    };
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(selectedRevenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    useAnalyticsStore.setState({
      dashboardFilters: { ...createDashboardAnalyticsFilters('2026-07-21'), scopeKeys: ['dept:north'], storeKey: 'ALL', storeKeys: ['101', '102'] },
      selectedPeriodByChart: { 'revenue:net': '2026-W29' },
    });

    await useAnalyticsStore.getState().refresh();

    expect(operationsAnalytics.getOperationsOverview).toHaveBeenCalledWith(expect.objectContaining({
      compare: 'previous',
      dateFrom: '2026-07-13',
      dateTo: '2026-07-19',
      signal: expect.any(AbortSignal),
      storeKeys: ['101', '102'],
    }));
    expect(useAnalyticsStore.getState().data?.comparison).toEqual(comparison);
  });

  it('requests comparison when the selected dashboard period is a period start date', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [
        { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false },
        { period: '2026-W30', period_start: '2026-07-20', period_end: '2026-07-26', net_income: 3200, order_count: 210, missing: false },
      ],
    };
    useAnalyticsStore.setState({
      data: { comparison: null, mealPeriods, mealTrend, revenue: selectedRevenue, revenueSources, turnover },
      selectedPeriodByChart: { 'dashboard:revenue': '2026-07-13' },
    });

    await useAnalyticsStore.getState().refreshComparison();

    expect(operationsAnalytics.getOperationsOverview).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-07-13',
      dateTo: '2026-07-19',
    }));
  });

  it('persists a successful comparison with its selected current-period context', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [{ period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false }],
    };
    const filters = { ...createDashboardAnalyticsFilters('2026-07-21'), dateFrom: '2026-07-13', dateTo: '2026-07-19', granularity: 'week' as const };
    useAnalyticsStore.setState({
      dashboardFilters: filters,
      data: { comparison: null, mealPeriods, mealTrend, revenue: selectedRevenue, revenueSources, turnover },
      selectedPeriodByChart: { 'dashboard:revenue': '2026-W29' },
    });

    await useAnalyticsStore.getState().refreshComparison();

    expect(saveCachedAnalytics).toHaveBeenCalledWith('revenue', dashboardAnalyticsCacheScope(filters, 'previous'), expect.objectContaining({
      dashboardComparison: comparison,
      dashboardComparisonContext: {
        comparisonMode: 'previous',
        dateFrom: '2026-07-13',
        dateTo: '2026-07-19',
      },
    }), expect.any(Number));
  });

  it('restores a matching selected-period comparison from the dashboard cache offline', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [{ period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false }],
    };
    const filters = { ...createDashboardAnalyticsFilters('2026-07-21'), dateFrom: '2026-07-13', dateTo: '2026-07-19', granularity: 'week' as const };
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: module === 'revenue'
        ? {
            ...selectedRevenue,
            dashboardComparison: comparison,
            dashboardComparisonContext: { comparisonMode: 'previous', dateFrom: '2026-07-13', dateTo: '2026-07-19' },
          }
        : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover,
      lastSyncedAt: Date.now(),
    }) as never);
    useAnalyticsStore.setState({ dashboardFilters: filters, data: null, dataFilterKey: null, selectedPeriodByChart: { 'dashboard:revenue': '2026-W29' } });
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState().data).toMatchObject({
      comparison,
      comparisonContext: { comparisonMode: 'previous', dateFrom: '2026-07-13', dateTo: '2026-07-19' },
    });
  });

  it('clears a failed selected-period comparison and ignores a mismatched comparison context offline', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [
        { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false },
        { period: '2026-W30', period_start: '2026-07-20', period_end: '2026-07-26', net_income: 3200, order_count: 210, missing: false },
      ],
    };
    const filters = { ...createDashboardAnalyticsFilters('2026-07-28'), dateFrom: '2026-07-13', dateTo: '2026-07-26', granularity: 'week' as const };
    useAnalyticsStore.setState({
      dashboardFilters: filters,
      data: { comparison, mealPeriods, mealTrend, revenue: selectedRevenue, revenueSources, turnover },
      selectedPeriodByChart: { 'dashboard:revenue': '2026-W30' },
    });
    jest.mocked(operationsAnalytics.getOperationsOverview).mockRejectedValueOnce(new Error('comparison failed'));

    await useAnalyticsStore.getState().refreshComparison();

    expect(saveCachedAnalytics).toHaveBeenCalledWith('revenue', dashboardAnalyticsCacheScope(filters, 'previous'), expect.objectContaining({
      dashboardComparison: null,
      dashboardComparisonContext: {
        comparisonMode: 'previous',
        dateFrom: '2026-07-20',
        dateTo: '2026-07-26',
      },
    }), expect.any(Number));

    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: module === 'revenue'
        ? {
            ...selectedRevenue,
            dashboardComparison: comparison,
            dashboardComparisonContext: { comparisonMode: 'previous', dateFrom: '2026-07-13', dateTo: '2026-07-19' },
          }
        : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover,
      lastSyncedAt: Date.now(),
    }) as never);
    useAnalyticsStore.setState({ data: null, dataFilterKey: null });
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState().data?.comparison).toBeNull();
  });

  it('reloads only the selected revenue comparison and ignores an older response', async () => {
    const selectedRevenue = {
      ...revenue,
      points: [
        { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false },
        { period: '2026-W30', period_start: '2026-07-20', period_end: '2026-07-26', net_income: 3200, order_count: 210, missing: false },
      ],
    };
    let resolveFirst: ((value: typeof comparison) => void) | undefined;
    let resolveSecond: ((value: typeof comparison) => void) | undefined;
    jest.mocked(operationsAnalytics.getOperationsOverview)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    useAnalyticsStore.setState({
      data: { comparison: null, mealPeriods, mealTrend, revenue: selectedRevenue, revenueSources, turnover },
      selectedPeriodByChart: { 'dashboard:revenue': '2026-W29' },
    });
    const comparisonState = useAnalyticsStore.getState() as unknown as { refreshComparison?: () => Promise<void> };

    expect(comparisonState.refreshComparison).toEqual(expect.any(Function));
    if (!comparisonState.refreshComparison) return;

    const first = comparisonState.refreshComparison();
    expect(operationsAnalytics.getOperationsOverview).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: '2026-07-13', dateTo: '2026-07-19' }));
    useAnalyticsStore.getState().setSelectedChartPeriod('dashboard:revenue', '2026-W30');
    const second = comparisonState.refreshComparison();
    expect(operationsAnalytics.getOperationsOverview).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: '2026-07-20', dateTo: '2026-07-26' }));
    expect(analyticsApi.getRevenueTrend).not.toHaveBeenCalled();

    resolveFirst?.(comparison);
    await first;
    expect(useAnalyticsStore.getState().data?.comparison).toBeNull();
    resolveSecond?.({ ...comparison, previous_period: { date_from: '2026-07-13', date_to: '2026-07-19' } });
    await second;
    expect(useAnalyticsStore.getState().data?.comparison?.previous_period).toEqual({ date_from: '2026-07-13', date_to: '2026-07-19' });
  });

  it('publishes current dashboard data before a slow comparison resolves', async () => {
    let resolveComparison: ((value: typeof comparison) => void) | undefined;
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    jest.mocked(operationsAnalytics.getOperationsOverview).mockReturnValue(new Promise((resolve) => { resolveComparison = resolve; }));

    const refresh = useAnalyticsStore.getState().refresh();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(operationsAnalytics.getOperationsOverview).toHaveBeenCalledTimes(1);
    expect(useAnalyticsStore.getState()).toMatchObject({
      data: { comparison: null, revenue, revenueSources, mealPeriods, mealTrend, turnover },
      status: 'idle',
    });

    resolveComparison?.(comparison);
    await refresh;
  });

  it('keeps current dashboard data when comparison loading fails', async () => {
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    jest.mocked(operationsAnalytics.getOperationsOverview).mockRejectedValue(new Error('上期接口失败'));

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState()).toMatchObject({
      data: { comparison: null, revenue, revenueSources, mealPeriods, mealTrend, turnover },
      status: 'idle',
    });
    expect(showToast).toHaveBeenCalledWith('上期数据加载失败，已展示当前期数据', 'info');
  });

  it('skips the operations request when dashboard comparison is disabled', async () => {
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    useAnalyticsStore.getState().setComparisonMode('dashboard', 'none');

    await useAnalyticsStore.getState().refresh();

    expect(operationsAnalytics.getOperationsOverview).not.toHaveBeenCalled();
    expect(useAnalyticsStore.getState().data?.comparison).toBeNull();
  });

  it('derives the selected multi-store meal summary from the loaded trend', async () => {
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    useAnalyticsStore.setState({
      dashboardFilters: { dateFrom: '2026-07-15', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['101', '102'] },
    });

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState().data?.mealPeriods).toMatchObject({
      business_date: '2026-07-16',
      periods: expect.arrayContaining([expect.objectContaining({ net_income: 1200, period_key: 'lunch' })]),
      store_key: 'ALL',
    });
  });

  it('distinguishes forced refresh from ordinary refresh while the request is pending', async () => {
    let resolveRevenue: ((value: typeof revenue) => void) | undefined;
    jest.mocked(analyticsApi.getRevenueTrend).mockReturnValue(new Promise((resolve) => { resolveRevenue = resolve; }));
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    useAnalyticsStore.setState({ data: { comparison: null, revenue, revenueSources, mealPeriods, mealTrend, turnover } });

    const refresh = useAnalyticsStore.getState().refresh(true);
    expect(useAnalyticsStore.getState().status).toBe('force-refreshing');

    resolveRevenue?.(revenue);
    await refresh;
    expect(useAnalyticsStore.getState()).toMatchObject({
      dataFilterKey: serializeAnalyticsFilters(useAnalyticsStore.getState().dashboardFilters),
      dataSource: 'network',
      status: 'idle',
    });
  });

  it('marks cached fallback data as offline cache', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    for (const request of [analyticsApi.getRevenueTrend, analyticsApi.getMealPeriods, analyticsApi.getMealPeriodTrend, analyticsApi.getMealPeriodTurnover]) {
      jest.mocked(request).mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    }
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: module === 'revenue' ? revenue : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover,
      lastSyncedAt: cachedAt,
    }) as never);

    await useAnalyticsStore.getState().refresh();

    expect(useAnalyticsStore.getState()).toMatchObject({ dataSource: 'offline-cache', isOffline: true });
  });

  it('reads cached dashboard without starting requests when the device is offline', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    jest.mocked(readCachedAnalytics).mockImplementation(async (module) => ({
      data: module === 'revenue' ? revenue : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover,
      lastSyncedAt: cachedAt,
    }) as never);
    jest.mocked(analyticsApi.getRevenueTrend).mockResolvedValue(revenue);
    jest.mocked(analyticsApi.getMealPeriods).mockResolvedValue(mealPeriods);
    jest.mocked(analyticsApi.getMealPeriodTrend).mockResolvedValue(mealTrend);
    jest.mocked(analyticsApi.getMealPeriodTurnover).mockResolvedValue(turnover);
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(analyticsApi.getRevenueTrend).not.toHaveBeenCalled();
    expect(analyticsApi.getMealPeriods).not.toHaveBeenCalled();
    expect(analyticsApi.getMealPeriodTrend).not.toHaveBeenCalled();
    expect(analyticsApi.getMealPeriodTurnover).not.toHaveBeenCalled();
    expect(useAnalyticsStore.getState()).toMatchObject({ dataSource: 'offline-cache', isOffline: true, lastSyncedAt: cachedAt });
  });

  it('restores each dashboard cache scope independently after switching filters offline', async () => {
    const firstFilters = useAnalyticsStore.getState().dashboardFilters;
    const secondFilters = { ...firstFilters, dateFrom: '2026-07-20', dateTo: '2026-07-21', storeKey: '101', storeKeys: ['101'] };
    const firstScope = dashboardAnalyticsCacheScope(firstFilters, 'previous');
    const secondScope = dashboardAnalyticsCacheScope(secondFilters, 'previous');
    const firstRevenue = { ...revenue, date_from: firstFilters.dateFrom, date_to: firstFilters.dateTo };
    const secondRevenue = { ...revenue, date_from: secondFilters.dateFrom, date_to: secondFilters.dateTo, store_key: '101' };
    const cachedByScope = new Map([[firstScope, firstRevenue], [secondScope, secondRevenue]]);
    jest.mocked(readCachedAnalytics).mockImplementation(async (module, scope) => {
      const cachedRevenue = cachedByScope.get(scope);
      if (!cachedRevenue) return null;
      const data = module === 'revenue' ? cachedRevenue : module === 'revenueSources' ? revenueSources : module === 'mealPeriods' ? mealPeriods : module === 'mealPeriodTrend' ? mealTrend : turnover;
      return { data, lastSyncedAt: Date.now() } as never;
    });
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();
    expect(useAnalyticsStore.getState().data?.revenue).toEqual(firstRevenue);

    useAnalyticsStore.setState({ dashboardFilters: secondFilters, data: null, dataFilterKey: null });
    await useAnalyticsStore.getState().refresh();
    expect(useAnalyticsStore.getState().data?.revenue).toEqual(secondRevenue);

    useAnalyticsStore.setState({ dashboardFilters: firstFilters, data: null, dataFilterKey: null });
    await useAnalyticsStore.getState().refresh();
    expect(useAnalyticsStore.getState().data?.revenue).toEqual(firstRevenue);
  });

  it('treats the legacy bare dashboard scope as a cache miss when offline', async () => {
    const filters = useAnalyticsStore.getState().dashboardFilters;
    const legacyScope = serializeAnalyticsFilters(filters);
    jest.mocked(readCachedAnalytics).mockImplementation(async (_module, scope) => scope === legacyScope ? {
      data: revenue,
      lastSyncedAt: Date.now(),
    } as never : null);
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(readCachedAnalytics).not.toHaveBeenCalledWith('revenue', legacyScope, expect.any(Number));
    expect(useAnalyticsStore.getState()).toMatchObject({ data: null, dataSource: null, isOffline: true, status: 'idle' });
  });

  it('does not reuse in-memory dashboard data after an offline filter scope change', async () => {
    const oldFilters = createDashboardAnalyticsFilters('2026-07-17');
    const nextFilters = { ...oldFilters, scopeKeys: ['shop:101'], storeKey: '101', storeKeys: ['101'] };
    useAnalyticsStore.setState({
      dashboardFilters: nextFilters,
      data: { comparison, mealPeriods, mealTrend, revenue, revenueSources, turnover },
      dataFilterKey: serializeAnalyticsFilters(oldFilters),
    });
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(readCachedAnalytics).toHaveBeenCalledWith('revenue', dashboardAnalyticsCacheScope(nextFilters, 'previous'), expect.any(Number));
    expect(useAnalyticsStore.getState()).toMatchObject({ data: null, dataSource: null, isOffline: true, status: 'idle' });
  });

  it('does not reuse in-memory dashboard data when its comparison context is unavailable', async () => {
    const filters = createDashboardAnalyticsFilters('2026-07-17');
    useAnalyticsStore.setState({
      dashboardFilters: filters,
      data: { comparison, mealPeriods, mealTrend, revenue, revenueSources, turnover },
      dataFilterKey: serializeAnalyticsFilters(filters),
    });
    jest.mocked(readCachedAnalytics).mockResolvedValue(null);
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(readCachedAnalytics).toHaveBeenCalledWith('revenue', dashboardAnalyticsCacheScope(filters, 'previous'), expect.any(Number));
    expect(useAnalyticsStore.getState()).toMatchObject({ data: null, dataSource: null, isOffline: true, status: 'idle' });
  });

  it('reuses matching dashboard data without comparison after switching comparison mode off offline', async () => {
    const filters = createDashboardAnalyticsFilters('2026-07-17');
    useAnalyticsStore.setState({
      dashboardFilters: filters,
      data: {
        comparison,
        comparisonContext: { comparisonMode: 'previous', dateFrom: filters.dateFrom, dateTo: filters.dateTo },
        mealPeriods,
        mealTrend,
        revenue,
        revenueSources,
        turnover,
      },
      dataFilterKey: serializeAnalyticsFilters(filters),
    });
    useAnalyticsStore.getState().setComparisonMode('dashboard', 'none');
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().refresh();

    expect(readCachedAnalytics).not.toHaveBeenCalled();
    expect(useAnalyticsStore.getState()).toMatchObject({
      data: {
        comparison: null,
        comparisonContext: { comparisonMode: 'none', dateFrom: filters.dateFrom, dateTo: filters.dateTo },
      },
      dataSource: 'offline-cache',
      status: 'idle',
    });
  });

  it('reads cached confirmed stores without starting a request when the device is offline', async () => {
    const stores = [{ key: '101', label: '茅坡店' }];
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: stores, lastSyncedAt: 10 });
    useNetworkStore.setState({ status: 'offline' });

    await useAnalyticsStore.getState().loadStores();

    expect(analyticsApi.listShopMappings).not.toHaveBeenCalled();
    expect(readCachedAnalytics).toHaveBeenCalledWith('shopMappings', 'confirmed', expect.any(Number));
    expect(useAnalyticsStore.getState().stores).toEqual(stores);
  });

  it('falls back to cached confirmed stores after a temporary network failure', async () => {
    const stores = [{ key: '102', label: '凤城十二路店' }];
    jest.mocked(analyticsApi.listShopMappings).mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: stores, lastSyncedAt: 10 });

    const loaded = await useAnalyticsStore.getState().loadStores();

    expect(useAnalyticsStore.getState().stores).toEqual(stores);
    expect(loaded).toBe(false);
  });

  it('keeps cached confirmed stores when the service returns an HTTP error', async () => {
    const stores = [{ key: '103', label: '台北湾店' }];
    jest.mocked(analyticsApi.listShopMappings).mockRejectedValue(new Error('请求失败（500）'));
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: stores, lastSyncedAt: 10 });

    await useAnalyticsStore.getState().loadStores();

    expect(useAnalyticsStore.getState().stores).toEqual(stores);
  });

  it('caches confirmed stores after a successful request', async () => {
    jest.mocked(analyticsApi.listShopMappings).mockResolvedValue([
      { shiheng_shop_id: 'h12351556670', shiheng_shop_name: '茅坡店', status: 'confirmed' },
      { shiheng_shop_id: 'h12351556671', shiheng_shop_name: '待确认店', status: 'pending' },
    ] as never);

    const loaded = await useAnalyticsStore.getState().loadStores();

    expect(saveCachedAnalytics).toHaveBeenCalledWith('shopMappings', 'confirmed', [{ key: 'h12351556670', label: '茅坡店' }], expect.any(Number));
    expect(loaded).toBe(true);
  });

  it('loads and caches the department scope tree', async () => {
    const scopeTree = [{
      key: 'dept:north',
      type: 'department' as const,
      label: '北区',
      children: [{ key: 'shop:101', type: 'store' as const, label: '茅坡店', store_key: '101', department_id: 'north' }],
    }];
    jest.mocked(analyticsApi.listStoreScopeTree).mockResolvedValue({ nodes: scopeTree, source: 'projection', store_count: 1 });

    await expect(useAnalyticsStore.getState().loadScopes()).resolves.toBe(true);

    expect(useAnalyticsStore.getState().scopeTree).toEqual(scopeTree);
    expect(saveCachedAnalytics).toHaveBeenCalledWith('storeScopeTree', 'current', scopeTree, expect.any(Number));
  });

  it('resolves explicit department scopes to request store keys when filters are applied', () => {
    useAnalyticsStore.setState({
      scopeTree: [{
        key: 'dept:north',
        type: 'department',
        label: '北区',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }],
    });

    useAnalyticsStore.getState().setDashboardFilters({
      ...useAnalyticsStore.getState().dashboardFilters,
      scopeKeys: ['dept:north'],
      storeKey: 'ALL',
      storeKeys: ['ALL'],
    });

    expect(useAnalyticsStore.getState().dashboardFilters).toMatchObject({
      scopeKeys: ['dept:north'],
      storeKey: 'ALL',
      storeKeys: ['101', '102'],
    });
  });

  it('removes hidden meal series IDs that are no longer available after a chart switch', () => {
    useAnalyticsStore.setState({
      hiddenSeriesByChart: { 'meal:business:lunch': ['meal:business:lunch', 'meal:business:lunch:ma7'] },
    });

    useAnalyticsStore.getState().syncSeriesVisibility('meal:business:lunch', ['scope:dept:north']);

    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({});
  });

  it('keeps shared insight filters independent from dashboard scope filters', () => {
    const shared = { ...createAnalyticsFilters('2026-07-17'), storeKey: '201', storeKeys: ['201'] };
    const dashboard = { ...createDashboardAnalyticsFilters('2026-07-17'), granularity: 'month' as const, scopeKeys: ['dept:north'] };

    useAnalyticsStore.getState().setFilters(shared);
    useAnalyticsStore.getState().setDashboardFilters(dashboard);

    expect(useAnalyticsStore.getState().filters).toEqual(shared);
    expect(useAnalyticsStore.getState().dashboardFilters).toEqual(dashboard);
  });

  it('keeps dashboard, product, and labor filter states independent', () => {
    const dashboard = { ...createDashboardAnalyticsFilters('2026-07-17'), scopeKeys: ['dept:north'], storeKeys: ['101'] };
    const product = { ...createAnalyticsFilters('2026-07-17'), dateFrom: '2026-06-01', dateTo: '2026-06-30', granularity: 'month' as const, includeCurrent: false, scopeKeys: ['dept:south'], storeKeys: ['201'] };
    const labor = { ...createAnalyticsFilters('2026-07-17'), dateFrom: '2026-07-13', dateTo: '2026-07-19', granularity: 'week' as const, includeCurrent: true, scopeKeys: ['dept:east'], storeKeys: ['301'] };

    useAnalyticsStore.getState().setDashboardFilters(dashboard);
    useAnalyticsStore.getState().setProductFilters(product);
    useAnalyticsStore.getState().setLaborFilters(labor);

    expect(useAnalyticsStore.getState()).toMatchObject({ dashboardFilters: dashboard, productFilters: product, laborFilters: labor });

    useAnalyticsStore.getState().resetProductFilters();

    expect(useAnalyticsStore.getState().productFilters).toMatchObject({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      granularity: 'week',
      includeCurrent: false,
    });
    expect(useAnalyticsStore.getState()).toMatchObject({ dashboardFilters: dashboard, laborFilters: labor });

    useAnalyticsStore.getState().resetLaborFilters();

    expect(useAnalyticsStore.getState().laborFilters).toEqual(createAnalyticsFilters());
    expect(useAnalyticsStore.getState().dashboardFilters).toEqual(dashboard);
  });

  it('keeps order filters and dimensions isolated from other analytics modules', () => {
    const dashboard = { ...createDashboardAnalyticsFilters('2026-07-17'), scopeKeys: ['dept:north'] };
    const product = { ...createAnalyticsFilters('2026-07-17'), granularity: 'month' as const };
    const labor = { ...createAnalyticsFilters('2026-07-17'), granularity: 'week' as const };
    const order = {
      ...createOrderAnalyticsFilters('2026-07-17'),
      orderDimensions: ['platform', 'channel'] as Array<'platform' | 'channel'>,
      sourceType: 'takeout' as const,
    };

    useAnalyticsStore.getState().setDashboardFilters(dashboard);
    useAnalyticsStore.getState().setProductFilters(product);
    useAnalyticsStore.getState().setLaborFilters(labor);
    useAnalyticsStore.getState().setOrderDimensions(['platform', 'channel']);

    expect(useAnalyticsStore.getState().orderDimensions).toEqual(['platform']);
    expect(useAnalyticsStore.getState().orderFilters.orderDimensions).toEqual(['platform']);
    expect(serializeAnalyticsFilters(useAnalyticsStore.getState().orderFilters)).toContain('order_dimensions=platform');
    expect(serializeAnalyticsFilters(useAnalyticsStore.getState().orderFilters)).not.toContain('order_dimensions=channel');

    useAnalyticsStore.getState().setOrderFilters(order);

    expect(useAnalyticsStore.getState()).toMatchObject({
      dashboardFilters: dashboard,
      laborFilters: labor,
      orderDimensions: ['platform'],
      orderFilters: { ...order, orderDimensions: ['platform'] },
      productFilters: product,
    });
    expect(serializeAnalyticsFilters(useAnalyticsStore.getState().orderFilters)).toContain('order_dimensions=platform');
    expect(serializeAnalyticsFilters(useAnalyticsStore.getState().orderFilters)).not.toContain('order_dimensions=channel');

    useAnalyticsStore.getState().resetOrderFilters();

    expect(useAnalyticsStore.getState()).toMatchObject({
      dashboardFilters: dashboard,
      laborFilters: labor,
      orderDimensions: [],
      orderFilters: createOrderAnalyticsFilters('2026-07-21'),
      productFilters: product,
    });
  });

  it('initializes and resets product filters to five complete weeks', () => {
    useAnalyticsStore.getState().resetProductFilters();
    expect(useAnalyticsStore.getState().productFilters).toMatchObject({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      granularity: 'week',
      includeCurrent: false,
    });

    useAnalyticsStore.getState().setProductFilters({
      ...createAnalyticsFilters('2026-07-22'),
      dateFrom: '2026-07-21',
      dateTo: '2026-07-21',
      granularity: 'day',
    });
    useAnalyticsStore.getState().resetProductFilters();

    expect(useAnalyticsStore.getState().productFilters).toMatchObject({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      granularity: 'week',
      includeCurrent: false,
    });
  });

  it('builds stable versioned module cache keys from explicit scopes', () => {
    const first = { ...createAnalyticsFilters('2026-07-17'), scopeKeys: ['dept:north', 'dept:east'], storeKeys: ['102', '101', '102'] };
    const second = { ...createAnalyticsFilters('2026-07-17'), scopeKeys: ['dept:east', 'dept:north', 'dept:east'], storeKeys: ['101', '102'] };

    expect(productAnalyticsCacheKey(first, { dimKey: 'takeout', dimType: 'channel' }, 'p-1')).toBe(productAnalyticsCacheKey(second, { dimKey: 'takeout', dimType: 'channel' }, 'p-1'));
    expect(laborAnalyticsCacheKey(first, 'efficiency', ['102', '101', '102'])).toBe(laborAnalyticsCacheKey(second, 'efficiency', ['101', '102']));
    expect(productAnalyticsCacheKey(first, { dimKey: 'takeout', dimType: 'channel' }, 'p-1')).not.toBe(`${serializeAnalyticsFilters(first)}:channel:takeout:product-dashboard-v2`);
    expect(laborAnalyticsCacheKey(first, 'efficiency', ['101', '102'])).not.toBe(`${serializeAnalyticsFilters(first)}:labor-dashboard-v2`);
  });

  it('keys raw analytics data by every normalized data filter but not display state', () => {
    const filters: AnalyticsFilters = {
      ...createAnalyticsFilters('2026-07-17'),
      granularity: 'week' as const,
      orderDimensions: ['shop', 'channel'],
      scopeKeys: ['dept:north'],
      sourceType: 'takeout' as const,
      storeKeys: ['102', '101'],
    };

    const product = productAnalyticsCacheKey(filters, { dimKey: 'takeout', dimType: 'channel' }, ['p-2', 'p-1'], 'previous');
    const labor = laborAnalyticsCacheKey(filters, 'hours', ['dept-2', 'dept-1'], 'none');

    expect(product).toMatch(/^product-dashboard-v4:/);
    expect(product).toContain('comparison_mode=previous');
    expect(product).toContain('product_keys=p-1%2Cp-2');
    expect(product).toContain('order_dimensions=channel');
    expect(labor).toMatch(/^labor-dashboard-v5:/);
    expect(labor).toContain('comparison_mode=none');
    expect(labor).toContain('department_keys=dept-1');
    expect(labor).toContain('department_keys=dept-2');
    expect(dashboardAnalyticsCacheScope(filters, 'previous')).toMatch(/^dashboard-v4:.*comparison_mode=previous/);
    expect(orderAnalyticsCacheScope(filters, 'none')).toMatch(/^orders-v2:.*comparison_mode=none/);
    expect(product).not.toContain('display_mode');
  });

  it('persists legend visibility by chart and never hides the final visible series', () => {
    const store = useAnalyticsStore.getState();

    store.toggleSeriesVisibility('revenue:net', ['revenue:net', 'revenue:ma7'], 'revenue:ma7');
    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({ 'revenue:net': ['revenue:ma7'] });

    useAnalyticsStore.getState().toggleSeriesVisibility('revenue:net', ['revenue:net', 'revenue:ma7'], 'revenue:net');
    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({ 'revenue:net': ['revenue:ma7'] });

    useAnalyticsStore.getState().toggleSeriesVisibility('revenue:net', ['revenue:net', 'revenue:ma7'], 'revenue:ma7');
    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({ 'revenue:net': [] });
  });

  it('persists a chart period and series as one point selection', () => {
    useAnalyticsStore.getState().setSelectedChartSelection('product:trend', { period: '2026-W27', seriesId: 'scope:south' });

    expect(useAnalyticsStore.getState().selectedPeriodByChart).toEqual({ 'product:trend': '2026-W27' });
    expect(useAnalyticsStore.getState().selectedSeriesByChart).toEqual({ 'product:trend': 'scope:south' });
  });
});

function mealTrendPoint(date: string) {
  const row = (period_key: 'breakfast' | 'lunch' | 'afternoon_tea' | 'dinner' | 'late_night', period_label: string) => ({
    avg_order_value: 0,
    income_amount: 0,
    net_income: period_key === 'lunch' ? 1200 : 0,
    order_count: period_key === 'lunch' ? 80 : 0,
    paid_amount: 0,
    period_key,
    period_label,
    refund_amount: 0,
  });
  return {
    date,
    afternoon_tea: row('afternoon_tea', '下午茶'),
    breakfast: row('breakfast', '早餐'),
    dinner: row('dinner', '晚餐'),
    late_night: row('late_night', '夜宵'),
    lunch: row('lunch', '午餐'),
  };
}
