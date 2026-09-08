import type { LaborRow, LaborTrendPoint, LaborTrendResult } from '@/services/api/analytics';
import { sumAmounts } from '@/utils/number';
import { buildLaborScopeTrendSeries } from './scopeTrendSeries';
import type { ExplicitStoreScope } from './storeScope';
import type { TrendMovingAverageMeta } from './trendPeriod';
import { laborCompletenessStatus, type LaborCompletenessStatus } from './laborCompleteness';

export type LaborChartPoint = {
  actual_hours: number;
  actual_revenue_per_hour: number | null;
  availability?: LaborCompletenessStatus;
  headcount: number;
  hours_synced?: boolean | null;
  in_progress?: boolean;
  missing: boolean;
  net_revenue: number;
  period: string;
  period_end?: string;
  period_start?: string;
  planned_hours: number;
  planned_revenue_per_hour: number | null;
  [field: string]: string | number | boolean | null | undefined;
};

export type LaborChartModel = {
  allPoints: LaborChartPoint[];
  comparisonScopes: LaborComparisonScope[];
  movingAverages?: TrendMovingAverageMeta[];
  points: LaborChartPoint[];
};

export type LaborComparisonScope = {
  id: string;
  label: string;
  points: LaborChartPoint[];
  styleIndex: number;
};

export type LaborComparisonSeries = {
  available: true;
  field: string;
  id: string;
  label: string;
  lineType: 'solid' | 'dashed';
  points: LaborChartPoint[];
  primary: true;
  styleIndex: number;
};

export type LaborSummary = {
  actualEfficiency: number | null;
  actualHours: number;
  headcount: number;
  netRevenue: number;
  plannedEfficiency: number | null;
  plannedHours: number;
};

export function summarizeLaborRows(rows: LaborRow[]): LaborSummary {
  return summarizeLabor(rows);
}

export function summarizeLaborPoints(points: LaborChartPoint[]): LaborSummary {
  return summarizeLabor(points);
}

function summarizeLabor(values: Array<Pick<LaborChartPoint, 'actual_hours' | 'headcount' | 'net_revenue' | 'planned_hours'>>): LaborSummary {
  const totals = values.reduce((sum, value) => ({
    actualHours: sum.actualHours + Number(value.actual_hours || 0),
    headcount: sum.headcount + Number(value.headcount || 0),
      netRevenue: sumAmounts([sum.netRevenue, value.net_revenue]),
    plannedHours: sum.plannedHours + Number(value.planned_hours || 0),
  }), { actualHours: 0, headcount: 0, netRevenue: 0, plannedHours: 0 });
  return {
    ...totals,
    actualEfficiency: ratio(totals.netRevenue, totals.actualHours),
    plannedEfficiency: ratio(totals.netRevenue, totals.plannedHours),
  };
}

export function buildLaborChartModel(trend: LaborTrendResult, _departmentKeys: string[], scopes: ExplicitStoreScope[] = []): LaborChartModel {
  const allPoints = trend.points.map(toChartPoint);
  const scopeTrends = scopes.length > 1 && trend.store_trends ? buildLaborScopeTrendSeries(scopes, trend.store_trends) : {};
  const comparisonScopes = scopes.length > 1 ? scopes.map((scope, styleIndex) => ({
    id: `scope:${scope.key}`,
    label: scope.label,
    points: (scopeTrends[scope.key] ?? []).map(toChartPoint),
    styleIndex,
  })) : [];
  return {
    allPoints,
    comparisonScopes,
    movingAverages: comparisonScopes.length ? [] : trend.moving_averages,
    points: allPoints.filter((point) => point.availability === 'visible'),
  };
}

export function laborComparisonSeries(scopes: LaborComparisonScope[], metric: 'efficiency' | 'hours'): LaborComparisonSeries[] {
  const actualField = metric === 'hours' ? 'actual_hours' : 'actual_revenue_per_hour';
  const plannedField = metric === 'hours' ? 'planned_hours' : 'planned_revenue_per_hour';
  return scopes.flatMap((scope) => [
    { available: true, field: actualField, id: `${scope.id}:actual`, label: `${scope.label} 实际`, lineType: 'solid', points: scope.points, primary: true, styleIndex: scope.styleIndex },
    { available: true, field: plannedField, id: `${scope.id}:planned`, label: `${scope.label} 排班`, lineType: 'dashed', points: scope.points, primary: true, styleIndex: scope.styleIndex },
  ]);
}

function toChartPoint(point: LaborTrendPoint): LaborChartPoint {
  return {
    ...point,
    actual_revenue_per_hour: ratio(Number(point.net_revenue || 0), Number(point.actual_hours || 0)),
    availability: laborCompletenessStatus(point),
    planned_revenue_per_hour: ratio(Number(point.net_revenue || 0), Number(point.planned_hours || 0)),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}
