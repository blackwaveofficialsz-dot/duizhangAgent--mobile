import { sumAmounts } from '@/utils/number';

import type {
  MealPeriodKey,
  MealPeriodTrendResult,
  MealPeriodTurnoverResult,
  RevenueTrendPoint,
  RevenueTrendResult,
} from '@/services/api/analytics';
import { selectedAnalyticsStoreKeys, type AnalyticsFilters } from './analyticsFilters';
import { buildMealScopeTrendSeries, buildMealTurnoverScopeTrendSeries, type ScopeMealPeriodTrendPoint, type ScopeMealPeriodTurnoverPoint } from './scopeTrendSeries';
import { resolveStoreScopeSelection, type ExplicitStoreScope, type StoreScopeNode } from './storeScope';
import type { TrendMovingAverageMeta } from './trendPeriod';

export type RevenueChartMode = 'net' | 'sources';
export type MealChartMode = 'business' | 'turnover';

export type DashboardTrendSeries = {
  available?: boolean;
  field?: string;
  id: string;
  label: string;
  lineType?: 'solid' | 'dashed' | 'dotted';
  points: DashboardChartPoint[];
  primary?: boolean;
  styleIndex: number;
};

export type DashboardChartPoint = RevenueTrendPoint & { total_table_count?: number };

export type DashboardChartModel = {
  detailScopeLabel?: string;
  metricLabel?: string;
  points: DashboardChartPoint[];
  series?: DashboardTrendSeries[];
  subtitle: string;
  valueMode: 'currency' | 'turnover';
};

type RevenueModelInput = {
  filters: AnalyticsFilters;
  mode: RevenueChartMode;
  revenue: RevenueTrendResult;
  revenueSources: { shop: RevenueTrendResult; takeout: RevenueTrendResult };
  stores: Array<{ key: string; label: string }>;
  scopeTree?: StoreScopeNode[];
};

export function buildRevenueChartModel({ filters, mode, revenue, revenueSources, stores, scopeTree = [] }: RevenueModelInput): DashboardChartModel {
  const storeKeys = selectedAnalyticsStoreKeys(filters);
  const labels = new Map(stores.map((store) => [store.key, store.label]));
  const scopeSelection = resolveStoreScopeSelection(filters.scopeKeys ?? ['ALL'], scopeTree);
  const explicitScopes = scopeSelection.scopes;

  if (mode === 'sources') {
    if (isScopeComparison(explicitScopes)) {
      const shopScopes = buildScopeTrendSeries(explicitScopes, revenueSources.shop.store_trends ?? {});
      const takeoutScopes = buildScopeTrendSeries(explicitScopes, revenueSources.takeout.store_trends ?? {});
      return {
        points: [],
        series: explicitScopes.flatMap((scope, index) => [
          sourceSeries(`scope:${scope.key}:shop`, `${scope.label} 堂食`, shopScopes[scope.key] ?? [], index, 'solid'),
          sourceSeries(`scope:${scope.key}:takeout`, `${scope.label} 外卖`, takeoutScopes[scope.key] ?? [], index, 'dashed'),
        ]),
        subtitle: '同范围同色 · 堂食实线 / 外卖虚线',
        valueMode: 'currency',
      };
    }
    const comparisonKeys = storeKeys.length > 1 ? storeKeys : [];
    const series = comparisonKeys.length
      ? comparisonKeys.flatMap((key, index) => [
        sourceSeries(`store:${key}:shop`, `${labels.get(key) ?? key} 堂食`, revenueSources.shop.store_trends?.[key] ?? [], index, 'solid'),
        sourceSeries(`store:${key}:takeout`, `${labels.get(key) ?? key} 外卖`, revenueSources.takeout.store_trends?.[key] ?? [], index, 'dashed'),
      ])
      : sourceComparisonSeries(revenueSources);
    return {
      points: [],
      series,
      subtitle: comparisonKeys.length ? '同门店同色 · 堂食实线 / 外卖虚线' : '堂食实线 / 外卖虚线',
      valueMode: 'currency',
    };
  }

  if (isScopeComparison(explicitScopes) && revenue.store_trends) {
    const scopeTrends = buildScopeTrendSeries(explicitScopes, revenue.store_trends);
    return {
      points: [],
      series: explicitScopes.map((scope, index) => sourceSeries(`scope:${scope.key}`, scope.label, scopeTrends[scope.key] ?? [], index, 'solid')),
      subtitle: `${explicitScopes.length} 个已选范围 · 范围对比`,
      valueMode: 'currency',
    };
  }

  if (storeKeys.length > 1 && revenue.store_trends) {
    return {
      points: [],
      series: storeKeys.map((key, index) => sourceSeries(`store:${key}`, labels.get(key) ?? key, revenue.store_trends?.[key] ?? [], index, 'solid')),
      subtitle: `${storeKeys.length} 家门店 · 门店对比`,
      valueMode: 'currency',
    };
  }

  const movingAverages = revenue.moving_averages ?? defaultMovingAverages(filters.granularity ?? revenue.granularity ?? 'day', revenue.points);
  return {
    points: revenue.points,
    series: movingAverageSeries('revenue:net', '净实收', revenue.points, movingAverages, 'revenue'),
    subtitle: movingAverages.map((item) => item.label).join(' / '),
    valueMode: 'currency',
  };
}

export function buildMealChartModel(
  mealTrend: MealPeriodTrendResult,
  turnover: MealPeriodTurnoverResult | undefined,
  mode: MealChartMode,
  periodKey: MealPeriodKey,
  scopes: ExplicitStoreScope[] = [],
): DashboardChartModel {
  const label = MEAL_PERIOD_LABELS[periodKey];
  if (mode === 'turnover') {
    if (!turnover?.eligible_store_count) {
      return {
        metricLabel: `${label}翻台率`,
        points: [],
        series: [],
        subtitle: `${label} · 暂无有效桌台`,
        valueMode: 'turnover',
      };
    }
    if (scopes.length) {
      const scopeTrends = buildMealTurnoverScopeTrendSeries(scopes, turnover ?? null);
      if (scopes.length > 1) {
        return {
          metricLabel: `${label}翻台率`,
          points: [],
          series: scopes.map((scope, index) => sourceSeries(
            `scope:${scope.key}`,
            scope.label,
            mealTurnoverPoints(scopeTrends[scope.key] ?? [], periodKey, scopeTableCount(turnover, scope.storeKeys)),
            index,
            'solid',
          )),
          subtitle: `${scopes.length} 个已选范围 · 范围对比`,
          valueMode: 'turnover',
        };
      }

      const scope = scopes[0];
      const points = mealTurnoverPoints(scopeTrends[scope.key] ?? [], periodKey, scopeTableCount(turnover, scope.storeKeys));
      return {
        detailScopeLabel: scope.label,
        metricLabel: `${label}翻台率`,
        points,
        series: movingAverageSeries(`scope:${scope.key}`, scope.label, points, defaultMovingAverages('day', points)),
        subtitle: `${scope.label} · 次/桌/日`,
        valueMode: 'turnover',
      };
    }

    const points = mealTurnoverPoints(turnover?.points ?? [], periodKey, turnover?.table_count ?? 0);
    return {
      metricLabel: `${label}翻台率`,
      points,
      series: movingAverageSeries(`meal:turnover:${periodKey}`, `${label}翻台率`, points, defaultMovingAverages('day', points)),
      subtitle: `${label} · 次/桌/日`,
      valueMode: 'turnover',
    };
  }

  if (scopes.length > 1 && mealTrend.store_trends) {
    const scopeTrends = buildMealScopeTrendSeries(scopes, mealTrend.store_trends);
    return {
      metricLabel: label,
      points: [],
      series: scopes.map((scope, index) => sourceSeries(
        `scope:${scope.key}`,
        scope.label,
        mealBusinessPoints(scopeTrends[scope.key] ?? [], periodKey, (date) => scope.storeKeys.some((key) => !mealTrend.store_trends?.[key]?.some((point) => point.date === date))),
        index,
        'solid',
      )),
      subtitle: `${scopes.length} 个已选范围 · 范围对比`,
      valueMode: 'currency',
    };
  }

  if (scopes.length > 1) {
    return {
      metricLabel: label,
      points: [],
      series: [],
      subtitle: `${scopes.length} 个已选范围 · 范围趋势不可用`,
      valueMode: 'currency',
    };
  }

  const points = mealBusinessPoints(mealTrend.points, periodKey);
  return {
    detailScopeLabel: scopes.length === 1 ? scopes[0].label : undefined,
    metricLabel: label,
    points,
    series: movingAverageSeries(`meal:business:${periodKey}`, label, points, defaultMovingAverages('day', points)),
    subtitle: `${label} · MA7 / MA30 / MA180`,
    valueMode: 'currency',
  };
}

function mealTurnoverPoints(
  points: Array<NonNullable<MealPeriodTurnoverResult['points']>[number] | ScopeMealPeriodTurnoverPoint>,
  periodKey: MealPeriodKey,
  tableCount: number,
): DashboardChartPoint[] {
  return points.flatMap((point) => {
    const value = point[periodKey];
    return value ? [{
      ma180: value.ma180 ?? null,
      ma30: value.ma30 ?? null,
      ma7: value.ma7 ?? null,
      missing: false,
      net_income: value.turnover ?? 0,
      order_count: value.shop_order_count,
      period: point.date,
      total_table_count: tableCount,
    }] : [];
  });
}

function scopeTableCount(turnover: MealPeriodTurnoverResult | undefined, storeKeys: string[]): number {
  const keys = new Set(storeKeys);
  return (turnover?.store_summaries ?? [])
    .filter((store) => keys.has(store.store_key) && Number(store.table_count) > 0)
    .reduce((sum, store) => sum + Number(store.table_count), 0);
}

function mealBusinessPoints(
  points: Array<MealPeriodTrendResult['points'][number] | ScopeMealPeriodTrendPoint>,
  periodKey: MealPeriodKey,
  isMissing = (_date: string) => false,
): RevenueTrendPoint[] {
  return points.map((point) => {
    const value = point[periodKey];
    return {
      ma180: value.ma180 ?? null,
      ma30: value.ma30 ?? null,
      ma7: value.ma7 ?? null,
      missing: isMissing(point.date),
      net_income: value.net_income,
      order_count: value.order_count,
      period: point.date,
    };
  });
}

export const MEAL_PERIOD_OPTIONS: Array<{ key: MealPeriodKey; label: string }> = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'afternoon_tea', label: '下午茶' },
  { key: 'dinner', label: '晚餐' },
  { key: 'late_night', label: '夜宵' },
];

const MEAL_PERIOD_LABELS = Object.fromEntries(MEAL_PERIOD_OPTIONS.map((item) => [item.key, item.label])) as Record<MealPeriodKey, string>;

function sourceSeries(id: string, label: string, points: DashboardChartPoint[], styleIndex: number, lineType: DashboardTrendSeries['lineType']): DashboardTrendSeries {
  return { available: true, field: 'net_income', id, label, lineType, points, primary: true, styleIndex: styleIndex % 8 };
}

function sourceComparisonSeries(revenueSources: RevenueModelInput['revenueSources']): DashboardTrendSeries[] {
  const shopMain = sourceSeries('source:shop', '堂食', revenueSources.shop.points, 0, 'solid');
  const takeoutMain = sourceSeries('source:takeout', '外卖', revenueSources.takeout.points, 1, 'solid');
  const shopAverages = movingAverageSeries('source:shop', '堂食', revenueSources.shop.points, revenueSources.shop.moving_averages ?? [], 'source:shop', true, 2).slice(1);
  const takeoutAverages = movingAverageSeries('source:takeout', '外卖', revenueSources.takeout.points, revenueSources.takeout.moving_averages ?? [], 'source:takeout', true, 5).slice(1);
  return [shopMain, takeoutMain, ...shopAverages, ...takeoutAverages];
}

function movingAverageSeries(
  idPrefix: string,
  primaryLabel: string,
  points: RevenueTrendPoint[],
  metadata: TrendMovingAverageMeta[],
  averageIdPrefix = idPrefix,
  prefixAverageLabels = false,
  styleOffset = 1,
): DashboardTrendSeries[] {
  return [
    sourceSeries(idPrefix, primaryLabel, points, 0, 'solid'),
    ...metadata.map((item, index) => ({
      available: item.available,
      field: item.field,
      id: `${averageIdPrefix}:${item.field}`,
      label: `${prefixAverageLabels ? `${primaryLabel} ` : ''}${item.available ? item.label : `${item.label}（数据不足 ${item.available_periods}/${item.window}）`}`,
      lineType: index === 0 ? 'solid' as const : index === 1 ? 'dashed' as const : 'dotted' as const,
      points,
      primary: false,
      styleIndex: (index + styleOffset) % 8,
    })),
  ];
}

function isScopeComparison(scopes: ExplicitStoreScope[]): boolean {
  return scopes.length > 1 || scopes.some((scope) => scope.type !== 'store');
}

function defaultMovingAverages(granularity: 'day' | 'week' | 'month', points: RevenueTrendPoint[]): TrendMovingAverageMeta[] {
  const windows = granularity === 'week'
    ? [['ma4', 'MA4', 4], ['ma12', 'MA12', 12], ['ma26', 'MA26', 26]]
    : granularity === 'month'
      ? [['ma3', 'MA3', 3], ['ma6', 'MA6', 6], ['ma12', 'MA12', 12]]
      : [['ma7', 'MA7', 7], ['ma30', 'MA30', 30], ['ma180', 'MA180', 180]];
  return windows.map(([field, label, window]) => ({
    available: points.some((point) => typeof point[String(field)] === 'number'),
    available_periods: points.length,
    field: String(field),
    label: String(label),
    window: Number(window),
  }));
}

function buildScopeTrendSeries(
  scopes: ExplicitStoreScope[],
  storeTrends: Record<string, RevenueTrendPoint[]>,
): Record<string, RevenueTrendPoint[]> {
  return Object.fromEntries(scopes.map((scope) => [scope.key, buildScopePoints(scope, storeTrends)]));
}

function buildScopePoints(scope: ExplicitStoreScope, storeTrends: Record<string, RevenueTrendPoint[]>): RevenueTrendPoint[] {
  const periods = [...new Set(scope.storeKeys.flatMap((key) => (storeTrends[key] ?? []).map((point) => point.period)))].sort();
  return periods.map((period) => {
    const points = scope.storeKeys.map((key) => (storeTrends[key] ?? []).find((point) => point.period === period));
    const availablePoints = points.filter((point): point is RevenueTrendPoint => Boolean(point && !point.missing));
    return {
      period,
      net_income: sumAmounts(availablePoints.map((point) => point.net_income)),
      order_count: availablePoints.reduce((sum, point) => sum + Number(point.order_count ?? 0), 0),
      ma7: null,
      ma30: null,
      ma180: null,
      missing: false,
      ...(points.some((point) => point?.in_progress) ? { in_progress: true } : {}),
      ...(points.find((point) => point?.period_start)?.period_start ? { period_start: points.find((point) => point?.period_start)?.period_start } : {}),
      ...(points.find((point) => point?.period_end)?.period_end ? { period_end: points.find((point) => point?.period_end)?.period_end } : {}),
    };
  });
}
