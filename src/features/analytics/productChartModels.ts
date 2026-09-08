import type { ProductRow, ProductTrendPoint, ProductTrendResult } from '@/services/api/analytics';
import { buildScopeProductTrendSeries } from './scopeTrendSeries';
import type { ExplicitStoreScope } from './storeScope';
import { trendPointStatusText, type TrendGranularity } from './trendPeriod';

export type ProductChartSeries = {
  available: boolean;
  field: string;
  id: string;
  label: string;
  lineType: 'solid' | 'dashed' | 'dotted';
  points: ProductTrendPoint[];
  primary: boolean;
  styleIndex: number;
};

export type ProductChartModel = {
  granularity: TrendGranularity;
  points: ProductTrendPoint[];
  selectionMode?: 'products' | 'scopes' | 'single';
  series: ProductChartSeries[];
  subtitle: string;
  unit: '份';
};

export function normalizeProductSelection(rows: Pick<ProductRow, 'product_key'>[], currentKeys: string[]): string[] {
  const available = rows.map((row) => row.product_key).filter(Boolean);
  const selected = [...new Set(currentKeys)].filter((key) => available.includes(key)).slice(0, 5);
  if (selected.length === 1 && currentKeys.length === 1) return selected;
  for (const key of available) {
    if (selected.length >= 2) break;
    if (!selected.includes(key)) selected.push(key);
  }
  return selected.slice(0, 5);
}

export function buildMultiProductChartModel(results: Record<string, ProductTrendResult>, scopes: ExplicitStoreScope[], selectedProductKeys: string[] = []): ProductChartModel | null {
  const entries = Object.entries(results);
  const trends = entries.map(([, trend]) => trend);
  if (!trends.length) return null;
  const selectedCount = [...new Set(selectedProductKeys.filter(Boolean))].length;
  if (selectedCount <= 1 && trends.length === 1) return buildProductChartModel(trends[0], scopes);
  const first = trends[0];
  return {
    granularity: first.granularity ?? 'day',
    points: [],
    selectionMode: 'products',
    series: entries.map(([key, trend], index) => quantitySeries(`product:${key}`, trend.product_name || key, trend.points, index)),
    subtitle: `${selectedCount > 1 ? selectedCount : trends.length} 款产品 · 销量对比`,
    unit: '份',
  };
}

export function buildProductChartModel(result: ProductTrendResult, scopes: ExplicitStoreScope[]): ProductChartModel {
  const granularity = result.granularity ?? 'day';
  if (scopes.length > 1) {
    const scopeTrends = buildScopeProductTrendSeries(scopes, result.store_trends ?? {});
    return {
      granularity,
      points: [],
      selectionMode: 'scopes',
      series: scopes.map((scope, index) => quantitySeries(`scope:${scope.key}`, scope.label, scopeTrends[scope.key] ?? [], index)),
      subtitle: `${scopes.length} 个已选范围 · 范围对比`,
      unit: '份',
    };
  }

  const averages = result.moving_averages ?? [];
  return {
    granularity,
    points: result.points,
    selectionMode: 'single',
    series: [
      quantitySeries('product:quantity', '销量', result.points, 0),
      ...averages.map((average, index) => ({
        available: average.available,
        field: average.field,
        id: `product:${average.field}`,
        label: average.available ? average.label : `${average.label}（数据不足 ${average.available_periods}/${average.window}）`,
        lineType: index === 0 ? 'dashed' as const : index === 1 ? 'dotted' as const : 'solid' as const,
        points: result.points,
        primary: false,
        styleIndex: index + 1,
      })),
    ],
    subtitle: averages.length ? averages.map((average) => average.label).join(' / ') : `${granularityLabel(granularity)}销量`,
    unit: '份',
  };
}

export function formatProductPeriodLabel(period: string, granularity: TrendGranularity): string {
  if (granularity === 'day') return period.slice(5);
  if (granularity === 'week') return period.replace(/^\d{4}-/, '');
  return period;
}

export function productPeriodRange(point: ProductTrendPoint, granularity: TrendGranularity): string {
  if (point.period_start && point.period_end) return `${point.period_start.slice(5)} 至 ${point.period_end.slice(5)}`;
  return formatProductPeriodLabel(point.period, granularity);
}

export function productPointStatusText(point: ProductTrendPoint): string | null {
  return trendPointStatusText(point);
}

function quantitySeries(id: string, label: string, points: ProductTrendPoint[], styleIndex: number): ProductChartSeries {
  return { available: true, field: 'quantity', id, label, lineType: 'solid', points, primary: true, styleIndex };
}

function granularityLabel(granularity: TrendGranularity): string {
  return granularity === 'day' ? '每日' : granularity === 'week' ? '每周' : '每月';
}
