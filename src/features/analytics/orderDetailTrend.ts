import type { DashboardChartPoint, DashboardTrendSeries } from './dashboardChartModels';
import type { OrderPeriodRow } from './orderStoreTable';
import type { TrendGranularity, TrendMovingAverageMeta } from './trendPeriod';

type AverageConfig = { field: string; label: string; window: number };

const ORDER_DETAIL_AVERAGES: Record<TrendGranularity, AverageConfig[]> = {
  day: [
    { field: 'ma7', label: 'MA7', window: 7 },
    { field: 'ma30', label: 'MA30', window: 30 },
    { field: 'ma180', label: 'MA180', window: 180 },
  ],
  week: [
    { field: 'ma4', label: 'MA4', window: 4 },
    { field: 'ma12', label: 'MA12', window: 12 },
    { field: 'ma26', label: 'MA26', window: 26 },
  ],
  month: [
    { field: 'ma3', label: 'MA3', window: 3 },
    { field: 'ma6', label: 'MA6', window: 6 },
    { field: 'ma12', label: 'MA12', window: 12 },
  ],
};

export type OrderDetailTrendModel = {
  points: DashboardChartPoint[];
  series: DashboardTrendSeries[];
};

export function buildOrderDetailTrendModel(
  periods: OrderPeriodRow[],
  granularity: TrendGranularity,
): OrderDetailTrendModel {
  const points = withMovingAverages(periods, ORDER_DETAIL_AVERAGES[granularity]);
  return {
    points,
    series: buildOrderDetailTrendSeries(points, granularity),
  };
}

export function buildOrderDetailTrendSeries(
  points: DashboardChartPoint[],
  granularity: TrendGranularity,
  movingAverages?: TrendMovingAverageMeta[],
): DashboardTrendSeries[] {
  const averages = normalizeMovingAverages(granularity, movingAverages);
  const availablePeriods = points.filter((point) => !point.missing).length;
  return buildSeries(points, averages, availablePeriods);
}

function withMovingAverages(periods: OrderPeriodRow[], averages: AverageConfig[]): DashboardChartPoint[] {
  const points = periods.map((period) => ({
    missing: isMissingPeriod(period),
    net_income: period.metrics.netIncomeCent / 100,
    order_count: period.metrics.orderCount,
    period: period.key,
    period_end: period.dateTo,
    period_start: period.dateFrom,
  })) as DashboardChartPoint[];

  averages.forEach((average) => {
    points.forEach((point, index) => {
      const available = points.slice(Math.max(0, index - average.window + 1), index + 1)
        .filter((item) => !item.missing && Number.isFinite(item.net_income));
      point[average.field] = available.length
        ? roundCurrency(available.reduce((sum, item) => sum + item.net_income, 0) / available.length)
        : null;
    });
  });

  return points;
}

function buildSeries(points: DashboardChartPoint[], averages: AverageConfig[], availablePeriods: number): DashboardTrendSeries[] {
  return [
    { available: true, field: 'net_income', id: 'order-detail:net', label: '净实收', lineType: 'solid', points, primary: true, styleIndex: 0 },
    ...averages.map((average, index) => {
      const available = points.some((point) => typeof point[average.field] === 'number');
      return {
        available,
        field: average.field,
        id: `order-detail:${average.field}`,
        label: available ? average.label : `${average.label}（数据不足 ${availablePeriods}/${average.window}）`,
        lineType: index === 0 ? 'solid' as const : index === 1 ? 'dashed' as const : 'dotted' as const,
        points,
        primary: false,
        styleIndex: index + 1,
      };
    }),
  ];
}

function normalizeMovingAverages(granularity: TrendGranularity, movingAverages?: TrendMovingAverageMeta[]): AverageConfig[] {
  const candidates = (movingAverages ?? [])
    .filter((item) => item.field && item.field !== 'net_income')
    .map((item) => ({ field: item.field, label: item.label, window: item.window }));
  return candidates.length ? candidates : ORDER_DETAIL_AVERAGES[granularity];
}

function isMissingPeriod(period: OrderPeriodRow): boolean {
  if (period.complete) return false;
  const metrics = period.metrics;
  return metrics.orderCount <= 0
    && metrics.incomeAmountCent === 0
    && metrics.netIncomeCent === 0
    && metrics.paidAmountCent === 0
    && metrics.refundAmountCent === 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
