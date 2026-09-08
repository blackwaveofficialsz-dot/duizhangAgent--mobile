import { sumAmounts } from '@/utils/number';

import type {
  LaborTrendPoint,
  MealPeriodKey,
  MealPeriodRow,
  MealPeriodTrendPoint,
  MealPeriodTurnoverPoint,
  MealPeriodTurnoverResult,
  ProductTrendPoint,
  RevenueTrendPoint,
} from '@/services/api/analytics';
import { uniqueScopeKeys, type ExplicitStoreScope } from './storeScope';

export const MEAL_PERIOD_SERIES: Array<[MealPeriodKey, string]> = [
  ['breakfast', '早餐'],
  ['lunch', '午餐'],
  ['afternoon_tea', '下午茶'],
  ['dinner', '晚餐'],
  ['late_night', '夜宵'],
];

export type ScopeMealPeriodRow = Omit<MealPeriodRow, 'avg_order_value' | 'ma7' | 'ma30' | 'ma180'> & {
  avg_order_value: number | null;
  ma7: null;
  ma30: null;
  ma180: null;
};
export type ScopeMealPeriodTrendPoint = { date: string } & Record<MealPeriodKey, ScopeMealPeriodRow>;
export type ScopeMealPeriodTurnoverPoint = { date: string } & Record<MealPeriodKey, {
  ma7: number | null;
  ma30: number | null;
  ma180: number | null;
  shop_order_count: number;
  turnover: number | null;
}>;
export type ScopeLaborTrendPoint = LaborTrendPoint;
export type ScopeMealPeriodTurnoverResult = Omit<MealPeriodTurnoverResult, 'points' | 'summary'> & {
  points: ScopeMealPeriodTurnoverPoint[];
  summary: Array<Omit<MealPeriodTurnoverResult['summary'][number], 'avg_daily_turnover'> & { avg_daily_turnover: number | null }>;
};

export function buildScopeTrendSeries(
  scopes: ExplicitStoreScope[],
  storeTrends: Record<string, RevenueTrendPoint[]>,
): Record<string, RevenueTrendPoint[]> {
  return Object.fromEntries(scopes.map((scope) => [scope.key, buildRevenueScopePoints(scope.storeKeys, storeTrends)]));
}

export function buildMealScopeTrendSeries(
  scopes: ExplicitStoreScope[],
  storeTrends: Record<string, MealPeriodTrendPoint[]>,
): Record<string, ScopeMealPeriodTrendPoint[]> {
  return Object.fromEntries(scopes.map((scope) => [scope.key, buildMealScopePoints(scope.storeKeys, storeTrends)]));
}

export function buildMealTurnoverScopeTrendSeries(
  scopes: ExplicitStoreScope[],
  result: MealPeriodTurnoverResult | null,
): Record<string, ScopeMealPeriodTurnoverPoint[]> {
  const includeMovingAverages = scopes.length === 1;
  return Object.fromEntries(scopes.map((scope) => [
    scope.key,
    selectMealTurnover(result, scope.storeKeys, includeMovingAverages)?.points ?? [],
  ]));
}

export function selectMealTurnover(
  result: MealPeriodTurnoverResult | null,
  storeKeys: string[],
  includeMovingAverages = false,
): ScopeMealPeriodTurnoverResult | null {
  if (!result || !storeKeys.length) return null;

  const keys = uniqueScopeKeys(storeKeys);
  const selectedSummaries = (result.store_summaries ?? []).filter((store) => keys.includes(store.store_key));
  const validSummaries = selectedSummaries.filter((store) => Number(store.table_count) > 0);
  const validKeys = new Set(validSummaries.map((store) => store.store_key));
  const tableCount = validSummaries.reduce((sum, store) => sum + Number(store.table_count), 0);
  const trends = result.store_trends ?? {};
  const resultKeys = new Set((result.store_summaries ?? [])
    .filter((store) => Number(store.table_count) > 0)
    .map((store) => store.store_key));
  const completeResultSelected = resultKeys.size === validKeys.size && [...resultKeys].every((key) => validKeys.has(key));
  const movingAveragePoints = completeResultSelected
    ? result.points ?? []
    : validKeys.size === 1 ? trends[[...validKeys][0]] ?? [] : [];
  const dates = [...new Set([...validKeys].flatMap((key) => (trends[key] ?? []).map((point) => point.date)))].sort();
  const points = dates.map((date) => ({
    date,
    ...Object.fromEntries(MEAL_PERIOD_SERIES.map(([periodKey]) => {
      const orderCount = keys.reduce((sum, key) => {
        if (!validKeys.has(key)) return sum;
        const point = (trends[key] ?? []).find((item) => item.date === date);
        return sum + Number(point?.[periodKey].shop_order_count ?? 0);
      }, 0);
      const averagePoint = movingAveragePoints.find((point) => point.date === date)?.[periodKey];
      return [periodKey, {
        shop_order_count: orderCount,
        turnover: tableCount ? orderCount / tableCount : null,
        ma7: includeMovingAverages ? averagePoint?.ma7 ?? null : null,
        ma30: includeMovingAverages ? averagePoint?.ma30 ?? null : null,
        ma180: includeMovingAverages ? averagePoint?.ma180 ?? null : null,
      }];
    })),
  })) as ScopeMealPeriodTurnoverPoint[];
  const displayPoints = includeMovingAverages ? fillTurnoverMovingAverages(points) : points;

  return {
    ...result,
    data_status: validSummaries.length ? 'ok' : 'missing',
    eligible_store_count: validSummaries.length,
    table_count: tableCount,
    excluded_stores: (result.excluded_stores ?? []).filter((store) => keys.includes(store.store_key)),
    summary: MEAL_PERIOD_SERIES.map(([periodKey, periodLabel]) => {
      const orderCount = validSummaries.reduce((sum, store) => {
        const row = store.summary.find((item) => item.period_key === periodKey);
        return sum + Number(row?.shop_order_count ?? 0);
      }, 0);
      return {
        period_key: periodKey,
        period_label: periodLabel,
        shop_order_count: orderCount,
        avg_daily_turnover: tableCount && result.day_count ? orderCount / result.day_count / tableCount : null,
      };
    }),
    points: displayPoints,
    store_summaries: validSummaries,
    store_trends: Object.fromEntries([...validKeys].map((key) => [key, trends[key] ?? []])),
  };
}

function fillTurnoverMovingAverages(points: ScopeMealPeriodTurnoverPoint[]): ScopeMealPeriodTurnoverPoint[] {
  return points.map((point, index) => ({
    date: point.date,
    ...Object.fromEntries(MEAL_PERIOD_SERIES.map(([periodKey]) => {
      const row = point[periodKey];
      return [periodKey, {
        ...row,
        ma7: row.ma7 ?? turnoverMovingAverage(points, periodKey, index, 7, true),
        ma30: row.ma30 ?? turnoverMovingAverage(points, periodKey, index, 30, false),
        ma180: row.ma180 ?? turnoverMovingAverage(points, periodKey, index, 180, false),
      }];
    })),
  })) as ScopeMealPeriodTurnoverPoint[];
}

function turnoverMovingAverage(
  points: ScopeMealPeriodTurnoverPoint[],
  periodKey: MealPeriodKey,
  index: number,
  window: number,
  includeZero: boolean,
): number | null {
  const values = points
    .slice(Math.max(0, index - window + 1), index + 1)
    .map((point) => point[periodKey])
    .filter((row) => includeZero || row.shop_order_count > 0)
    .flatMap((row) => row.turnover === null ? [] : [row.turnover]);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
}

export function buildScopeProductTrendSeries(
  scopes: ExplicitStoreScope[],
  storeTrends: Record<string, ProductTrendPoint[]>,
): Record<string, ProductTrendPoint[]> {
  return Object.fromEntries(scopes.map((scope) => [scope.key, buildProductScopePoints(scope.storeKeys, storeTrends)]));
}

export function buildLaborScopeTrendSeries(
  scopes: ExplicitStoreScope[],
  storeTrends: Record<string, LaborTrendPoint[]>,
): Record<string, ScopeLaborTrendPoint[]> {
  return Object.fromEntries(scopes.map((scope) => [
    scope.key,
    buildLaborScopePoints(scope.departmentKeys?.length ? scope.departmentKeys : scope.storeKeys, storeTrends),
  ]));
}

function buildRevenueScopePoints(keys: string[], storeTrends: Record<string, RevenueTrendPoint[]>): RevenueTrendPoint[] {
  return periods(keys, storeTrends).map((period) => {
    const points = pointsForPeriod(keys, storeTrends, period);
    return {
      period,
          net_income: sumAmounts(points.map((point) => point?.net_income)),
      order_count: points.reduce((sum, point) => sum + Number(point?.order_count ?? 0), 0),
      ma7: null,
      ma30: null,
      ma180: null,
      missing: points.some((point) => !point || point.missing),
      ...(points.some((point) => point?.in_progress) ? { in_progress: true } : {}),
    };
  });
}

function buildMealScopePoints(keys: string[], storeTrends: Record<string, MealPeriodTrendPoint[]>): ScopeMealPeriodTrendPoint[] {
  return dates(keys, storeTrends).map((date) => {
    const points = pointsForDate(keys, storeTrends, date);
    return {
      date,
      ...Object.fromEntries(MEAL_PERIOD_SERIES.map(([periodKey, periodLabel]) => {
        const rows = points.map((point) => point?.[periodKey]);
        const orderCount = rows.reduce((sum, row) => sum + Number(row?.order_count ?? 0), 0);
        const paidAmount = sumAmounts(rows.map((row) => row?.paid_amount));
        const incomeAmount = sumAmounts(rows.map((row) => row?.income_amount));
        const refundAmount = sumAmounts(rows.map((row) => row?.refund_amount));
        return [periodKey, {
          period_key: periodKey,
          period_label: periodLabel,
          order_count: orderCount,
          paid_amount: paidAmount,
          income_amount: incomeAmount,
          refund_amount: refundAmount,
          net_income: sumAmounts([incomeAmount, -refundAmount]),
          avg_order_value: orderCount ? paidAmount / orderCount : null,
          ma7: null,
          ma30: null,
          ma180: null,
        }];
      })),
    } as ScopeMealPeriodTrendPoint;
  });
}

function buildProductScopePoints(keys: string[], storeTrends: Record<string, ProductTrendPoint[]>): ProductTrendPoint[] {
  return periods(keys, storeTrends).map((period) => {
    const points = pointsForPeriod(keys, storeTrends, period);
    const reference = points.find((point) => point);
    return {
      period,
      ...(reference?.period_start ? { period_start: reference.period_start } : {}),
      ...(reference?.period_end ? { period_end: reference.period_end } : {}),
      quantity: points.reduce((sum, point) => sum + Number(point?.quantity ?? 0), 0),
          sales_amount: sumAmounts(points.map((point) => point?.sales_amount)),
      order_count: points.reduce((sum, point) => sum + Number(point?.order_count ?? 0), 0),
      missing: points.some((point) => !point || point.missing),
      ma7: null,
      ma30: null,
      ma180: null,
    };
  });
}

function buildLaborScopePoints(keys: string[], storeTrends: Record<string, LaborTrendPoint[]>): ScopeLaborTrendPoint[] {
  return periods(keys, storeTrends).map((period) => {
    const points = pointsForPeriod(keys, storeTrends, period);
      const netRevenue = sumAmounts(points.map((point) => point?.net_revenue));
    const actualHours = points.reduce((sum, point) => sum + Number(point?.actual_hours ?? 0), 0);
    const plannedHours = points.reduce((sum, point) => sum + Number(point?.planned_hours ?? 0), 0);
    const reference = points.find((point) => point);
    const synced = points.some((point) => point?.hours_synced === false)
      ? false
      : points.length > 0 && points.every((point) => point?.hours_synced === true) ? true : undefined;
    return {
      period,
      ...(reference?.period_start ? { period_start: reference.period_start } : {}),
      ...(reference?.period_end ? { period_end: reference.period_end } : {}),
      ...(points.some((point) => point?.in_progress) ? { in_progress: true } : {}),
      ...(synced === undefined ? {} : { hours_synced: synced }),
      net_revenue: netRevenue,
      actual_hours: actualHours,
      planned_hours: plannedHours,
      actual_revenue_per_hour: actualHours ? netRevenue / actualHours : null,
      planned_revenue_per_hour: plannedHours ? netRevenue / plannedHours : null,
      headcount: points.reduce((sum, point) => sum + Number(point?.headcount ?? 0), 0),
      missing: points.some((point) => !point || point.missing),
      actual_hours_ma7: null,
      actual_hours_ma30: null,
      actual_hours_ma180: null,
      actual_revenue_per_hour_ma7: null,
      actual_revenue_per_hour_ma30: null,
      actual_revenue_per_hour_ma180: null,
      planned_hours_ma7: null,
      planned_hours_ma30: null,
      planned_hours_ma180: null,
      planned_revenue_per_hour_ma7: null,
      planned_revenue_per_hour_ma30: null,
      planned_revenue_per_hour_ma180: null,
    };
  });
}

function periods<T extends { period: string }>(keys: string[], storeTrends: Record<string, T[]>): string[] {
  return [...new Set(uniqueScopeKeys(keys).flatMap((key) => (storeTrends[key] ?? []).map((point) => point.period)))].sort();
}

function dates<T extends { date: string }>(keys: string[], storeTrends: Record<string, T[]>): string[] {
  return [...new Set(uniqueScopeKeys(keys).flatMap((key) => (storeTrends[key] ?? []).map((point) => point.date)))].sort();
}

function pointsForPeriod<T extends { period: string }>(keys: string[], storeTrends: Record<string, T[]>, period: string): Array<T | undefined> {
  return uniqueScopeKeys(keys).map((key) => (storeTrends[key] ?? []).find((point) => point.period === period));
}

function pointsForDate<T extends { date: string }>(keys: string[], storeTrends: Record<string, T[]>, date: string): Array<T | undefined> {
  return uniqueScopeKeys(keys).map((key) => (storeTrends[key] ?? []).find((point) => point.date === date));
}
