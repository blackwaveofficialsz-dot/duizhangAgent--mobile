import { apiRequest } from './client';
import type { operations } from '@/types/generated/api';

type OverviewQuery =
  operations['get_operations_overview_api_v1_analytics_operations_overview_get']['parameters']['query'];
type ProductsQuery =
  operations['get_operations_products_api_v1_analytics_operations_products_get']['parameters']['query'];
type LaborQuery =
  operations['get_operations_labor_api_v1_analytics_operations_labor_get']['parameters']['query'];

export type ComparisonMode = NonNullable<OverviewQuery['compare']>;
export type Granularity = NonNullable<LaborQuery['granularity']>;

export type MetricComparison = {
  current: number | null;
  previous: number | null;
  difference: number | null;
  change_rate: number | null;
  status: string;
};

export type PreviousPeriod = { date_from: string; date_to: string };
export type OperationsDimensionRow = {
  dim_key?: string;
  dim_label?: string;
  store_key?: string;
  store_label?: string;
  metrics: Record<string, MetricComparison>;
};

export type OperationsOverview = {
  period: PreviousPeriod;
  previous_period: PreviousPeriod | null;
  metrics: Record<string, MetricComparison>;
  latest_metrics?: Record<string, MetricComparison>;
  channels: OperationsDimensionRow[];
  platforms: OperationsDimensionRow[];
  stores: OperationsDimensionRow[];
  store_channels: OperationsDimensionRow[];
  store_platforms?: OperationsDimensionRow[];
};

export type OperationsProductItem = {
  product_key: string;
  product_name: string;
  quantity: number;
  sales_amount: number;
  order_count: number | null;
  quantity_share: number;
  amount_share: number;
  comparison?: Record<string, MetricComparison>;
};

export type OperationsProducts = {
  data_status: string;
  previous_period: PreviousPeriod | null;
  items: OperationsProductItem[];
  total: number;
  limit: number;
  offset: number;
};

export type OperationsLabor = {
  data_status: string;
  excluded_dates: string[];
  granularity: Granularity;
  previous_period: PreviousPeriod | null;
  points: Array<{
    period: string;
    data_status: string;
    actual_hours: number;
    planned_hours: number;
    net_revenue: number;
    headcount: number;
    actual_revenue_per_hour: number | null;
    planned_revenue_per_hour: number | null;
  }>;
  summary: {
    actual_hours: number;
    planned_hours: number;
    net_revenue: number;
    headcount: number;
    actual_revenue_per_hour: number | null;
    planned_revenue_per_hour: number | null;
    comparison?: Record<string, MetricComparison>;
  };
};

export type OperationsOverviewRequest = {
  compare: ComparisonMode;
  dateFrom: string;
  dateTo: string;
  granularity?: Granularity;
  orderChannels?: Array<'shop' | 'takeout'>;
  platformCodes?: readonly number[];
  refresh?: boolean;
  signal?: AbortSignal;
  storeKeys: string[];
};

export type OperationsProductsRequest = {
  compare: ComparisonMode;
  dateFrom: string;
  dateTo: string;
  granularity: Granularity;
  limit?: ProductsQuery['limit'];
  offset?: ProductsQuery['offset'];
  orderChannels?: Array<'shop' | 'takeout'>;
  platformIds?: ProductsQuery['platform_ids'];
  productKeys?: ProductsQuery['product_keys'];
  signal?: AbortSignal;
  storeKeys: string[];
};

export type OperationsLaborRequest = {
  compare: ComparisonMode;
  dateFrom: string;
  dateTo: string;
  granularity: Granularity;
  signal?: AbortSignal;
  storeKeys: string[];
};

function appendValues(params: URLSearchParams, key: string, values: readonly (string | number)[]): void {
  for (const value of values) params.append(key, String(value));
}

function query(params: URLSearchParams): string {
  return params.size ? `?${params.toString()}` : '';
}

export function getOperationsOverview({
  compare,
  dateFrom,
  dateTo,
  granularity,
  orderChannels,
  platformCodes,
  refresh,
  signal,
  storeKeys,
}: OperationsOverviewRequest): Promise<OperationsOverview> {
  const params = new URLSearchParams();
  params.set('compare', compare);
  params.set('date_from', dateFrom);
  params.set('date_to', dateTo);
  if (granularity) params.set('granularity', granularity);
  appendValues(params, 'store_keys', storeKeys);
  appendValues(params, 'order_channels', orderChannels ?? []);
  appendValues(params, 'platform_codes', platformCodes ?? []);
  if (refresh !== undefined) params.set('refresh', String(refresh));
  return apiRequest<OperationsOverview>(
    `/api/v1/analytics/operations/overview${query(params)}`,
    { signal },
  );
}

export function getOperationsProducts({
  compare,
  dateFrom,
  dateTo,
  granularity,
  limit,
  offset,
  orderChannels,
  platformIds,
  productKeys,
  signal,
  storeKeys,
}: OperationsProductsRequest): Promise<OperationsProducts> {
  const params = new URLSearchParams();
  params.set('compare', compare);
  params.set('date_from', dateFrom);
  params.set('date_to', dateTo);
  params.set('granularity', granularity);
  appendValues(params, 'store_keys', storeKeys);
  appendValues(params, 'order_channels', orderChannels ?? []);
  appendValues(params, 'platform_ids', platformIds ?? []);
  appendValues(params, 'product_keys', productKeys ?? []);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  return apiRequest<OperationsProducts>(
    `/api/v1/analytics/operations/products${query(params)}`,
    { signal },
  );
}

export function getOperationsLabor({
  compare,
  dateFrom,
  dateTo,
  granularity,
  signal,
  storeKeys,
}: OperationsLaborRequest): Promise<OperationsLabor> {
  const params = new URLSearchParams();
  params.set('compare', compare);
  params.set('date_from', dateFrom);
  params.set('date_to', dateTo);
  params.set('granularity', granularity);
  appendValues(params, 'store_keys', storeKeys);
  return apiRequest<OperationsLabor>(
    `/api/v1/analytics/operations/labor${query(params)}`,
    { signal },
  );
}
