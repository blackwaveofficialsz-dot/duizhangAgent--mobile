import type { OrderRow } from '@/services/api/analytics';
import { amountToCents } from '@/utils/number';
import type { TrendGranularity } from './trendPeriod';

export type OrderSecondaryDimension = 'total' | 'channel' | 'platform';

export type OrderStoreMetrics = {
  avgOrderValueCent: number;
  incomeAmountCent: number;
  netIncomeCent: number;
  orderCount: number;
  paidAmountCent: number;
  refundAmountCent: number;
  refundRate: number;
};

export type OrderStoreTableRow = {
  breakdown: Record<string, OrderStoreMetrics>;
  breakdownLabels: Record<string, string>;
  storeKey: string;
  storeLabel: string;
  totals: OrderStoreMetrics;
};

export type OrderDailyRecord = {
  data: { rows: OrderRow[] };
  date: string;
  version: string;
};

export type OrderPeriodSnapshotRecord = {
  data: { rows: OrderRow[] };
  dateFrom: string;
  dateTo: string;
  period: string;
  version: string;
};

export type OrderPeriodRow = {
  complete: boolean;
  dateFrom: string;
  dateTo: string;
  key: string;
  label: string;
  metrics: OrderStoreMetrics;
};

export function buildOrderStoreRows(
  rows: OrderRow[],
  secondaryDimension: OrderSecondaryDimension,
  totalRows: OrderRow[] = [],
): OrderStoreTableRow[] {
  const result = new Map<string, OrderStoreTableRow>();

  for (const source of rows) {
    const { dimensionKey, storeKey } = splitDimensionKey(source.dim_key);
    if (!storeKey) continue;
    const row = result.get(storeKey) ?? createStoreRow(storeKey, storeLabel(source, storeKey));
    row.storeLabel = row.storeLabel || storeLabel(source, storeKey);
    const values = metricsFromOrderRow(source);
    if (secondaryDimension === 'total') {
      row.totals = addOrderMetrics(row.totals, values);
    } else if (dimensionKey) {
      row.breakdown[dimensionKey] = addOrderMetrics(row.breakdown[dimensionKey] ?? emptyOrderMetrics(), values);
      row.breakdownLabels[dimensionKey] ||= breakdownLabel(source, dimensionKey);
      row.totals = addOrderMetrics(row.totals, values);
    }
    result.set(storeKey, row);
  }

  if (secondaryDimension !== 'total') {
    for (const source of totalRows) {
      const { storeKey } = splitDimensionKey(source.dim_key);
      if (!storeKey) continue;
      const row = result.get(storeKey) ?? createStoreRow(storeKey, storeLabel(source, storeKey));
      row.storeLabel = storeLabel(source, storeKey);
      row.totals = metricsFromOrderRow(source);
      result.set(storeKey, row);
    }
  }

  return [...result.values()].sort((left, right) => (
    right.totals.netIncomeCent - left.totals.netIncomeCent
    || left.storeLabel.localeCompare(right.storeLabel, 'zh-CN')
  ));
}

export function buildOrderPeriodRows(
  records: OrderDailyRecord[],
  storeKey: string,
  granularity: TrendGranularity,
  dateFrom: string,
  dateTo: string,
): OrderPeriodRow[] {
  const recordsByDate = new Map(records.map((record) => [record.date, record]));
  return buildPeriodBuckets(granularity, dateFrom, dateTo).map((period) => {
    let complete = true;
    let metrics = emptyOrderMetrics();
    for (const date of datesBetween(period.dateFrom, period.dateTo)) {
      const record = recordsByDate.get(date);
      if (!record) {
        complete = false;
        continue;
      }
      for (const row of record.data.rows) {
        if (splitDimensionKey(row.dim_key).storeKey !== storeKey) continue;
        metrics = addOrderMetrics(metrics, metricsFromOrderRow(row));
      }
    }
    return { ...period, complete, metrics };
  });
}

export function buildOrderSnapshotPeriodRows(
  records: OrderPeriodSnapshotRecord[],
  storeKey: string,
  granularity: TrendGranularity,
  dateFrom: string,
  dateTo: string,
): OrderPeriodRow[] {
  const recordsByPeriod = new Map(records.map((record) => [record.period, record]));
  return buildPeriodBuckets(granularity, dateFrom, dateTo).map((period) => {
    const record = recordsByPeriod.get(period.key);
    let metrics = emptyOrderMetrics();
    if (record) {
      for (const row of record.data.rows) {
        if (splitDimensionKey(row.dim_key).storeKey !== storeKey) continue;
        metrics = addOrderMetrics(metrics, metricsFromOrderRow(row));
      }
    }
    return { ...period, complete: Boolean(record), metrics };
  });
}

function createStoreRow(storeKey: string, storeLabel: string): OrderStoreTableRow {
  return {
    breakdown: {},
    breakdownLabels: {},
    storeKey,
    storeLabel,
    totals: emptyOrderMetrics(),
  };
}

export function emptyOrderMetrics(): OrderStoreMetrics {
  return {
    avgOrderValueCent: 0,
    incomeAmountCent: 0,
    netIncomeCent: 0,
    orderCount: 0,
    paidAmountCent: 0,
    refundAmountCent: 0,
    refundRate: 0,
  };
}

export function metricsFromOrderRow(row: OrderRow): OrderStoreMetrics {
  const orderCount = Math.round(Number(row.order_count) || 0);
  const paidAmountCent = amountToCents(row.paid_amount);
  const refundAmountCent = amountToCents(row.refund_amount);
  const netIncomeCent = amountToCents(row.net_income);
  const incomeAmountCent = amountToCents(
    row.income_amount ?? ((Number(row.net_income) || 0) + (Number(row.refund_amount) || 0)),
  );
  const metrics = createMetrics({
    incomeAmountCent,
    netIncomeCent,
    orderCount,
    paidAmountCent,
    refundAmountCent,
  });
  return paidAmountCent === 0 && refundAmountCent === 0 && Number.isFinite(row.refund_rate)
    ? { ...metrics, refundRate: row.refund_rate }
    : metrics;
}

export function addOrderMetrics(target: OrderStoreMetrics, source: OrderStoreMetrics): OrderStoreMetrics {
  const result = createMetrics({
    incomeAmountCent: target.incomeAmountCent + source.incomeAmountCent,
    netIncomeCent: target.netIncomeCent + source.netIncomeCent,
    orderCount: target.orderCount + source.orderCount,
    paidAmountCent: target.paidAmountCent + source.paidAmountCent,
    refundAmountCent: target.refundAmountCent + source.refundAmountCent,
  });
  if (result.paidAmountCent !== 0 || result.refundAmountCent !== 0 || result.orderCount === 0) return result;
  return {
    ...result,
    refundRate: (
      target.refundRate * target.orderCount + source.refundRate * source.orderCount
    ) / result.orderCount,
  };
}

function createMetrics(values: Pick<OrderStoreMetrics, 'incomeAmountCent' | 'netIncomeCent' | 'orderCount' | 'paidAmountCent' | 'refundAmountCent'>): OrderStoreMetrics {
  return {
    ...values,
    avgOrderValueCent: values.orderCount > 0 ? Math.round(values.netIncomeCent / values.orderCount) : 0,
    refundRate: values.paidAmountCent > 0 ? values.refundAmountCent / values.paidAmountCent : 0,
  };
}

function splitDimensionKey(value: string): { dimensionKey: string | null; storeKey: string } {
  const separator = value.includes('|') ? '|' : value.includes(':') ? ':' : null;
  if (!separator) return { dimensionKey: null, storeKey: value };
  const [storeKey, dimensionKey] = value.split(separator, 2);
  return { dimensionKey: dimensionKey || null, storeKey };
}

function storeLabel(row: OrderRow, fallback: string): string {
  return String(row.dim_label || fallback).split(' · ', 1)[0] || fallback;
}

function breakdownLabel(row: OrderRow, fallback: string): string {
  const label = String(row.dim_label || '');
  const separator = label.lastIndexOf(' · ');
  return separator >= 0 ? label.slice(separator + 3) : fallback;
}

function buildPeriodBuckets(granularity: TrendGranularity, dateFrom: string, dateTo: string): Array<Omit<OrderPeriodRow, 'complete' | 'metrics'>> {
  if (dateTo < dateFrom) return [];
  const buckets: Array<Omit<OrderPeriodRow, 'complete' | 'metrics'>> = [];
  let cursor = parseDate(dateFrom);
  const end = parseDate(dateTo);
  while (cursor <= end) {
    if (granularity === 'day') {
      const date = formatDate(cursor);
      buckets.push({ dateFrom: date, dateTo: date, key: date, label: date.slice(5) });
      cursor = addDays(cursor, 1);
      continue;
    }

    if (granularity === 'week') {
      const start = startOfIsoWeek(cursor);
      const finish = addDays(start, 6);
      const periodFrom = formatDate(start < parseDate(dateFrom) ? parseDate(dateFrom) : start);
      const periodTo = formatDate(finish > end ? end : finish);
      buckets.push({
        dateFrom: periodFrom,
        dateTo: periodTo,
        key: isoWeekKey(start),
        label: periodFrom.slice(5) + ' 至 ' + periodTo.slice(5),
      });
      cursor = addDays(finish, 1);
      continue;
    }

    const start = startOfMonth(cursor);
    const finish = endOfMonth(start);
    const periodFrom = formatDate(start < parseDate(dateFrom) ? parseDate(dateFrom) : start);
    const periodTo = formatDate(finish > end ? end : finish);
    buckets.push({
      dateFrom: periodFrom,
      dateTo: periodTo,
      key: formatDate(start).slice(0, 7),
      label: formatDate(start).slice(0, 7),
    });
    cursor = addDays(finish, 1);
  }
  return buckets;
}

function datesBetween(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  for (let cursor = parseDate(dateFrom), end = parseDate(dateTo); cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatDate(cursor));
  }
  return dates;
}

function parseDate(value: string): Date {
  return new Date(value + 'T00:00:00Z');
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfIsoWeek(value: Date): Date {
  const next = new Date(value);
  const day = next.getUTCDay() || 7;
  next.setUTCDate(next.getUTCDate() - day + 1);
  return next;
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function isoWeekKey(value: Date): string {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return String(date.getUTCFullYear()) + '-W' + String(week).padStart(2, '0');
}
