import { beijingToday } from '@/utils/time';
import type { OrderRow } from '@/services/api/analytics';
import type { MetricComparison, OperationsDimensionRow, OperationsOverview } from '@/services/api/operationsAnalytics';
import type { AnalyticsFilters } from './analyticsFilters';
import type { TrendGranularity } from './trendPeriod';

export type OrderDimension = 'shop' | 'platform' | 'channel';
type OrderComparisonDimension = ReturnType<typeof orderDimensionKey>;
type OrderMetric = 'paid_amount' | 'income_amount' | 'refund_amount' | 'net_income' | 'order_count' | 'avg_order_value' | 'refund_rate';
type OrderRowWithIncome = OrderRow & { income_amount?: number };

const ORDER_METRICS: Array<{ comparisonKeys: string[]; key: OrderMetric; label: string }> = [
  { comparisonKeys: ['revenue', 'paid_amount'], key: 'paid_amount', label: '营收' },
  { comparisonKeys: ['income_amount'], key: 'income_amount', label: '实收' },
  { comparisonKeys: ['refund_amount'], key: 'refund_amount', label: '退款' },
  { comparisonKeys: ['net_income'], key: 'net_income', label: '净实收' },
  { comparisonKeys: ['order_count'], key: 'order_count', label: '订单数' },
  { comparisonKeys: ['avg_order_value'], key: 'avg_order_value', label: '客单价' },
  { comparisonKeys: ['refund_rate'], key: 'refund_rate', label: '退款率' },
];

const ORDER_DIMENSIONS: OrderDimension[] = ['shop', 'platform', 'channel'];

export function normalizeOrderDimensions(dimensions: OrderDimension[]): OrderDimension[] {
  const selected = ORDER_DIMENSIONS.filter((dimension) => dimensions.includes(dimension));
  return selected.includes('platform') && selected.includes('channel')
    ? selected.filter((dimension) => dimension !== 'channel')
    : selected;
}

export function orderDimensionKey(dimensions: OrderDimension[]): string {
  const selected = normalizeOrderDimensions(dimensions);
  return selected.length ? selected.join('_') : 'all';
}

export function effectiveOrderSourceType(
  filters: Pick<AnalyticsFilters, 'sourceType'>,
  dimensions: OrderDimension[],
): AnalyticsFilters['sourceType'] {
  return normalizeOrderDimensions(dimensions).includes('channel') ? 'all' : filters.sourceType;
}

export function effectiveOrderChannels(
  filters: Pick<AnalyticsFilters, 'sourceType'>,
  dimensions: OrderDimension[],
): Array<'shop' | 'takeout'> {
  const sourceType = effectiveOrderSourceType(filters, dimensions);
  return sourceType === 'all' ? [] : [sourceType];
}

export function orderMetricValue(row: OrderRow, metric: OrderMetric): number {
  if (metric === 'income_amount') {
    const income = (row as OrderRowWithIncome).income_amount;
    return typeof income === 'number' ? income : row.net_income + (row.refund_amount ?? 0);
  }
  return row[metric] ?? 0;
}

export function comparisonForOrderRow(
  row: Pick<OrderRow, 'dim_key' | 'dim_label'>,
  dimension: OrderComparisonDimension,
  overview: OperationsOverview | null | undefined,
  metric: string,
): MetricComparison | undefined {
  if (!overview) return undefined;
  if (dimension === 'all') return overview.metrics[metric];
  const target = comparisonRowsForDimension(dimension, overview).find((candidate) => {
    const key = candidate.dim_key ?? candidate.store_key;
    return key === row.dim_key || candidate.dim_label === row.dim_label || candidate.store_label === row.dim_label;
  });
  return target?.metrics[metric];
}

export function buildOrderExportRows(rows: OrderRow[], input: {
  comparisonOverview?: OperationsOverview | null;
  dimensions: OrderDimension[];
}): Array<Record<string, string | number>> {
  const dimension = orderDimensionKey(input.dimensions);
  return rows.map((row) => {
    const output: Record<string, string | number> = { 维度: orderRowLabel(row) };
    for (const metric of ORDER_METRICS) {
      output[metric.label] = orderMetricValue(row, metric.key);
      const comparison = metric.comparisonKeys
        .map((key) => comparisonForOrderRow(row, dimension, input.comparisonOverview, key))
        .find(Boolean);
      if (!comparison) continue;
      output[`${metric.label}上期`] = comparison.previous ?? '';
      output[`${metric.label}差值`] = comparison.difference ?? '';
      output[`${metric.label}变化率`] = comparison.change_rate == null ? '' : `${(comparison.change_rate * 100).toFixed(2)}%`;
    }
    return output;
  });
}

export function orderMetricDefinitions(): ReadonlyArray<{ comparisonKeys: string[]; key: OrderMetric; label: string }> {
  return ORDER_METRICS;
}

export function orderRowLabel(row: Pick<OrderRow, 'dim_key' | 'dim_label'>): string {
  return row.dim_label || row.dim_key;
}

function comparisonRowsForDimension(dimension: OrderComparisonDimension, overview: OperationsOverview): OperationsDimensionRow[] {
  if (dimension === 'shop') return overview.stores;
  if (dimension === 'platform') return overview.platforms;
  if (dimension === 'channel') return overview.channels;
  if (dimension === 'shop_platform') return overview.store_platforms ?? [];
  if (dimension === 'shop_channel') return overview.store_channels;
  return [];
}

export function orderPeriodKey(filters: Pick<AnalyticsFilters, 'dateFrom' | 'dateTo' | 'granularity'>): string {
  if (filters.granularity === 'week') return isoWeekKey(filters.dateFrom);
  if (filters.granularity === 'month') return filters.dateFrom.slice(0, 7);
  return filters.dateFrom;
}

export function createOrderAnalyticsFilters(today = beijingToday()): AnalyticsFilters {
  const yesterday = shiftDate(today, -1);
  return {
    dateFrom: yesterday,
    dateTo: yesterday,
    granularity: 'day',
    includeCurrent: false,
    orderDimensions: [],
    sourceType: 'all',
    storeKey: 'ALL',
    storeKeys: ['ALL'],
  };
}

export function excludeTodayForOrderFallback(filters: AnalyticsFilters, today = beijingToday()): boolean {
  if (!filters.includeCurrent) return false;
  const yesterday = shiftDate(today, -1);
  if (filters.granularity === 'week') {
    return filters.dateFrom === startOfIsoWeek(today) && filters.dateTo === yesterday;
  }
  if (filters.granularity === 'month') {
    return filters.dateFrom === `${today.slice(0, 7)}-01` && filters.dateTo === yesterday;
  }
  return false;
}

export function orderPeriodRange(
  granularity: TrendGranularity,
  anchor: string,
  includeCurrent: boolean,
  today = beijingToday(),
): Pick<AnalyticsFilters, 'dateFrom' | 'dateTo'> {
  const yesterday = shiftDate(today, -1);
  const selected = anchor > yesterday ? yesterday : anchor;
  if (granularity === 'day') return { dateFrom: selected, dateTo: selected };

  if (granularity === 'week') {
    const start = startOfIsoWeek(selected);
    const end = shiftDate(start, 6);
    if (includeCurrent && selected >= startOfIsoWeek(today)) return { dateFrom: start, dateTo: yesterday };
    const latestComplete = shiftDate(startOfIsoWeek(today), -1);
    return end > latestComplete
      ? { dateFrom: startOfIsoWeek(latestComplete), dateTo: latestComplete }
      : { dateFrom: start, dateTo: end };
  }

  const start = `${selected.slice(0, 7)}-01`;
  const end = endOfMonth(start);
  if (includeCurrent && selected.slice(0, 7) === today.slice(0, 7)) return { dateFrom: start, dateTo: yesterday };
  const latestComplete = `${shiftDate(today.slice(0, 7) + '-01', -1).slice(0, 7)}-01`;
  return end > yesterday ? { dateFrom: latestComplete, dateTo: endOfMonth(latestComplete) } : { dateFrom: start, dateTo: end };
}

function isoWeekKey(dateText: string): string {
  const date = parseDate(dateText);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function startOfIsoWeek(dateText: string): string {
  const date = parseDate(dateText);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatDate(date);
}

function endOfMonth(start: string): string {
  const date = parseDate(start);
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function shiftDate(dateText: string, days: number): string {
  const date = parseDate(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
