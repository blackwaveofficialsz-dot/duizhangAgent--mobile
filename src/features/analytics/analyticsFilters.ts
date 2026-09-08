import { beijingToday } from '@/utils/time';
import type { ComparisonMode } from '@/services/api/operationsAnalytics';
import { normalizeOrderDimensions, type OrderDimension } from './orderAnalytics';
import type { TrendGranularity } from './trendPeriod';

export type AnalyticsFilters = {
  dateFrom: string;
  dateTo: string;
  granularity?: TrendGranularity;
  includeCurrent?: boolean;
  orderDimensions?: OrderDimension[];
  scopeKeys?: string[];
  sourceType: 'all' | 'shop' | 'takeout';
  storeKey: string;
  storeKeys: string[];
};

export function createAnalyticsFilters(today = beijingToday()): AnalyticsFilters {
  return {
    ...analyticsDateRange('last30', today),
    granularity: 'day',
    includeCurrent: false,
    sourceType: 'all',
    storeKey: 'ALL',
    storeKeys: ['ALL'],
  };
}

export function createDashboardAnalyticsFilters(today = beijingToday()): AnalyticsFilters {
  return {
    ...createAnalyticsFilters(today),
    ...analyticsDateRange('last10', today),
    scopeKeys: ['ALL'],
  };
}

export type AnalyticsDatePreset = 'last10' | 'last30' | 'lastMonth';

export function analyticsDateRange(preset: AnalyticsDatePreset, today = beijingToday()): Pick<AnalyticsFilters, 'dateFrom' | 'dateTo'> {
  if (preset === 'lastMonth') {
    const current = parseDate(today);
    return {
      dateFrom: formatDate(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1))),
      dateTo: formatDate(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0))),
    };
  }
  const dateTo = latestAnalyticsDate(today);
  return { dateFrom: shiftDate(dateTo, preset === 'last10' ? -9 : -29), dateTo };
}

export function latestAnalyticsDate(today = beijingToday()): string {
  return shiftDate(today, -1);
}

export function normalizeStoreSelection(previous: string[], next: string[]): string[] {
  const values = [...new Set(next.filter(Boolean))];
  if (values.length === 0) return ['ALL'];
  if (values.includes('ALL') && !previous.includes('ALL')) return ['ALL'];
  const stores = selectedStoreKeys(values);
  return stores.length ? stores : ['ALL'];
}

export function selectedAnalyticsStoreKeys(filters: Pick<AnalyticsFilters, 'storeKey'> & Partial<Pick<AnalyticsFilters, 'storeKeys'>>): string[] {
  return selectedStoreKeys(filters.storeKeys?.length ? filters.storeKeys : [filters.storeKey]);
}

export function storeKeyForSelection(storeKeys: string[]): string {
  const selected = selectedStoreKeys(storeKeys);
  return selected.length === 1 ? selected[0] : 'ALL';
}

export function serializeAnalyticsFilters(filters: AnalyticsFilters): string {
  const params = new URLSearchParams({
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
  });
  for (const storeKey of selectedAnalyticsStoreKeys(filters).sort()) params.append('store_keys', storeKey);
  for (const scopeKey of [...new Set(filters.scopeKeys ?? [])].filter((key) => key !== 'ALL').sort()) params.append('scope_keys', scopeKey);
  params.set('source_type', filters.sourceType);
  params.set('granularity', filters.granularity ?? 'day');
  params.set('include_current', String(Boolean(filters.includeCurrent)));
  for (const dimension of normalizeOrderDimensions(filters.orderDimensions ?? []).sort()) params.append('order_dimensions', dimension);
  return params.toString();
}

export type ProductAnalyticsScope = { dimKey: string; dimType: string };
export type LaborAnalyticsMetric = 'efficiency' | 'hours';
export type LaborDashboardCacheContext = {
  comparisonMode: ComparisonMode;
  departmentKeys: string[];
  filters: string;
  scopeKey: string;
};

export type LaborChartNavigationParams = {
  cacheKey: string;
  dateFrom: string;
  dateTo: string;
  departmentKeys: string;
  granularity: string;
  includeCurrent: string;
  laborMetric: LaborAnalyticsMetric;
  scopeKeys: string;
  sourceType: AnalyticsFilters['sourceType'];
  storeKeys: string;
  type: `labor-${LaborAnalyticsMetric}`;
};

export function dashboardAnalyticsCacheScope(filters: AnalyticsFilters, comparisonMode: ComparisonMode): string {
  return analyticsCacheScope('dashboard-v4', filters, comparisonMode);
}

export function orderAnalyticsCacheScope(filters: AnalyticsFilters, comparisonMode: ComparisonMode): string {
  return analyticsCacheScope('orders-v2', filters, comparisonMode);
}

export function productAnalyticsCacheKey(filters: AnalyticsFilters, scope: ProductAnalyticsScope, productKeys: string | string[] = [], comparisonMode: ComparisonMode = 'previous'): string {
  const params = new URLSearchParams(serializeAnalyticsFilters(filters));
  params.set('dim_type', scope.dimType);
  params.set('dim_key', scope.dimKey);
  params.set('comparison_mode', comparisonMode);
  params.set('product_keys', normalizedKeys(productKeys).join(','));
  return `product-dashboard-v4:${params.toString()}`;
}

export function laborAnalyticsCacheKey(filters: AnalyticsFilters, metric: LaborAnalyticsMetric, departmentKeys: string[], comparisonMode: ComparisonMode = 'previous'): string {
  const params = new URLSearchParams(serializeAnalyticsFilters(filters));
  params.set('comparison_mode', comparisonMode);
  params.set('metric_type', metric);
  for (const key of [...new Set(departmentKeys.filter((key) => key && key !== 'ALL'))].sort()) params.append('department_keys', key);
  return `labor-dashboard-v5:${params.toString()}`;
}

export function laborDashboardCacheScope(filters: AnalyticsFilters, scopeKey: string, comparisonMode: ComparisonMode): string {
  const params = new URLSearchParams(serializeAnalyticsFilters(filters));
  params.set('comparison_mode', comparisonMode);
  params.set('scope_key', scopeKey);
  return `labor-dashboard-v5:${params.toString()}`;
}

export function createLaborDashboardCacheContext(filters: AnalyticsFilters, departmentKeys: string[], scopeKey: string, comparisonMode: ComparisonMode): LaborDashboardCacheContext {
  return {
    comparisonMode,
    departmentKeys: [...new Set(departmentKeys.filter((key) => key && key !== 'ALL'))].sort(),
    filters: serializeAnalyticsFilters(filters),
    scopeKey,
  };
}

export function matchesLaborDashboardCacheContext(value: unknown, expected: LaborDashboardCacheContext): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<LaborDashboardCacheContext>;
  return context.comparisonMode === expected.comparisonMode
    && context.filters === expected.filters
    && context.scopeKey === expected.scopeKey
    && Array.isArray(context.departmentKeys)
    && context.departmentKeys.length === expected.departmentKeys.length
    && context.departmentKeys.every((key, index) => key === expected.departmentKeys[index]);
}

export function laborChartNavigationParams(filters: AnalyticsFilters, metric: LaborAnalyticsMetric, departmentKeys: string[], comparisonMode: ComparisonMode = 'previous'): LaborChartNavigationParams {
  const scopeKeys = [...new Set(filters.scopeKeys ?? [])].filter(Boolean).sort();
  const storeKeys = selectedAnalyticsStoreKeys(filters).sort();
  const uniqueDepartmentKeys = [...new Set(departmentKeys.filter((key) => key && key !== 'ALL'))].sort();
  return {
    cacheKey: laborAnalyticsCacheKey(filters, metric, uniqueDepartmentKeys, comparisonMode),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    departmentKeys: uniqueDepartmentKeys.join(','),
    granularity: filters.granularity ?? 'day',
    includeCurrent: String(Boolean(filters.includeCurrent)),
    laborMetric: metric,
    scopeKeys: scopeKeys.join(',') || 'ALL',
    sourceType: filters.sourceType,
    storeKeys: storeKeys.join(',') || 'ALL',
    type: `labor-${metric}`,
  };
}

function analyticsCacheScope(version: string, filters: AnalyticsFilters, comparisonMode: ComparisonMode): string {
  const params = new URLSearchParams(serializeAnalyticsFilters(filters));
  params.set('comparison_mode', comparisonMode);
  return `${version}:${params.toString()}`;
}

function normalizedKeys(keys: string | string[]): string[] {
  return [...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))].sort();
}

export function createAnalyticsRequestGate() {
  let currentId = 0;
  let currentController: AbortController | null = null;

  return {
    begin() {
      currentController?.abort();
      currentController = new AbortController();
      const id = ++currentId;
      return { id, signal: currentController.signal };
    },
    isCurrent(request: { id: number; signal: AbortSignal }) {
      return request.id === currentId && !request.signal.aborted;
    },
    invalidate() {
      currentController?.abort();
      currentController = null;
      currentId += 1;
    },
  };
}

function shiftDate(dateText: string, days: number): string {
  const date = parseDate(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function selectedStoreKeys(keys: string[]): string[] {
  return [...new Set(keys.filter((key) => key && key !== 'ALL'))];
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
