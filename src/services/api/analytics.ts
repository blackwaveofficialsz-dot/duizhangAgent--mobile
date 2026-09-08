import { ApiHttpError, apiRequest } from './client';
import { eachBusinessDate, loadAnalyticsDailyDelta, loadAnalyticsDailyFactsV2, type AnalyticsDailyFactV2Response } from './analyticsDelta';
import { analyticsDailyItemKey, analyticsDailyOrdersItemKey } from '@/services/cache/analyticsCache';
import { captureOfflineCacheOperationToken, clearCachedAnalytics, clearCachedAnalyticsDailyBucket, mergeCachedAnalyticsDelta, readCachedAnalytics, readCachedAnalyticsClientDays, readCachedAnalyticsDailyBucket, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { projectDashboardDailyFacts, type DashboardDailyFactProjection, type MealDailyFact, type OrderDailyFact } from '@/features/analytics/dashboardDailyFacts';
import { selectedAnalyticsStoreKeys, serializeAnalyticsFilters, type AnalyticsFilters } from '@/features/analytics/analyticsFilters';
import { effectiveOrderSourceType, excludeTodayForOrderFallback, normalizeOrderDimensions, orderDimensionKey, orderPeriodKey, type OrderDimension } from '@/features/analytics/orderAnalytics';
import type { StoreScopeNode } from '@/features/analytics/storeScope';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import type { TrendGranularity, TrendMovingAverageMeta } from '@/features/analytics/trendPeriod';

export type AnalyticsRequestOptions = { forceRefresh?: boolean; preferServerCache?: boolean; signal?: AbortSignal };
export type OrderRequestOptions = AnalyticsRequestOptions & {
  autoRefresh?: boolean;
  dimensions?: OrderDimension[];
  periodSnapshot?: boolean;
};
export type ProductDimension = 'all' | 'shop' | 'platform' | 'channel';
export type ProductQueryScope = { dimKey: string; dimType: ProductDimension };
export type ProductRequestOptions = AnalyticsRequestOptions & {
  dimKey?: string;
  dimType?: ProductDimension;
  granularity?: TrendGranularity;
  includeCurrent?: boolean;
  includeStoreTrends?: boolean;
  limit?: number;
  periodSnapshot?: boolean;
  storeKeys?: string[];
};

export type LaborRequestOptions = AnalyticsRequestOptions & {
  granularity?: TrendGranularity;
  periodSnapshot?: boolean;
};

export type LaborTrendRequestOptions = AnalyticsRequestOptions & {
  granularity?: TrendGranularity;
  includeCurrent?: boolean;
  storeKeys?: string[];
};

export type RevenueTrendPoint = {
  period: string;
  net_income: number;
  order_count: number;
  ma3?: number | null;
  ma4?: number | null;
  ma6?: number | null;
  ma7?: number | null;
  ma12?: number | null;
  ma26?: number | null;
  ma30?: number | null;
  ma180?: number | null;
  missing: boolean;
  period_start?: string;
  period_end?: string;
  in_progress?: boolean;
  [field: string]: string | number | boolean | null | undefined;
};

export type RevenueTrendResult = {
  date_from: string;
  date_to: string;
  granularity?: TrendGranularity;
  metric?: 'net_income' | string;
  moving_averages?: TrendMovingAverageMeta[];
  points: RevenueTrendPoint[];
  source_type?: string;
  store_key: string;
  store_keys?: string[];
  store_trends?: Record<string, RevenueTrendPoint[]>;
};

export type MealPeriodRow = {
  period_key: MealPeriodKey;
  period_label: string;
  order_count: number;
  paid_amount: number;
  income_amount: number;
  refund_amount: number;
  net_income: number;
  avg_order_value: number;
  ma7?: number | null;
  ma30?: number | null;
  ma180?: number | null;
};

export type MealPeriodsResult = { business_date: string; periods: MealPeriodRow[]; store_key: string };

export type MealPeriodKey = 'breakfast' | 'lunch' | 'afternoon_tea' | 'dinner' | 'late_night';

export type MealPeriodTrendPoint = { date: string } & Record<MealPeriodKey, MealPeriodRow>;

export type MealPeriodTrendResult = {
  date_from: string;
  date_to: string;
  points: MealPeriodTrendPoint[];
  store_key: string;
  store_keys?: string[];
  store_trends?: Record<string, MealPeriodTrendPoint[]>;
};

export type MealPeriodTurnoverRow = {
  avg_daily_turnover: number;
  period_key: MealPeriodKey;
  period_label: string;
  shop_order_count: number;
};

export type MealPeriodTurnoverPoint = { date: string } & Record<MealPeriodKey, {
  ma7?: number | null;
  ma30?: number | null;
  ma180?: number | null;
  shop_order_count: number;
  turnover: number;
}>;

export type MealPeriodTurnoverResult = {
  data_status: 'ok' | 'missing' | string;
  date_from?: string;
  date_to?: string;
  day_count?: number;
  eligible_store_count: number;
  excluded_stores?: Array<{ reason: string; store_key: string; store_label: string }>;
  points?: MealPeriodTurnoverPoint[];
  store_summaries?: Array<{ store_key: string; store_label: string; summary: MealPeriodTurnoverRow[]; table_count: number }>;
  store_trends?: Record<string, MealPeriodTurnoverPoint[]>;
  summary: MealPeriodTurnoverRow[];
  table_count: number;
};

export type OrderRow = {
  avg_order_value: number;
  source_type?: string;
  dim_key: string;
  dim_label: string | null;
  income_amount?: number;
  net_income: number;
  order_count: number;
  paid_amount?: number;
  refund_amount?: number;
  refund_rate: number;
};

export type OrdersResult = { rows: OrderRow[]; snapshot_status?: string };
export type OrderDailyRecord = { data: OrdersResult; date: string; version: string };
export type OrderPeriodSnapshotRecord = { data: OrdersResult; dateFrom: string; dateTo: string; period: string; version: string };
type OrderPeriodSnapshotBatchRecord = { data: OrdersResult; date_from?: string; date_to?: string; dateFrom?: string; dateTo?: string; period: string; version?: string };
type OrderPeriodSnapshotBatchResponse = { records: OrderPeriodSnapshotBatchRecord[] };
type OrderPeriodSnapshotCachePayload = { cacheContext: string; records: OrderPeriodSnapshotRecord[] };
type OrdersDeltaResult = {
  changed_days?: Array<{ date: string; payload: OrdersResult | null; version: string }>;
  unchanged_days?: string[];
  range_payload?: OrdersResult;
};
export type LaborRow = {
  actual_hours: number;
  headcount: number;
  hours_gap: number;
  net_revenue: number;
  planned_hours: number;
  revenue_per_hour: number;
  store_key: string;
  store_label: string | null;
  uncovered: boolean;
};
export type LaborResult = { rows: LaborRow[]; snapshot_status?: string };
export type LaborTrendPoint = {
  actual_hours: number;
  actual_hours_ma7: number | null;
  actual_hours_ma30: number | null;
  actual_hours_ma180: number | null;
  actual_revenue_per_hour: number | null;
  actual_revenue_per_hour_ma7: number | null;
  actual_revenue_per_hour_ma30: number | null;
  actual_revenue_per_hour_ma180: number | null;
  headcount: number;
  hours_synced?: boolean | null;
  in_progress?: boolean;
  missing: boolean;
  net_revenue: number;
  period: string;
  period_end?: string;
  period_start?: string;
  planned_hours: number;
  planned_hours_ma7: number | null;
  planned_hours_ma30: number | null;
  planned_hours_ma180: number | null;
  planned_revenue_per_hour: number | null;
  planned_revenue_per_hour_ma7: number | null;
  planned_revenue_per_hour_ma30: number | null;
  planned_revenue_per_hour_ma180: number | null;
  [field: string]: string | number | boolean | null | undefined;
};
export type LaborTrendResult = {
  date_from?: string;
  date_to?: string;
  granularity: TrendGranularity | string;
  moving_averages?: TrendMovingAverageMeta[];
  period: string;
  points: LaborTrendPoint[];
  store_key: string;
  store_label?: string;
  store_keys?: string[];
  store_trends?: Record<string, LaborTrendPoint[]>;
};
export type ProductRow = { order_count: number; product_key: string; product_name: string | null; quantity: number; sales_amount: number; sales_share: number };
export type ProductsResult = { bottom: ProductRow[]; top: ProductRow[]; total?: number; snapshot_status?: string };
export type LaborEmployeeDetail = {
  actual_hours: number;
  anomaly_count: number;
  department?: string;
  hours_gap: number;
  missing_count: number;
  name: string;
  planned_hours: number;
  segment_count: number;
  support_type?: string;
  user_id: string;
};
export type LaborDetailResult = {
  granularity: string;
  period: string;
  store_key: string;
  store_label: string;
  labor: { actual_hours: number; employees: LaborEmployeeDetail[]; headcount: number; hours_gap: number; planned_hours: number };
  revenue: {
    daily: Array<{ business_date: string; income_amount: number; net_income: number; order_count: number; paid_amount: number; refund_amount: number }>;
    income_amount: number;
    net_income: number;
    order_count: number;
    paid_amount: number;
    refund_amount: number;
    shops: Array<{ income_amount: number; net_income: number; order_count: number; paid_amount: number; refund_amount: number; shop_id: string; shop_name: string }>;
  };
};
export type ProductTrendPoint = {
  ma7: number | null;
  ma30: number | null;
  ma180: number | null;
  missing: boolean;
  order_count: number;
  period: string;
  period_end?: string;
  period_start?: string;
  in_progress?: boolean;
  quantity: number;
  sales_amount: number;
  [field: string]: string | number | boolean | null | undefined;
};
export type ProductTrendResult = {
  date_from: string;
  date_to: string;
  dim_key: string;
  dim_type: string;
  granularity?: TrendGranularity;
  metric: 'quantity';
  moving_averages?: TrendMovingAverageMeta[];
  points: ProductTrendPoint[];
  product_key: string;
  product_name: string | null;
  store_keys?: string[];
  store_trends?: Record<string, ProductTrendPoint[]>;
};
export type PlatformDim = { confirmed: boolean; platform_code: number; platform_name: string | null };
export type ShopMapping = { shiheng_shop_id: string; shiheng_shop_name: string | null; status: string };
export type StoreScopeTreeResponse = { nodes: StoreScopeNode[]; store_count: number; source: string };
export type RevenueAlert = {
  actual_amount: number;
  baseline_amount: number;
  baseline_dates?: string[];
  baseline_expected_count?: number;
  baseline_sample_count?: number;
  business_date: string;
  deviation_pct: number;
  direction: string;
  reason_hints?: string[];
  shop_key: string;
  shop_label: string | null;
  status: string;
};

export async function getDashboardAnalytics(
  filters: AnalyticsFilters,
  options: AnalyticsRequestOptions = {},
): Promise<DashboardDailyFactProjection> {
  if ((filters.granularity ?? 'day') !== 'day' || filters.includeCurrent) {
    return getDashboardAnalyticsFallback(filters, options);
  }
  const historyFrom = dailyHistoryStart(filters.dateFrom, filters.dateTo);
  try {
    const [orders, meal] = await Promise.all([
      loadAnalyticsDailyFactsV2<OrderDailyFact>({
        cacheScope: 'analytics-v3:daily:orders',
        dateFrom: historyFrom,
        dateTo: filters.dateTo,
        forceRefresh: options.forceRefresh,
        request: (clientDays, clientAccessScopeHash, range) => apiRequest<AnalyticsDailyFactV2Response<OrderDailyFact>>('/api/v1/analytics/orders/delta', {
          body: JSON.stringify({
            client_access_scope_hash: clientAccessScopeHash,
            client_days: clientDays,
            date_from: range.dateFrom,
            date_to: range.dateTo,
            force_refresh: range.forceRefresh,
            params: { dim: 'all', source_type: 'all', store_keys: [] },
            schema_version: 'orders-daily-fact-v4',
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: options.signal,
        }),
        schemaVersion: 'orders-daily-fact-v4',
        signal: options.signal,
      }),
      loadAnalyticsDailyFactsV2<MealDailyFact>({
        cacheScope: 'analytics-v3:daily:meal',
        dateFrom: historyFrom,
        dateTo: filters.dateTo,
        forceRefresh: options.forceRefresh,
        request: (clientDays, clientAccessScopeHash, range) => apiRequest<AnalyticsDailyFactV2Response<MealDailyFact>>('/api/v1/analytics/meal-periods/delta', {
          body: JSON.stringify({
            client_access_scope_hash: clientAccessScopeHash,
            client_days: clientDays,
            date_from: range.dateFrom,
            date_to: range.dateTo,
            force_refresh: range.forceRefresh,
            params: { store_key: 'ALL' },
            schema_version: 'meal-period-daily-fact-v4',
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: options.signal,
        }),
        schemaVersion: 'meal-period-daily-fact-v4',
        signal: options.signal,
      }),
    ]);
    return projectDashboardDailyFacts(orders.payloads, meal.payloads, filters);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getDashboardAnalyticsFallback(filters, options);
  }
}

async function getDashboardAnalyticsFallback(
  filters: AnalyticsFilters,
  options: AnalyticsRequestOptions,
): Promise<DashboardDailyFactProjection> {
  const [revenue, shop, takeout, mealPeriods, mealTrend, turnover] = await Promise.all([
    getRevenueTrend({ ...filters, sourceType: 'all' }, options),
    getRevenueTrend({ ...filters, sourceType: 'shop' }, options),
    getRevenueTrend({ ...filters, sourceType: 'takeout' }, options),
    getMealPeriods(filters, options),
    getMealPeriodTrend(filters, options),
    getMealPeriodTurnover(filters, options),
  ]);
  return { revenue, revenueSources: { shop, takeout }, mealPeriods, mealTrend, turnover };
}

export async function getRevenueTrend(filters: AnalyticsFilters, options: AnalyticsRequestOptions = {}): Promise<RevenueTrendResult> {
  if (options.preferServerCache || (filters.granularity ?? 'day') !== 'day' || filters.includeCurrent || revenueStoreKeys(filters).length) {
    return getRevenueTrendFallback(filters, options);
  }
  try {
    return await getRevenueTrendDelta(filters, options);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getRevenueTrendFallback(filters, options);
  }
}

function getRevenueTrendFallback(filters: AnalyticsFilters, options: AnalyticsRequestOptions): Promise<RevenueTrendResult> {
  return get<RevenueTrendResult>('/api/v1/analytics/trends/revenue', {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    source_type: filters.sourceType,
    store_key: filters.storeKey,
    store_keys: revenueStoreKeys(filters),
    granularity: filters.granularity ?? 'day',
    include_current: String(Boolean(filters.includeCurrent)),
  }, options);
}

async function getRevenueTrendDelta(filters: AnalyticsFilters, options: AnalyticsRequestOptions): Promise<RevenueTrendResult> {
  const cacheScope = analyticsDailyItemKey('revenueTrend', `${filters.storeKey}:${filters.sourceType}`);
  const result = await loadAnalyticsDailyDelta<RevenueTrendPoint>({
    cacheScope,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
    meta: (response) => Array.isArray(response.moving_averages)
      ? { moving_averages: response.moving_averages as never }
      : undefined,
    request: (clientDays) => apiRequest('/api/v1/analytics/trends/revenue/delta', {
      body: JSON.stringify({
        client_days: clientDays,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        force_refresh: Boolean(options.forceRefresh),
        params: { source_type: filters.sourceType, store_key: filters.storeKey },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    }),
  });
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    granularity: 'day',
    metric: 'net_income',
    moving_averages: Array.isArray(result.meta?.moving_averages) ? result.meta.moving_averages as never : undefined,
    points: result.payloads,
    source_type: filters.sourceType,
    store_key: filters.storeKey,
  };
}

export function getMealPeriods(filters: AnalyticsFilters, options: AnalyticsRequestOptions = {}) {
  return get<MealPeriodsResult>(`/api/v1/analytics/stores/${encodeURIComponent(filters.storeKey)}/meal-periods`, {
    date: filters.dateTo,
  }, options);
}

export async function getMealPeriodTrend(filters: AnalyticsFilters, options: AnalyticsRequestOptions = {}): Promise<MealPeriodTrendResult> {
  if ((filters.granularity ?? 'day') !== 'day' || multiStoreKeys(filters).length) {
    return getMealPeriodTrendFallback(filters, options);
  }
  try {
    return await getMealPeriodTrendDelta(filters, options);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getMealPeriodTrendFallback(filters, options);
  }
}

function getMealPeriodTrendFallback(filters: AnalyticsFilters, options: AnalyticsRequestOptions): Promise<MealPeriodTrendResult> {
  return get<MealPeriodTrendResult>(`/api/v1/analytics/stores/${encodeURIComponent(filters.storeKey)}/meal-periods/trend`, {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    store_keys: multiStoreKeys(filters),
  }, options);
}

async function getMealPeriodTrendDelta(filters: AnalyticsFilters, options: AnalyticsRequestOptions): Promise<MealPeriodTrendResult> {
  const result = await loadAnalyticsDailyDelta<MealPeriodTrendPoint>({
    cacheScope: analyticsDailyItemKey('mealPeriodTrend', filters.storeKey),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
    request: (clientDays) => apiRequest(`/api/v1/analytics/stores/${encodeURIComponent(filters.storeKey)}/meal-periods/trend/delta`, {
      body: JSON.stringify({
        client_days: clientDays,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        force_refresh: Boolean(options.forceRefresh),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    }),
  });
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    points: result.payloads,
    store_key: filters.storeKey,
  };
}

export function getMealPeriodTurnover(filters: AnalyticsFilters, options: AnalyticsRequestOptions = {}) {
  return get<MealPeriodTurnoverResult>(`/api/v1/analytics/stores/${encodeURIComponent(filters.storeKey)}/meal-periods/turnover`, {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    store_keys: multiStoreKeys(filters),
  }, options);
}

export async function getOrders(filters: AnalyticsFilters, options: OrderRequestOptions = {}): Promise<OrdersResult> {
  const dimensions = normalizeOrderDimensions(options.dimensions ?? filters.orderDimensions ?? []);
  const dim = orderDimensionKey(dimensions);
  const granularity = filters.granularity ?? 'day';
  const storeKeys = stableStoreKeys(selectedAnalyticsStoreKeys(filters));
  const normalizedFilters = {
    ...filters,
    granularity,
    sourceType: effectiveOrderSourceType(filters, dimensions),
  };
  const period = orderPeriodKey(normalizedFilters);
  if (options.periodSnapshot) {
    return getOrdersFallback(normalizedFilters, period, dim, storeKeys, options);
  }
  const scope = analyticsDailyOrdersItemKey(normalizedFilters.sourceType, dim, storeKeys);
  try {
    return await getOrdersDelta(normalizedFilters, dim, storeKeys, scope, options);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getOrdersFallback(normalizedFilters, period, dim, storeKeys, options);
  }
}

export async function getOrderDailyRecords(filters: AnalyticsFilters, options: OrderRequestOptions = {}): Promise<OrderDailyRecord[]> {
  const dimensions = normalizeOrderDimensions(options.dimensions ?? filters.orderDimensions ?? []);
  const storeKeys = stableStoreKeys(selectedAnalyticsStoreKeys(filters));
  const normalizedFilters = { ...filters, sourceType: effectiveOrderSourceType(filters, dimensions) };
  const dim = orderDimensionKey(dimensions);
  const result = await loadAnalyticsDailyDelta<OrdersResult>({
    cacheScope: analyticsDailyOrdersItemKey(normalizedFilters.sourceType, dim, storeKeys),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
    request: (clientDays) => requestOrdersDelta(normalizedFilters, dim, storeKeys, {
      ...options,
      autoRefresh: options.autoRefresh ?? false,
    }, clientDays),
  });
  const entries = result.entries ?? result.days.map((date, index) => ({ date, payload: result.payloads[index], version: '' }));
  return entries
    .flatMap((entry) => isOrdersResult(entry.payload) ? [{ data: entry.payload, date: entry.date, version: entry.version }] : [])
    .sort((left, right) => left.date.localeCompare(right.date));
}

export async function readCachedOrderDailyRecords(filters: AnalyticsFilters, options: OrderRequestOptions = {}): Promise<OrderDailyRecord[]> {
  const dimensions = normalizeOrderDimensions(options.dimensions ?? filters.orderDimensions ?? []);
  const storeKeys = stableStoreKeys(selectedAnalyticsStoreKeys(filters));
  const normalizedFilters = { ...filters, sourceType: effectiveOrderSourceType(filters, dimensions) };
  const dim = orderDimensionKey(dimensions);
  for (const scope of orderDailyCacheReadScopes(normalizedFilters.sourceType, dim, storeKeys)) {
    const bucket = await readCachedAnalyticsDailyBucket<OrdersResult>(scope, undefined, { signal: options.signal });
    const records = cachedOrderDailyRecords(bucket, filters.dateFrom, filters.dateTo);
    if (records.length) return records;
  }
  return [];
}

export async function getOrderPeriodSnapshotRecords(filters: AnalyticsFilters, options: OrderRequestOptions = {}): Promise<OrderPeriodSnapshotRecord[]> {
  const cacheScope = orderPeriodSnapshotCacheScope(filters, options);
  if (options.forceRefresh) await clearCachedAnalytics('orders', cacheScope, Date.now()).catch(() => undefined);
  if (!options.forceRefresh) {
    const cached = await readCachedOrderPeriodSnapshotCache(cacheScope, options.signal);
    if (cached && isAnalyticsSnapshotFresh(cached.lastSyncedAt)) return cached.data.records;
  }
  const records = await fetchOrderPeriodSnapshotRecords(filters, options);
  void saveCachedAnalytics('orders', cacheScope, { cacheContext: cacheScope, records }, Date.now()).catch(() => undefined);
  return records;
}

export async function readCachedOrderPeriodSnapshotRecords(filters: AnalyticsFilters, options: OrderRequestOptions = {}): Promise<OrderPeriodSnapshotRecord[]> {
  const cacheScope = orderPeriodSnapshotCacheScope(filters, options);
  const cached = await readCachedOrderPeriodSnapshotCache(cacheScope, options.signal);
  return cached?.data.records ?? [];
}

function orderPeriodSnapshotCacheScope(filters: AnalyticsFilters, options: OrderRequestOptions): string {
  const dimensions = normalizeOrderDimensions(options.dimensions ?? filters.orderDimensions ?? []);
  const storeKeys = stableStoreKeys(selectedAnalyticsStoreKeys(filters));
  const normalizedFilters = {
    ...filters,
    orderDimensions: dimensions,
    sourceType: effectiveOrderSourceType(filters, dimensions),
    storeKeys,
  };
  return `order-period-snapshot-v1:${orderDimensionKey(dimensions)}:${storeKeys.join(',')}:${serializeAnalyticsFilters(normalizedFilters)}`;
}

async function readCachedOrderPeriodSnapshotCache(cacheScope: string, signal?: AbortSignal): Promise<{ data: OrderPeriodSnapshotCachePayload; lastSyncedAt: number | null } | null> {
  throwIfSignalAborted(signal);
  const cached = await readCachedAnalytics<OrderPeriodSnapshotCachePayload>('orders', cacheScope, Date.now()).catch(() => null);
  throwIfSignalAborted(signal);
  if (!cached || cached.data.cacheContext !== cacheScope || !isOrderPeriodSnapshotCachePayload(cached.data)) return null;
  return cached;
}

async function fetchOrderPeriodSnapshotRecords(filters: AnalyticsFilters, options: OrderRequestOptions): Promise<OrderPeriodSnapshotRecord[]> {
  const granularity: TrendGranularity = filters.granularity ?? 'day';
  const dimensions = normalizeOrderDimensions(options.dimensions ?? filters.orderDimensions ?? []);
  const dim = orderDimensionKey(dimensions);
  const storeKeys = stableStoreKeys(selectedAnalyticsStoreKeys(filters));
  const normalizedFilters = { ...filters, sourceType: effectiveOrderSourceType(filters, dimensions), storeKeys };
  const periods = orderSnapshotPeriods(normalizedFilters);
  try {
    return await fetchOrderPeriodSnapshotBatchRecords(normalizedFilters, options, periods, dim, storeKeys, granularity);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error) || !isMissingBatchEndpoint(error)) throw error;
  }
  return fetchOrderPeriodSnapshotRecordsLegacy(normalizedFilters, options, periods, dim, storeKeys, granularity);
}

async function fetchOrderPeriodSnapshotBatchRecords(
  filters: AnalyticsFilters,
  options: OrderRequestOptions,
  periods: Array<{ dateFrom: string; dateTo: string; period: string }>,
  dim: string,
  storeKeys: string[],
  granularity: TrendGranularity,
): Promise<OrderPeriodSnapshotRecord[]> {
  throwIfSignalAborted(options.signal);
  const response = await apiRequest<OrderPeriodSnapshotBatchResponse>('/api/v1/analytics/orders/periods', {
    body: JSON.stringify({
      auto_refresh: options.autoRefresh ?? false,
      dim,
      exclude_today: false,
      granularity,
      periods: periods.map((period) => ({
        date_from: period.dateFrom,
        date_to: period.dateTo,
        exclude_today: excludeTodayForOrderFallback({ ...filters, dateFrom: period.dateFrom, dateTo: period.dateTo, granularity }),
        period: period.period,
      })),
      source_type: filters.sourceType,
      store_keys: storeKeys,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: options.signal,
  });
  if (!isOrderPeriodSnapshotBatchResponse(response)) return [];
  return response.records.flatMap((record) => {
    const dateFrom = record.dateFrom ?? record.date_from;
    const dateTo = record.dateTo ?? record.date_to;
    if (!dateFrom || !dateTo || !record.period || !isOrdersResult(record.data)) return [];
    return [{ data: record.data, dateFrom, dateTo, period: record.period, version: record.version ?? orderPeriodSnapshotVersion(record.data) }];
  });
}

async function fetchOrderPeriodSnapshotRecordsLegacy(
  filters: AnalyticsFilters,
  options: OrderRequestOptions,
  periods: Array<{ dateFrom: string; dateTo: string; period: string }>,
  dim: string,
  storeKeys: string[],
  granularity: TrendGranularity,
): Promise<OrderPeriodSnapshotRecord[]> {
  return Promise.all(periods.map(async (period) => {
    throwIfSignalAborted(options.signal);
    const periodFilters = { ...filters, dateFrom: period.dateFrom, dateTo: period.dateTo, granularity };
    const data = await get<OrdersResult>('/api/v1/analytics/orders', {
      auto_refresh: String(options.autoRefresh ?? false),
      dim,
      exclude_today: String(excludeTodayForOrderFallback(periodFilters)),
      granularity,
      period: period.period,
      source_type: filters.sourceType,
      store_keys: storeKeys,
    }, options);
    return { ...period, data, version: orderPeriodSnapshotVersion(data) };
  }));
}

function orderSnapshotPeriods(filters: AnalyticsFilters): Array<{ dateFrom: string; dateTo: string; period: string }> {
  const granularity = filters.granularity ?? 'day';
  if (granularity === 'day') {
    return eachBusinessDate(filters.dateFrom, filters.dateTo).map((day) => ({ dateFrom: day, dateTo: day, period: day }));
  }

  const periods: Array<{ dateFrom: string; dateTo: string; period: string }> = [];
  let cursor = granularity === 'week' ? startOfIsoWeekText(filters.dateFrom) : startOfMonthText(filters.dateFrom);
  while (cursor <= filters.dateTo) {
    const naturalTo = granularity === 'week' ? shiftAnalyticsDate(cursor, 6) : endOfMonthText(cursor);
    const dateFrom = cursor < filters.dateFrom ? filters.dateFrom : cursor;
    const dateTo = naturalTo > filters.dateTo ? filters.dateTo : naturalTo;
    if (dateFrom <= dateTo) {
      periods.push({
        dateFrom,
        dateTo,
        period: orderPeriodKey({ dateFrom, dateTo, granularity }),
      });
    }
    cursor = granularity === 'week' ? shiftAnalyticsDate(cursor, 7) : shiftAnalyticsMonth(cursor, 1);
  }
  return periods;
}

function orderPeriodSnapshotVersion(data: OrdersResult): string {
  return [
    data.snapshot_status ?? '',
    ...data.rows.map((row) => [
      row.dim_key,
      row.source_type ?? '',
      row.order_count,
      row.paid_amount ?? '',
      row.income_amount ?? '',
      row.refund_amount ?? '',
      row.net_income,
    ].join(':')),
  ].join('|');
}

function isOrderPeriodSnapshotCachePayload(value: unknown): value is OrderPeriodSnapshotCachePayload {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as OrderPeriodSnapshotCachePayload).cacheContext === 'string'
    && Array.isArray((value as OrderPeriodSnapshotCachePayload).records)
    && (value as OrderPeriodSnapshotCachePayload).records.every((record) => (
      record
      && typeof record.period === 'string'
      && typeof record.dateFrom === 'string'
      && typeof record.dateTo === 'string'
      && typeof record.version === 'string'
      && isOrdersResult(record.data)
    ))
  );
}

function orderDailyCacheReadScopes(sourceType: AnalyticsFilters['sourceType'], dim: string, storeKeys: string[]): string[] {
  const scopes = [analyticsDailyOrdersItemKey(sourceType, dim, storeKeys)];
  if (storeKeys.length) scopes.push(analyticsDailyOrdersItemKey(sourceType, dim, []));
  return [...new Set(scopes)];
}

function cachedOrderDailyRecords(bucket: Awaited<ReturnType<typeof readCachedAnalyticsDailyBucket<OrdersResult>>>, dateFrom: string, dateTo: string): OrderDailyRecord[] {
  if (!bucket) return [];
  return eachBusinessDate(dateFrom, dateTo)
    .flatMap((date) => {
      const entry = bucket.days[date];
      return entry && isOrdersResult(entry.payload) ? [{ data: entry.payload, date, version: entry.version }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function getOrdersDelta(filters: AnalyticsFilters, dim: string, storeKeys: string[], scope: string, options: OrderRequestOptions): Promise<OrdersResult> {
  const cacheOperation = { signal: options.signal, token: captureOfflineCacheOperationToken() };
  if (options.forceRefresh) await clearCachedAnalyticsDailyBucket(scope, undefined, cacheOperation).catch(() => undefined);
  const clientDays = options.forceRefresh
    ? []
    : await readCachedAnalyticsClientDays(scope, filters.dateFrom, filters.dateTo, undefined, cacheOperation).catch(() => []);
  const delta = await requestOrdersDelta(filters, dim, storeKeys, options, clientDays);
  void mergeCachedAnalyticsDelta(scope, delta.changed_days ?? [], undefined, undefined, cacheOperation).catch(() => undefined);
  return delta.range_payload ?? { rows: [], snapshot_status: 'missing' };
}

function requestOrdersDelta(
  filters: AnalyticsFilters,
  dim: string,
  storeKeys: string[],
  options: OrderRequestOptions,
  clientDays: Array<{ date: string; version: string }>,
): Promise<OrdersDeltaResult> {
  return apiRequest<OrdersDeltaResult>('/api/v1/analytics/orders/delta', {
    body: JSON.stringify({
      auto_refresh: options.autoRefresh ?? true,
      client_days: clientDays,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      force_refresh: Boolean(options.forceRefresh),
      params: { dim, source_type: filters.sourceType, store_keys: storeKeys },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: options.signal,
  });
}

function isOrdersResult(value: unknown): value is OrdersResult {
  return value !== null && typeof value === 'object' && Array.isArray((value as OrdersResult).rows);
}

function isOrderPeriodSnapshotBatchResponse(value: unknown): value is OrderPeriodSnapshotBatchResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray((value as OrderPeriodSnapshotBatchResponse).records)
  );
}

function isMissingBatchEndpoint(error: unknown): boolean {
  return error instanceof ApiHttpError && (error.status === 404 || error.status === 405);
}

function getOrdersFallback(filters: AnalyticsFilters, period: string, dim: string, storeKeys: string[], options: OrderRequestOptions): Promise<OrdersResult> {
  return get<OrdersResult>('/api/v1/analytics/orders', {
    granularity: filters.granularity ?? 'day',
    period,
    dim,
    source_type: filters.sourceType,
    store_keys: storeKeys,
    auto_refresh: String(options.autoRefresh ?? true),
    exclude_today: String(excludeTodayForOrderFallback(filters)),
  }, options);
}

export function getLabor(filters: AnalyticsFilters, options: LaborRequestOptions = {}) {
  const granularity = options.granularity ?? filters.granularity ?? 'day';
  if (options.periodSnapshot && granularity !== 'day') {
    return get<LaborResult>('/api/v1/analytics/labor-efficiency', {
      granularity,
      period: orderPeriodKey({ ...filters, granularity }),
      store_keys: selectedAnalyticsStoreKeys(filters),
    }, options);
  }
  return get<LaborResult>('/api/v1/analytics/labor-efficiency', {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    store_keys: selectedAnalyticsStoreKeys(filters),
  }, options);
}

export async function getLaborTrend(filters: AnalyticsFilters, options: LaborTrendRequestOptions = {}): Promise<LaborTrendResult> {
  const storeKeys = stableStoreKeys(options.storeKeys ?? multiStoreKeys(filters));
  if (
    (options.granularity ?? filters.granularity ?? 'day') !== 'day'
    || options.includeCurrent !== undefined
    || !isSingleTrendStoreScope(storeKeys, filters.storeKey)
  ) {
    return getLaborTrendFallback(filters, options, storeKeys);
  }
  try {
    return await getLaborTrendDelta(filters, options);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getLaborTrendFallback(filters, options, storeKeys);
  }
}

function getLaborTrendFallback(filters: AnalyticsFilters, options: LaborTrendRequestOptions, storeKeys: string[]): Promise<LaborTrendResult> {
  const values: Record<string, string | string[]> = {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    store_key: filters.storeKey,
    periods: '30',
    store_keys: storeKeys,
  };
  if (options.granularity) values.granularity = options.granularity;
  if (options.includeCurrent !== undefined) values.include_current = String(options.includeCurrent);
  return get<LaborTrendResult>('/api/v1/analytics/labor-efficiency/trend', values, options);
}

async function getLaborTrendDelta(filters: AnalyticsFilters, options: LaborTrendRequestOptions): Promise<LaborTrendResult> {
  const result = await loadAnalyticsDailyDelta<LaborTrendPoint>({
    cacheScope: analyticsDailyItemKey('laborTrend', `${filters.storeKey}:30`),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
    request: (clientDays) => apiRequest('/api/v1/analytics/labor-efficiency/trend/delta', {
      body: JSON.stringify({
        schema_version: 'labor-daily-fact-v3',
        client_days: clientDays,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        force_refresh: Boolean(options.forceRefresh),
        params: { periods: 30, store_key: filters.storeKey },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    }),
  });
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    granularity: 'day',
    period: `${filters.dateFrom}_${filters.dateTo}`,
    points: result.payloads,
    store_key: filters.storeKey,
  };
}

export function getProducts(filters: AnalyticsFilters, options: ProductRequestOptions = {}) {
  const granularity = options.granularity ?? filters.granularity ?? 'day';
  const values: Record<string, string | string[]> = {};
  if (!options.periodSnapshot) {
    values.date_from = filters.dateFrom;
    values.date_to = filters.dateTo;
  }
  values.limit = String(options.limit ?? 20);
  values.shop = options.dimKey ?? filters.storeKey;
  values.store_keys = stableStoreKeys(options.storeKeys ?? []);
  if (options.dimType) values.dim_type = options.dimType;
  if (options.periodSnapshot) {
    values.granularity = granularity;
    values.period = orderPeriodKey({ ...filters, granularity });
  }
  return get<ProductsResult>('/api/v1/analytics/products', values, options);
}

export async function getRevenueAlerts(businessDate: string, options: AnalyticsRequestOptions = {}): Promise<RevenueAlert[]> {
  const params = new URLSearchParams({ business_date: businessDate });
  const result = await apiRequest<{ alerts: RevenueAlert[] }>(
    `/api/v1/analytics/revenue-alerts?${params.toString()}`,
    { signal: options.signal },
  );
  return result.alerts;
}

export function getLaborDetail(storeKey: string, filters: AnalyticsFilters, options: AnalyticsRequestOptions = {}) {
  return get<LaborDetailResult>(`/api/v1/analytics/labor-efficiency/${encodeURIComponent(storeKey)}/detail`, {
    granularity: 'week',
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
  }, options);
}

export async function getProductTrend(productKey: string, filters: AnalyticsFilters, options: ProductRequestOptions = {}): Promise<ProductTrendResult> {
  const dimKey = options.dimKey ?? filters.storeKey;
  const dimType = options.dimType ?? (filters.storeKey === 'ALL' ? 'all' : 'shop');
  const storeKeys = stableStoreKeys(options.storeKeys ?? []);
  if (
    (options.granularity ?? filters.granularity ?? 'day') !== 'day'
    || options.includeCurrent !== undefined
    || (storeKeys.length > 0 && (dimType !== 'shop' || !isSingleTrendStoreScope(storeKeys, dimKey)))
  ) {
    return getProductTrendFallback(productKey, filters, options);
  }
  try {
    return await getProductTrendDelta(productKey, filters, options, dimKey, dimType);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    return getProductTrendFallback(productKey, filters, options);
  }
}

function getProductTrendFallback(productKey: string, filters: AnalyticsFilters, options: ProductRequestOptions): Promise<ProductTrendResult> {
  const values: Record<string, string | string[]> = {
    product_key: productKey,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    dim_key: options.dimKey ?? filters.storeKey,
    dim_type: options.dimType ?? (filters.storeKey === 'ALL' ? 'all' : 'shop'),
  };
  if (options.storeKeys !== undefined) values.store_keys = stableStoreKeys(options.storeKeys);
  if (options.granularity) values.granularity = options.granularity;
  if (options.includeCurrent !== undefined) values.include_current = String(options.includeCurrent);
  return get<ProductTrendResult>('/api/v1/analytics/products/trend', values, options);
}

async function getProductTrendDelta(
  productKey: string,
  filters: AnalyticsFilters,
  options: ProductRequestOptions,
  dimKey: string,
  dimType: ProductDimension,
): Promise<ProductTrendResult> {
  const result = await loadAnalyticsDailyDelta<ProductTrendPoint>({
    cacheScope: analyticsDailyItemKey('productTrend', `${productKey}:${dimKey}:${dimType}`),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
    meta: (response) => typeof response.product_name === 'string'
      ? { product_name: response.product_name }
      : undefined,
    request: (clientDays) => apiRequest('/api/v1/analytics/products/trend/delta', {
      body: JSON.stringify({
        schema_version: 'product-daily-fact-v2',
        client_days: clientDays,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        force_refresh: Boolean(options.forceRefresh),
        params: { dim_key: dimKey, dim_type: dimType, product_key: productKey },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    }),
  });
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    dim_key: dimKey,
    dim_type: dimType,
    granularity: 'day',
    metric: 'quantity',
    points: result.payloads,
    product_key: productKey,
    product_name: typeof result.meta?.product_name === 'string' ? result.meta.product_name : null,
  };
}

export async function listPlatformDim(options: AnalyticsRequestOptions = {}): Promise<PlatformDim[]> {
  const result = await apiRequest<{ platforms: PlatformDim[] }>('/api/v1/analytics/platform-dim', { signal: options.signal });
  return result.platforms;
}

export async function listShopMappings(options: AnalyticsRequestOptions = {}): Promise<ShopMapping[]> {
  const result = await apiRequest<{ mappings: ShopMapping[] }>('/api/v1/analytics/shop-mappings', { signal: options.signal });
  return result.mappings;
}

export function listStoreScopeTree(options: AnalyticsRequestOptions = {}): Promise<StoreScopeTreeResponse> {
  return apiRequest<StoreScopeTreeResponse>('/api/v1/analytics/store-scope-tree', { signal: options.signal });
}

function get<T>(path: string, values: Record<string, string | string[]>, options: AnalyticsRequestOptions): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  if (options.forceRefresh) params.set('refresh', 'true');
  return apiRequest<T>(`${path}?${params.toString()}`, { signal: options.signal });
}

function multiStoreKeys(filters: AnalyticsFilters): string[] {
  const storeKeys = selectedAnalyticsStoreKeys(filters);
  return storeKeys.length > 1 ? storeKeys : [];
}

function stableStoreKeys(storeKeys: string[]): string[] {
  return [...new Set(storeKeys.filter((storeKey) => storeKey && storeKey !== 'ALL'))].sort();
}

function isSingleTrendStoreScope(storeKeys: string[], storeKey: string): boolean {
  return storeKeys.length === 0 || (storeKeys.length === 1 && storeKeys[0] === storeKey);
}

function revenueStoreKeys(filters: AnalyticsFilters): string[] {
  const storeKeys = selectedAnalyticsStoreKeys(filters);
  const explicitScopeCount = filters.scopeKeys?.filter((key) => key !== 'ALL').length ?? 0;
  return storeKeys.length > 1 || explicitScopeCount > 0 ? storeKeys : [];
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function dailyHistoryStart(dateFrom: string, dateTo: string): string {
  const desired = shiftBusinessDate(dateFrom, -179);
  const bounded = shiftBusinessDate(dateTo, -364);
  return desired > bounded ? desired : bounded;
}

function shiftBusinessDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function throwIfSignalAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
}

function startOfIsoWeekText(value: string): string {
  const date = parseAnalyticsDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatAnalyticsDate(date);
}

function startOfMonthText(value: string): string {
  const date = parseAnalyticsDate(value);
  return formatAnalyticsDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function endOfMonthText(value: string): string {
  const date = parseAnalyticsDate(value);
  return formatAnalyticsDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function shiftAnalyticsDate(value: string, days: number): string {
  const date = parseAnalyticsDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatAnalyticsDate(date);
}

function shiftAnalyticsMonth(value: string, months: number): string {
  const date = parseAnalyticsDate(value);
  return formatAnalyticsDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}

function parseAnalyticsDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatAnalyticsDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
