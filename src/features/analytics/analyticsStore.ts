import { create } from 'zustand';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { getDashboardAnalytics, getMealPeriods, listShopMappings, listStoreScopeTree, type MealPeriodKey, type MealPeriodTrendPoint, type MealPeriodTrendResult, type MealPeriodTurnoverResult, type MealPeriodsResult, type RevenueTrendResult } from '@/services/api/analytics';
import { getOperationsOverview, type OperationsOverview } from '@/services/api/operationsAnalytics';
import { showToast } from '@/components/feedback/AppToast';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { isDeviceOffline } from '@/services/network/networkStore';
import { beijingToday } from '@/utils/time';
import { createAnalyticsFilters, createAnalyticsRequestGate, createDashboardAnalyticsFilters, dashboardAnalyticsCacheScope, selectedAnalyticsStoreKeys, serializeAnalyticsFilters, storeKeyForSelection, type AnalyticsFilters } from './analyticsFilters';
import { createOrderAnalyticsFilters, normalizeOrderDimensions, type OrderDimension } from './orderAnalytics';
import { resolveStoreScopeSelection, type StoreScopeNode } from './storeScope';
import { defaultTrendRange } from './trendPeriod';
import { DEFAULT_COMPARISON_DISPLAY_MODES, DEFAULT_COMPARISON_MODES, type ComparisonDisplayMode, type ComparisonModule } from './periodComparison';
import type { ComparisonMode } from '@/services/api/operationsAnalytics';

type RevenueSources = { shop: RevenueTrendResult; takeout: RevenueTrendResult };
type DashboardComparisonContext = { comparisonMode: ComparisonMode; dateFrom: string; dateTo: string };
type DashboardData = { comparison: OperationsOverview | null; comparisonContext?: DashboardComparisonContext; mealPeriods: MealPeriodsResult; mealTrend: MealPeriodTrendResult; revenue: RevenueTrendResult; revenueSources: RevenueSources; turnover: MealPeriodTurnoverResult };
type AnalyticsDataSource = 'network' | 'local-cache' | 'offline-cache' | null;
type AnalyticsStatus = 'idle' | 'loading' | 'refreshing' | 'force-refreshing' | 'error';
type MealStatus = 'idle' | 'loading' | 'error';
export type AnalyticsStoreOption = { key: string; label: string };

function createProductAnalyticsFilters(today = beijingToday()): AnalyticsFilters {
  return {
    ...createAnalyticsFilters(today),
    ...defaultTrendRange('week', today),
    granularity: 'week',
  };
}

type AnalyticsState = {
  comparisonDisplayModeByModule: Record<ComparisonModule, ComparisonDisplayMode>;
  comparisonModeByModule: Record<ComparisonModule, ComparisonMode>;
  data: DashboardData | null;
  dataFilterKey: string | null;
  dataSource: AnalyticsDataSource;
  dashboardFilters: AnalyticsFilters;
  error: string | null;
  filters: AnalyticsFilters;
  hiddenSeriesByChart: Record<string, string[]>;
  isOffline: boolean;
  lastSyncedAt: number | null;
  laborFilters: AnalyticsFilters;
  loadScopes: () => Promise<boolean>;
  loadStores: () => Promise<boolean>;
  mealStatus: MealStatus;
  orderDimensions: OrderDimension[];
  orderFilters: AnalyticsFilters;
  productFilters: AnalyticsFilters;
  reset: () => void;
  resetLaborFilters: () => void;
  resetOrderFilters: () => void;
  resetProductFilters: () => void;
  selectedProductKeys: string[];
  selectedPeriodByChart: Record<string, string>;
  selectedSeriesByChart: Record<string, string>;
  selectedMealDate: string | null;
  selectMealDate: (businessDate: string) => Promise<void>;
  status: AnalyticsStatus;
  scopeTree: StoreScopeNode[];
  stores: AnalyticsStoreOption[];
  syncSeriesVisibility: (chartKey: string, seriesIds: string[]) => void;
  toggleSeriesVisibility: (chartKey: string, seriesIds: string[], seriesId: string) => void;
  refresh: (forceRefresh?: boolean) => Promise<void>;
  refreshComparison: (forceRefresh?: boolean) => Promise<void>;
  setFilters: (filters: AnalyticsFilters) => void;
  setDashboardFilters: (filters: AnalyticsFilters) => void;
  setComparisonDisplayMode: (module: ComparisonModule, mode: ComparisonDisplayMode) => void;
  setComparisonMode: (module: ComparisonModule, mode: ComparisonMode) => void;
  setLaborFilters: (filters: AnalyticsFilters) => void;
  setOrderDimensions: (dimensions: OrderDimension[]) => void;
  setOrderFilters: (filters: AnalyticsFilters) => void;
  setProductFilters: (filters: AnalyticsFilters) => void;
  setSelectedProductKeys: (keys: string[]) => void;
  setSelectedChartPeriod: (chartKey: string, period: string) => void;
  setSelectedChartSelection: (chartKey: string, selection: { period: string; seriesId?: string }) => void;
};

const requestGate = createAnalyticsRequestGate();
const comparisonRequestGate = createAnalyticsRequestGate();
const mealRequestGate = createAnalyticsRequestGate();
const scopeRequestGate = createAnalyticsRequestGate();
const storeRequestGate = createAnalyticsRequestGate();

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  comparisonDisplayModeByModule: { ...DEFAULT_COMPARISON_DISPLAY_MODES },
  comparisonModeByModule: { ...DEFAULT_COMPARISON_MODES },
  data: null,
  dataFilterKey: null,
  dataSource: null,
  dashboardFilters: createDashboardAnalyticsFilters(),
  error: null,
  filters: createAnalyticsFilters(),
  hiddenSeriesByChart: {},
  isOffline: false,
  lastSyncedAt: null,
  laborFilters: createAnalyticsFilters(),
  loadScopes: async () => {
    const request = scopeRequestGate.begin();
    const readCache = async () => {
      const cached = await readCachedAnalytics<StoreScopeNode[]>('storeScopeTree', 'current', Date.now()).catch(() => null);
      if (!scopeRequestGate.isCurrent(request) || !cached || !isScopeTree(cached.data)) return false;
      set({ scopeTree: cached.data });
      return true;
    };
    if (isDeviceOffline()) {
      await readCache();
      return false;
    }
    try {
      const response = await listStoreScopeTree({ signal: request.signal });
      if (!scopeRequestGate.isCurrent(request)) return false;
      set({ scopeTree: response.nodes });
      void saveCachedAnalytics('storeScopeTree', 'current', response.nodes, Date.now()).catch(() => {});
      return true;
    } catch {
      if (!scopeRequestGate.isCurrent(request)) return false;
      if (await readCache()) return false;
      set({ scopeTree: [] });
      return false;
    }
  },
  loadStores: async () => {
    const request = storeRequestGate.begin();
    const readCache = async () => {
      const cached = await readCachedAnalytics<AnalyticsStoreOption[]>('shopMappings', 'confirmed', Date.now()).catch(() => null);
      if (!storeRequestGate.isCurrent(request) || !cached || !isStoreOptions(cached.data)) return false;
      set({ stores: cached.data });
      return true;
    };
    if (isDeviceOffline()) {
      await readCache();
      return false;
    }
    try {
      const mappings = await listShopMappings();
      if (!storeRequestGate.isCurrent(request)) return false;
      const stores = mappings
        .filter((mapping) => mapping.status === 'confirmed' && mapping.shiheng_shop_name)
        .map((mapping) => ({ key: String(mapping.shiheng_shop_id), label: mapping.shiheng_shop_name as string }));
      set({ stores });
      void saveCachedAnalytics('shopMappings', 'confirmed', stores, Date.now()).catch(() => {});
      return true;
    } catch (error) {
      if (!storeRequestGate.isCurrent(request)) return false;
      if (await readCache()) return false;
      set({ stores: [] });
      return false;
    }
  },
  mealStatus: 'idle',
  orderDimensions: [],
  orderFilters: createOrderAnalyticsFilters(),
  productFilters: createProductAnalyticsFilters(),
  selectedProductKeys: [],
  resetLaborFilters: () => set({ laborFilters: createAnalyticsFilters() }),
  resetOrderFilters: () => set({ orderDimensions: [], orderFilters: createOrderAnalyticsFilters() }),
  resetProductFilters: () => set({ productFilters: createProductAnalyticsFilters(), selectedProductKeys: [] }),
  reset: () => {
    requestGate.invalidate();
    comparisonRequestGate.invalidate();
    mealRequestGate.invalidate();
    scopeRequestGate.invalidate();
    storeRequestGate.invalidate();
    set({
      comparisonDisplayModeByModule: { ...DEFAULT_COMPARISON_DISPLAY_MODES },
      comparisonModeByModule: { ...DEFAULT_COMPARISON_MODES },
      data: null,
      dataFilterKey: null,
      dataSource: null,
      dashboardFilters: createDashboardAnalyticsFilters(),
      error: null,
      filters: createAnalyticsFilters(),
      hiddenSeriesByChart: {},
      isOffline: false,
      lastSyncedAt: null,
      laborFilters: createAnalyticsFilters(),
      mealStatus: 'idle',
      orderDimensions: [],
      orderFilters: createOrderAnalyticsFilters(),
      productFilters: createProductAnalyticsFilters(),
      selectedProductKeys: [],
      scopeTree: [],
      selectedPeriodByChart: {},
      selectedSeriesByChart: {},
      selectedMealDate: null,
      status: 'idle',
      stores: [],
    });
  },
  selectedPeriodByChart: {},
  selectedSeriesByChart: {},
  selectedMealDate: null,
  selectMealDate: async (businessDate) => {
    const state = useAnalyticsStore.getState();
    if (!state.data || isDeviceOffline() || state.selectedMealDate === businessDate) return;
    const trendPoint = state.data.mealTrend.points.find((point) => point.date === businessDate);
    if (trendPoint) {
      set({
        data: { ...state.data, mealPeriods: mealPeriodsFromTrend(trendPoint, state.dashboardFilters.storeKey) },
        mealStatus: 'idle',
        selectedMealDate: businessDate,
      });
      return;
    }
    const request = mealRequestGate.begin();
    set({ mealStatus: 'loading', selectedMealDate: businessDate });
    try {
      const mealPeriods = await getMealPeriods({ ...state.dashboardFilters, dateTo: businessDate }, { signal: request.signal });
      if (!mealRequestGate.isCurrent(request)) return;
      const current = useAnalyticsStore.getState().data;
      if (!current) return;
      const data = { ...current, mealPeriods };
      set({ data, mealStatus: 'idle' });
    } catch (error) {
      if (!mealRequestGate.isCurrent(request)) return;
      set({ error: error instanceof Error ? error.message : '餐段数据加载失败，请稍后重试', mealStatus: 'error' });
    }
  },
  status: 'idle',
  scopeTree: [],
  stores: [],
  syncSeriesVisibility: (chartKey, seriesIds) => {
    const availableIds = new Set(seriesIds);
    set((state) => {
      const current = state.hiddenSeriesByChart[chartKey] ?? [];
      const next = current.filter((id) => availableIds.has(id));
      if (next.length === current.length) return state;
      const hiddenSeriesByChart = { ...state.hiddenSeriesByChart };
      if (next.length) hiddenSeriesByChart[chartKey] = next;
      else delete hiddenSeriesByChart[chartKey];
      return { hiddenSeriesByChart };
    });
  },
  toggleSeriesVisibility: (chartKey, seriesIds, seriesId) => {
    const uniqueIds = [...new Set(seriesIds)];
    if (!uniqueIds.includes(seriesId)) return;
    const current = (useAnalyticsStore.getState().hiddenSeriesByChart[chartKey] ?? []).filter((id) => uniqueIds.includes(id));
    const hidden = current.includes(seriesId);
    if (!hidden && uniqueIds.filter((id) => !current.includes(id)).length <= 1) return;
    const next = hidden ? current.filter((id) => id !== seriesId) : [...current, seriesId];
    set((state) => ({ hiddenSeriesByChart: { ...state.hiddenSeriesByChart, [chartKey]: next } }));
  },
  refresh: async (forceRefresh = false) => {
    const state = useAnalyticsStore.getState();
    const filters = state.dashboardFilters;
    const comparisonMode = state.comparisonModeByModule.dashboard;
    const request = requestGate.begin();
    comparisonRequestGate.invalidate();
    set({
      error: null,
      status: forceRefresh
        ? 'force-refreshing'
        : useAnalyticsStore.getState().data ? 'refreshing' : 'loading',
    });
    if (isDeviceOffline()) {
      const current = useAnalyticsStore.getState();
      if (current.data) {
        const expectedContext = dashboardComparisonContextFor(current.data.revenue, current.selectedPeriodByChart, filters, comparisonMode);
        if (current.dataFilterKey === serializeAnalyticsFilters(filters)
          && matchesDashboardComparisonContext(current.data.comparisonContext, expectedContext)) {
          set({ dataSource: 'offline-cache', error: null, isOffline: true, status: 'idle' });
          return;
        }
      }
      const cached = await readCachedDashboard(new Error(NETWORK_ERROR_MESSAGE), filters, comparisonMode, current.selectedPeriodByChart);
      if (!requestGate.isCurrent(request)) return;
      if (cached) {
        set({ data: cached.data, dataFilterKey: serializeAnalyticsFilters(filters), dataSource: 'offline-cache', error: null, isOffline: true, lastSyncedAt: cached.lastSyncedAt, mealStatus: 'idle', selectedMealDate: cached.data.mealPeriods.business_date, status: 'idle' });
      } else {
        set({ data: null, dataFilterKey: null, dataSource: null, error: null, isOffline: true, status: 'idle' });
      }
      return;
    }
    const cached = forceRefresh ? null : await readCachedDashboard(null, filters, comparisonMode, state.selectedPeriodByChart);
    if (!requestGate.isCurrent(request)) return;
    if (cached) {
      const fresh = isAnalyticsSnapshotFresh(cached.lastSyncedAt);
      set({
        data: cached.data,
        dataFilterKey: serializeAnalyticsFilters(filters),
        dataSource: 'local-cache',
        error: null,
        isOffline: false,
        lastSyncedAt: cached.lastSyncedAt,
        mealStatus: 'idle',
        selectedMealDate: cached.data.mealPeriods.business_date,
        status: fresh ? 'idle' : 'refreshing',
      });
      if (fresh) return;
    }
    try {
      if (forceRefresh) await clearCachedDashboard(filters, comparisonMode);
      const { revenue, revenueSources, mealPeriods, mealTrend, turnover } = await getDashboardAnalytics(
        filters,
        { forceRefresh, signal: request.signal },
      );
      if (!requestGate.isCurrent(request)) return;
      const selectedMealPeriods = resolveMealPeriods(mealPeriods, mealTrend, filters);
      const data = { comparison: null, comparisonContext: dashboardComparisonContextFor(revenue, useAnalyticsStore.getState().selectedPeriodByChart, filters, comparisonMode), revenue, revenueSources, mealPeriods: selectedMealPeriods, mealTrend, turnover };
      set({ data, dataFilterKey: serializeAnalyticsFilters(filters), dataSource: 'network', error: null, isOffline: false, lastSyncedAt: Date.now(), mealStatus: 'idle', selectedMealDate: selectedMealPeriods.business_date, status: 'idle' });
      saveCachedDashboard(data, filters, comparisonMode);
      void useAnalyticsStore.getState().refreshComparison(forceRefresh);
    } catch (error) {
      if (!requestGate.isCurrent(request)) return;
      const cached = await readCachedDashboard(error, filters, comparisonMode, useAnalyticsStore.getState().selectedPeriodByChart);
      if (!requestGate.isCurrent(request)) return;
      if (cached) {
        set({ data: cached.data, dataFilterKey: serializeAnalyticsFilters(filters), dataSource: 'offline-cache', error: null, isOffline: true, lastSyncedAt: cached.lastSyncedAt, mealStatus: 'idle', selectedMealDate: cached.data.mealPeriods.business_date, status: 'idle' });
        return;
      }
      await clearCachedDashboard(filters, comparisonMode).catch(() => {});
      set({ data: null, dataFilterKey: null, dataSource: null, error: error instanceof Error ? error.message : '经营数据加载失败，请稍后重试', isOffline: false, lastSyncedAt: null, mealStatus: 'idle', selectedMealDate: null, status: 'error' });
    }
  },
  refreshComparison: async (forceRefresh = false) => {
    const state = useAnalyticsStore.getState();
    if (!state.data || isDeviceOffline() || state.comparisonModeByModule.dashboard === 'none') return;
    const request = comparisonRequestGate.begin();
    const { comparisonModeByModule, dashboardFilters: filters, data, selectedPeriodByChart } = state;
    const comparisonMode = comparisonModeByModule.dashboard;
    const context = dashboardComparisonContextFor(data.revenue, selectedPeriodByChart, filters, comparisonMode);
    const cleared = { ...data, comparison: null, comparisonContext: context };
    set({ data: cleared });
    saveCachedDashboard(cleared, filters, comparisonMode);
    try {
      const comparison = await getOperationsOverview({
        compare: comparisonMode,
        dateFrom: context.dateFrom,
        dateTo: context.dateTo,
        granularity: filters.granularity ?? 'day',
        refresh: forceRefresh,
        signal: request.signal,
        storeKeys: selectedAnalyticsStoreKeys(filters),
      });
      if (!comparisonRequestGate.isCurrent(request)) return;
      const current = useAnalyticsStore.getState().data;
      if (current) {
        const next = { ...current, comparison, comparisonContext: context };
        set({ data: next });
        saveCachedDashboard(next, filters, comparisonMode);
      }
    } catch {
      if (!comparisonRequestGate.isCurrent(request)) return;
      const current = useAnalyticsStore.getState().data;
      if (current) {
        const next = { ...current, comparison: null, comparisonContext: context };
        set({ data: next });
        saveCachedDashboard(next, filters, comparisonMode);
      }
      showToast('上期数据加载失败，已展示当前期数据', 'info');
    }
  },
  setFilters: (filters) => set({ filters }),
  setComparisonDisplayMode: (module, mode) => set((state) => ({
    comparisonDisplayModeByModule: { ...state.comparisonDisplayModeByModule, [module]: mode },
  })),
  setComparisonMode: (module, mode) => {
    if (module === 'dashboard') {
      comparisonRequestGate.invalidate();
      const state = useAnalyticsStore.getState();
      if (mode === 'none' && state.data) {
        const data = {
          ...state.data,
          comparison: null,
          comparisonContext: dashboardComparisonContextFor(state.data.revenue, state.selectedPeriodByChart, state.dashboardFilters, mode),
        };
        set({ comparisonModeByModule: { ...state.comparisonModeByModule, [module]: mode }, data });
        saveCachedDashboard(data, state.dashboardFilters, mode);
        return;
      }
    }
    set((state) => ({
      comparisonModeByModule: { ...state.comparisonModeByModule, [module]: mode },
    }));
  },
  setDashboardFilters: (filters) => set({ dashboardFilters: resolveScopedFilters(filters) }),
  setLaborFilters: (filters) => set({ laborFilters: resolveScopedFilters(filters) }),
  setOrderDimensions: (dimensions) => set((state) => {
    const orderDimensions = normalizeOrderDimensions(dimensions);
    return { orderDimensions, orderFilters: { ...state.orderFilters, orderDimensions } };
  }),
  setOrderFilters: (filters) => {
    const orderDimensions = normalizeOrderDimensions(filters.orderDimensions ?? []);
    set({ orderDimensions, orderFilters: { ...filters, orderDimensions } });
  },
  setProductFilters: (filters) => set({ productFilters: resolveScopedFilters(filters) }),
  setSelectedProductKeys: (keys) => set({ selectedProductKeys: [...new Set(keys.filter(Boolean))].slice(0, 5) }),
  setSelectedChartPeriod: (chartKey, period) => set((state) => ({ selectedPeriodByChart: { ...state.selectedPeriodByChart, [chartKey]: period } })),
  setSelectedChartSelection: (chartKey, selection) => set((state) => {
    const selectedSeriesByChart = { ...state.selectedSeriesByChart };
    if (selection.seriesId) selectedSeriesByChart[chartKey] = selection.seriesId;
    else delete selectedSeriesByChart[chartKey];
    return {
      selectedPeriodByChart: { ...state.selectedPeriodByChart, [chartKey]: selection.period },
      selectedSeriesByChart,
    };
  }),
}));

function resolveScopedFilters(filters: AnalyticsFilters): AnalyticsFilters {
    const scopeTree = useAnalyticsStore.getState().scopeTree;
    if (!filters.scopeKeys?.length || !scopeTree.length) {
      return filters;
    }
    const selection = resolveStoreScopeSelection(filters.scopeKeys, scopeTree);
    const storeKeys = selection.shopKeys.length ? selection.shopKeys : ['ALL'];
    return { ...filters, scopeKeys: selection.scopeKeys, storeKey: storeKeyForSelection(storeKeys), storeKeys };
}

async function readCachedDashboard(error: unknown | null, filters: AnalyticsFilters, comparisonMode: ComparisonMode, selectedPeriodByChart: Record<string, string>): Promise<{ data: DashboardData; lastSyncedAt: number | null } | null> {
  if (error !== null && (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE)) return null;
  try {
    const now = Date.now();
    const cacheScope = dashboardAnalyticsCacheScope(filters, comparisonMode);
    const [revenue, revenueSources, mealPeriods, mealTrend, turnover] = await Promise.all([
      readCachedAnalytics<RevenueTrendResult>('revenue', cacheScope, now),
      readCachedAnalytics<RevenueSources>('revenueSources', cacheScope, now),
      readCachedAnalytics<MealPeriodsResult>('mealPeriods', cacheScope, now),
      readCachedAnalytics<MealPeriodTrendResult>('mealPeriodTrend', cacheScope, now),
      readCachedAnalytics<MealPeriodTurnoverResult>('mealPeriodTurnover', cacheScope, now),
    ]);
    if (!revenue || !revenueSources || !mealPeriods || !mealTrend || !turnover) return null;
    if (!isRecord(revenue.data) || !isRecord(revenueSources.data) || !isRecord(mealPeriods.data) || !isRecord(mealTrend.data) || !isRecord(turnover.data)) return null;
    const { dashboardComparison, dashboardComparisonContext, ...cachedRevenue } = revenue.data as RevenueTrendResult & { dashboardComparison?: OperationsOverview | null; dashboardComparisonContext?: unknown };
    const context = dashboardComparisonContextFor(cachedRevenue, selectedPeriodByChart, filters, comparisonMode);
    return {
      data: { comparison: comparisonMode === 'none' || !matchesDashboardComparisonContext(dashboardComparisonContext, context) ? null : dashboardComparison ?? null, comparisonContext: context, revenue: cachedRevenue, revenueSources: revenueSources.data, mealPeriods: mealPeriods.data, mealTrend: mealTrend.data, turnover: turnover.data },
      lastSyncedAt: [revenue, revenueSources, mealPeriods, mealTrend, turnover].some((snapshot) => snapshot.lastSyncedAt === null)
        ? null
        : Math.min(...[revenue, revenueSources, mealPeriods, mealTrend, turnover].map((snapshot) => snapshot.lastSyncedAt as number)),
    };
  } catch {
    return null;
  }
}

function saveCachedDashboard(data: DashboardData, filters: AnalyticsFilters, comparisonMode: ComparisonMode): void {
  const cacheScope = dashboardAnalyticsCacheScope(filters, comparisonMode);
  const now = Date.now();
  void Promise.all([
    saveCachedAnalytics('revenue', cacheScope, { ...data.revenue, dashboardComparison: comparisonMode === 'none' ? null : data.comparison, dashboardComparisonContext: data.comparisonContext ?? null }, now),
    saveCachedAnalytics('revenueSources', cacheScope, data.revenueSources, now),
    saveCachedAnalytics('mealPeriods', cacheScope, data.mealPeriods, now),
    saveCachedAnalytics('mealPeriodTrend', cacheScope, data.mealTrend, now),
    saveCachedAnalytics('mealPeriodTurnover', cacheScope, data.turnover, now),
  ]).catch(() => {});
}

async function clearCachedDashboard(filters: AnalyticsFilters, comparisonMode: ComparisonMode): Promise<void> {
  const cacheScope = dashboardAnalyticsCacheScope(filters, comparisonMode);
  const now = Date.now();
  await Promise.all([
    clearCachedAnalytics('revenue', cacheScope, now),
    clearCachedAnalytics('revenueSources', cacheScope, now),
    clearCachedAnalytics('mealPeriods', cacheScope, now),
    clearCachedAnalytics('mealPeriodTrend', cacheScope, now),
    clearCachedAnalytics('mealPeriodTurnover', cacheScope, now),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoreOptions(value: unknown): value is AnalyticsStoreOption[] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) && typeof item.key === 'string' && typeof item.label === 'string'
  ));
}

function isScopeTree(value: unknown): value is StoreScopeNode[] {
  return Array.isArray(value) && value.every((item) => (
    isRecord(item)
    && typeof item.key === 'string'
    && typeof item.label === 'string'
    && typeof item.type === 'string'
  ));
}

const MEAL_PERIOD_KEYS: MealPeriodKey[] = ['breakfast', 'lunch', 'afternoon_tea', 'dinner', 'late_night'];

function mealPeriodsFromTrend(point: MealPeriodTrendPoint, storeKey: string): MealPeriodsResult {
  return {
    business_date: point.date,
    periods: MEAL_PERIOD_KEYS.map((key) => point[key]),
    store_key: storeKey,
  };
}

function resolveMealPeriods(mealPeriods: MealPeriodsResult, mealTrend: MealPeriodTrendResult, filters: AnalyticsFilters): MealPeriodsResult {
  if (selectedAnalyticsStoreKeys(filters).length < 2) return mealPeriods;
  const point = mealTrend.points.find((item) => item.date === filters.dateTo);
  return point ? mealPeriodsFromTrend(point, filters.storeKey) : mealPeriods;
}

function comparisonPeriod(revenue: RevenueTrendResult, selectedPeriodByChart: Record<string, string>): { dateFrom: string; dateTo: string } | null {
  const selectedPeriod = selectedPeriodByChart['dashboard:revenue'] ?? selectedPeriodByChart['revenue:net'] ?? selectedPeriodByChart['revenue:sources'];
  const selected = selectedPeriod ? revenue.points.find((point) => point.period === selectedPeriod || point.period_start === selectedPeriod) : undefined;
  if (selected?.period_start && selected.period_end) {
    return { dateFrom: selected.period_start, dateTo: selected.period_end };
  }
  const latest = [...revenue.points].reverse().find((point) => !point.missing);
  if (!latest) return null;
  return { dateFrom: latest.period_start ?? latest.period, dateTo: latest.period_end ?? latest.period };
}

function dashboardComparisonContextFor(revenue: RevenueTrendResult, selectedPeriodByChart: Record<string, string>, filters: AnalyticsFilters, comparisonMode: ComparisonMode): DashboardComparisonContext {
  const period = comparisonPeriod(revenue, selectedPeriodByChart);
  return {
    comparisonMode,
    dateFrom: period?.dateFrom ?? filters.dateFrom,
    dateTo: period?.dateTo ?? filters.dateTo,
  };
}

function matchesDashboardComparisonContext(value: unknown, expected: DashboardComparisonContext): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<DashboardComparisonContext>;
  return context.comparisonMode === expected.comparisonMode
    && context.dateFrom === expected.dateFrom
    && context.dateTo === expected.dateTo;
}
