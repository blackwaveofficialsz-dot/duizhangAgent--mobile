import type { ComparisonMode, MetricComparison, PreviousPeriod } from '@/services/api/operationsAnalytics';

export type ComparisonModule = 'dashboard' | 'orders' | 'products' | 'labor';
export type ComparisonDisplayMode = 'percentage' | 'difference' | 'previous' | 'all';
export type ComparisonValueFormat = 'money' | 'integer' | 'decimal' | 'percentagePoint';
export type ComparisonTone = 'positive' | 'negative' | 'neutral' | 'unavailable';

export type ComparisonDisplayItem = {
  key: Exclude<ComparisonDisplayMode, 'all'>;
  label: string;
  tone: ComparisonTone;
  value: string;
};

export const DEFAULT_COMPARISON_MODES: Record<ComparisonModule, ComparisonMode> = {
  dashboard: 'previous',
  orders: 'previous',
  products: 'previous',
  labor: 'previous',
};

export const DEFAULT_COMPARISON_DISPLAY_MODES: Record<ComparisonModule, ComparisonDisplayMode> = {
  dashboard: 'percentage',
  orders: 'percentage',
  products: 'percentage',
  labor: 'percentage',
};

function signedNumber(value: number, digits: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function previousValue(value: number, format: ComparisonValueFormat): string {
  if (format === 'money') return `¥${signedNumber(value, 2).replace(/^\+/, '')}`;
  if (format === 'integer') return signedNumber(value, 0).replace(/^\+/, '');
  if (format === 'percentagePoint') return `${signedNumber(value * 100, 2).replace(/^\+/, '')}%`;
  return signedNumber(value, 2).replace(/^\+/, '');
}

function differenceValue(value: number, format: ComparisonValueFormat): string {
  if (format === 'money') return `${value >= 0 ? '+' : '-'}¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === 'percentagePoint') return `${signedNumber(value * 100, 2)} 个百分点`;
  return signedNumber(value, format === 'integer' ? 0 : 2);
}

function comparisonTone(value: number | null): ComparisonTone {
  if (value == null) return 'unavailable';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

export function comparisonDisplayItems(
  comparison: MetricComparison | null | undefined,
  displayMode: ComparisonDisplayMode,
  format: ComparisonValueFormat = 'money',
): ComparisonDisplayItem[] {
  const differenceTone = comparisonTone(comparison?.difference ?? null);
  const items: Record<Exclude<ComparisonDisplayMode, 'all'>, ComparisonDisplayItem> = {
    percentage: {
      key: 'percentage',
      label: '较上期',
      tone: comparisonTone(comparison?.change_rate ?? null),
      value: comparison?.change_rate == null ? '不可比' : `${signedNumber(comparison.change_rate * 100, 2)}%`,
    },
    difference: {
      key: 'difference',
      label: '差值',
      tone: differenceTone,
      value: comparison?.difference == null ? '不可比' : differenceValue(comparison.difference, format),
    },
    previous: {
      key: 'previous',
      label: '上期',
      tone: 'neutral',
      value: comparison?.previous == null ? '不可比' : previousValue(comparison.previous, format),
    },
  };
  return displayMode === 'all'
    ? [items.percentage, items.difference, items.previous]
    : [items[displayMode]];
}

export function comparisonPeriodText(previousPeriod: PreviousPeriod | null | undefined): string | null {
  if (!previousPeriod) return null;
  return `对比上期：${previousPeriod.date_from} 至 ${previousPeriod.date_to}`;
}
