import type { AppTheme } from '@/theme/tokens';

const SERIES_VARIANTS = [
  { lineType: 'solid', symbol: 'circle' },
  { lineType: 'dashed', symbol: 'rect' },
  { lineType: 'dotted', symbol: 'triangle' },
  { lineType: 'dashed', symbol: 'diamond' },
  { lineType: 'solid', symbol: 'roundRect' },
  { lineType: 'dotted', symbol: 'pin' },
  { lineType: 'dashed', symbol: 'arrow' },
  { lineType: 'solid', symbol: 'diamond' },
] as const;

export function chartSeriesStyles(theme: AppTheme) {
  const colors = [
    theme.chart.series01,
    theme.chart.series02,
    theme.chart.series03,
    theme.chart.series04,
    theme.chart.series05,
    theme.chart.series06,
    theme.chart.series07,
    theme.chart.series08,
  ];
  return SERIES_VARIANTS.map((variant, index) => ({ ...variant, color: colors[index] }));
}

export function buildChartTheme(theme: AppTheme) {
  return {
    backgroundColor: theme.background.canvas,
    color: chartSeriesStyles(theme).map(({ color }) => color),
    textStyle: { color: theme.text.secondary },
    categoryAxis: {
      axisLabel: { color: theme.text.muted },
      axisLine: { lineStyle: { color: theme.border.strong } },
      splitLine: { lineStyle: { color: theme.border.default } },
    },
    valueAxis: {
      axisLabel: { color: theme.text.muted },
      axisLine: { lineStyle: { color: theme.border.strong } },
      splitLine: { lineStyle: { color: theme.border.default } },
    },
  };
}

export function formatChartValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
