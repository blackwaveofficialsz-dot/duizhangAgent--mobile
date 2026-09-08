import type { EChartsCoreOption } from 'echarts/core';
import { Expand } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EChart } from '@/components/charts/EChart';
import { chartSeriesStyles, formatChartValue } from '@/components/charts/chartTheme';
import type { RevenueTrendPoint } from '@/services/api/analytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount } from '@/utils/number';
import type { DashboardChartPoint, DashboardTrendSeries } from './dashboardChartModels';

const REVENUE_FIELDS = [
  { field: 'net_income', label: '净实收' },
  { field: 'ma7', label: 'MA7' },
  { field: 'ma30', label: 'MA30' },
  { field: 'ma180', label: 'MA180' },
] as const;

const TREND_SERIES_COLORS = ['#d5efe3', '#5dbad2', '#e6b86f', '#8f9da2', '#e78074', '#9d8fd6'] as const;

export type RevenueTrendComparison = { shop: RevenueTrendPoint[]; takeout: RevenueTrendPoint[] };
type ValueMode = 'currency' | 'turnover';
type TrendSeries = { available?: boolean; id?: string; label: string; lineType?: 'solid' | 'dashed' | 'dotted'; primary: boolean; styleIndex: number; values: Array<number | null> };
type DisplayModel = { orderCounts: number[]; periods: string[]; series: TrendSeries[]; tableCounts?: number[] };

type Props = {
  comparison?: RevenueTrendComparison;
  detailScopeLabel?: string;
  detailPlacement?: 'below' | 'right';
  expanded?: boolean;
  hiddenSeriesIds?: string[];
  metricLabel?: string;
  onFullscreen?: () => void;
  onSelectPeriod?: (period: string) => void;
  onToggleSeries?: (seriesId: string) => void;
  points: DashboardChartPoint[];
  series?: DashboardTrendSeries[];
  selectedPeriod?: string;
  showHeader?: boolean;
  testIDPrefix?: string;
  title?: string;
  valueMode?: ValueMode;
};

export function RevenueTrendChart({
  comparison,
  detailScopeLabel,
  detailPlacement = 'below',
  expanded = false,
  hiddenSeriesIds,
  metricLabel = '净实收',
  onFullscreen,
  onSelectPeriod,
  onToggleSeries,
  points,
  series,
  selectedPeriod: controlledSelectedPeriod,
  showHeader = true,
  testIDPrefix = 'revenue',
  title = '全部净实收趋势',
  valueMode = 'currency',
}: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height: windowHeight } = useWindowDimensions();
  const display = useMemo(() => buildDisplayModel(points, comparison, metricLabel, series), [comparison, metricLabel, points, series]);
  const [localHiddenSeriesIds, setLocalHiddenSeriesIds] = useState<string[]>([]);
  const hiddenIds = hiddenSeriesIds ?? localHiddenSeriesIds;
  const visibleDisplay = useMemo(() => ({
    ...display,
    series: display.series.filter((item) => item.available !== false && !hiddenIds.includes(seriesId(item))),
  }), [display, hiddenIds]);
  const [localSelectedPeriod, setLocalSelectedPeriod] = useState<string | null>(null);
  const selectedPeriod = controlledSelectedPeriod ?? localSelectedPeriod;
  const matchedIndex = display.periods.indexOf(selectedPeriod ?? display.periods.at(-1) ?? '');
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : Math.max(0, display.periods.length - 1);
  const selected = display.periods[selectedIndex];
  const latestValue = visibleDisplay.series.filter((series) => series.primary).reduce((sum, series) => sum + (series.values.at(-1) ?? 0), 0);
  const sideDetail = detailPlacement === 'right';
  const compactSide = sideDetail && windowHeight < 420;
  const plotHeight = sideDetail ? Math.max(180, Math.min(260, windowHeight - 120)) : expanded ? 172 : 164;
  const selectPeriod = (index: number) => {
    const period = display.periods[index];
    if (!period) return;
    setLocalSelectedPeriod(period);
    onSelectPeriod?.(period);
  };
  const toggleSeries = (item: TrendSeries) => {
    if (item.available === false) return;
    const id = seriesId(item);
    const hidden = hiddenIds.includes(id);
    const visibleCount = display.series.filter((series) => series.available !== false && !hiddenIds.includes(seriesId(series))).length;
    if (!hidden && visibleCount <= 1) return;
    if (onToggleSeries) onToggleSeries(id);
    else setLocalHiddenSeriesIds((current) => hidden ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <View style={[styles.container, expanded && styles.expandedContainer]}>
      {showHeader ? <View style={styles.caption}>
        <View><Text style={styles.title}>{title}</Text><Text style={styles.latest}>{formatMetric(latestValue, valueMode)}</Text></View>
        {onFullscreen ? <Pressable accessibilityLabel="全屏查看趋势" accessibilityRole="button" onPress={onFullscreen} style={styles.iconButton}><Expand color={theme.text.primary} size={20} /></Pressable> : null}
      </View> : null}
      {display.periods.length ? (
        <View style={[styles.chartContent, sideDetail && styles.chartContentSide]} testID={sideDetail ? `${testIDPrefix}-chart-side-layout` : undefined}>
          <View style={[styles.plotColumn, sideDetail && styles.plotColumnSide]} testID={sideDetail ? `${testIDPrefix}-chart-plot-column` : undefined}>
            <TrendPlot display={visibleDisplay} gestureMode={sideDetail ? 'all' : 'tap'} height={plotHeight} onSelect={selectPeriod} selectedPeriod={selected} testIDPrefix={testIDPrefix} theme={theme} valueMode={valueMode} />
            <TrendLegend hiddenIds={hiddenIds} onToggle={toggleSeries} series={display.series} styles={styles} theme={theme} />
          </View>
          {sideDetail && selected ? <TrendPointDetail compact={compactSide} detailScopeLabel={detailScopeLabel} display={visibleDisplay} index={selectedIndex} metricLabel={metricLabel} side styles={styles} testIDPrefix={testIDPrefix} valueMode={valueMode} /> : null}
        </View>
      ) : <Text style={styles.empty}>当前筛选暂无趋势数据</Text>}
      {!sideDetail && selected ? <TrendPointDetail detailScopeLabel={detailScopeLabel} display={visibleDisplay} index={selectedIndex} metricLabel={metricLabel} styles={styles} testIDPrefix={testIDPrefix} valueMode={valueMode} /> : null}
    </View>
  );
}

function TrendPlot({ display, gestureMode, height, onSelect, selectedPeriod, testIDPrefix, theme, valueMode }: { display: DisplayModel; gestureMode: 'all' | 'tap'; height: number; onSelect: (index: number) => void; selectedPeriod?: string; testIDPrefix: string; theme: AppTheme; valueMode: ValueMode }) {
  const option = useMemo(() => buildTrendOption(display, theme, valueMode), [display, theme, valueMode]);
  return <View style={stylesForPlot.plot}>
    <EChart gestureMode={gestureMode} height={height} onDataIndexSelect={onSelect} option={option} testID={`${testIDPrefix}-echart`} />
    <View pointerEvents="box-none" style={stylesForPlot.accessibilityControls}>
      <View testID={`${testIDPrefix}-chart-x-axis`} />
      <View testID={`${testIDPrefix}-chart-y-axis`} />
      {display.periods.map((period, index) => <Pressable
        accessibilityLabel={`查看 ${period} 数据`}
        accessibilityRole="button"
        key={period}
        onPress={() => onSelect(index)}
        testID={`${testIDPrefix}-chart-point-${period}`}
      ><Text>{selectedPeriod === period ? period : ''}</Text></Pressable>)}
    </View>
  </View>;
}

function TrendLegend({ hiddenIds, onToggle, series, styles, theme }: { hiddenIds: string[]; onToggle: (series: TrendSeries) => void; series: TrendSeries[]; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  const visualStyles = trendSeriesStyles(theme);
  return <View style={styles.legend}>{series.map((item) => {
    const id = seriesId(item);
    const hidden = hiddenIds.includes(id);
    const disabled = item.available === false;
    return <Pressable
      accessibilityLabel={disabled ? `${item.label}不可用` : `${hidden ? '显示' : '隐藏'} ${item.label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: !hidden && !disabled }}
      disabled={disabled}
      key={id}
      onPress={() => onToggle(item)}
      style={[styles.legendItem, (hidden || disabled) && styles.legendItemInactive]}
    ><View style={[styles.legendMark, { backgroundColor: hidden || disabled ? 'transparent' : visualStyles[item.styleIndex].color, borderColor: visualStyles[item.styleIndex].color }]} /><Text style={styles.legendText}>{item.label}</Text></Pressable>;
  })}</View>;
}

function TrendPointDetail({ compact = false, detailScopeLabel, display, index, metricLabel, side = false, styles, testIDPrefix, valueMode }: { compact?: boolean; detailScopeLabel?: string; display: DisplayModel; index: number; metricLabel: string; side?: boolean; styles: ReturnType<typeof createStyles>; testIDPrefix: string; valueMode: ValueMode }) {
  const intervalValue = intervalSummary(display, valueMode);
  const orderCount = display.orderCounts[index] ?? 0;
  return <View style={[styles.detail, side && styles.detailSide]} testID={side ? `${testIDPrefix}-chart-side-detail` : `${testIDPrefix}-chart-detail`}>
    {side && !compact ? <View style={styles.intervalSummary}><Text style={styles.detailLabel}>{valueMode === 'turnover' ? '区间平均翻台率' : '区间净实收'}</Text><Text style={styles.intervalValue}>{formatMetric(intervalValue, valueMode)}</Text></View> : null}
    <View style={[styles.detailHeader, side && styles.detailHeaderSide]}><Text style={styles.detailDate}>{display.periods[index]}</Text>{orderCount > 0 ? <Text style={styles.detailOrder}>{valueMode === 'turnover' ? '堂食 ' : '订单 '}{orderCount.toLocaleString('zh-CN')}</Text> : null}</View>
    {detailScopeLabel ? <Text style={styles.detailLabel}>{detailScopeLabel}</Text> : null}
    <Text style={styles.detailLabel}>{metricLabel} · {valueMode === 'turnover' ? '次/桌' : '元'}</Text>
    <View style={[styles.detailMetrics, side && styles.detailMetricsSide]}>{display.series.map((series) => {
      const value = series.values[index];
      const fieldTotal = series.values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
      return <View key={series.label} style={[styles.detailMetric, side && styles.detailMetricSide]}><Text style={styles.detailLabel}>{series.label}</Text><Text style={styles.detailValue}>{formatMetric(value, valueMode)}</Text>{side && !compact && valueMode === 'currency' && value !== null && fieldTotal ? <Text style={styles.detailShare}>区间占比 {((value / fieldTotal) * 100).toFixed(1)}%</Text> : null}</View>;
    })}</View>
  </View>;
}

function buildDisplayModel(points: DashboardChartPoint[], comparison: RevenueTrendComparison | undefined, metricLabel: string, customSeries?: DashboardTrendSeries[]): DisplayModel {
  if (customSeries?.length) {
    const periods = [...new Set(customSeries.flatMap((series) => series.points.map((point) => point.period)))].sort();
    return {
      orderCounts: periods.map((period) => customSeries.filter((series) => series.primary ?? true).reduce((sum, series) => {
        const point = series.points.find((item) => item.period === period);
        return sum + (point && !point.missing ? point.order_count : 0);
      }, 0)),
      periods,
      series: customSeries.map((series) => {
        const byPeriod = new Map(series.points.map((point) => [point.period, point]));
        return {
          label: series.label,
          available: series.available ?? true,
          id: series.id ?? series.label,
          lineType: series.lineType,
          primary: series.primary ?? true,
          styleIndex: series.styleIndex,
          values: periods.map((period) => {
            const point = byPeriod.get(period);
            const value = point?.[series.field ?? 'net_income'];
            return point && !point.missing && typeof value === 'number' ? value : null;
          }),
        };
      }),
      tableCounts: periods.map((period) => customSeries.filter((series) => series.primary ?? true).reduce((sum, series) => {
        const point = series.points.find((item) => item.period === period);
        return sum + (point && !point.missing ? point.total_table_count ?? 0 : 0);
      }, 0)),
    };
  }
  if (!comparison) {
    return {
      orderCounts: points.map((point) => point.order_count),
      periods: points.map((point) => point.period),
      series: REVENUE_FIELDS.map(({ field, label }, index) => ({
        available: true,
        id: field,
        label: field === 'net_income' ? metricLabel : label,
        primary: field === 'net_income',
        styleIndex: index,
        values: points.map((point) => point.missing || typeof point[field] !== 'number' ? null : point[field]),
      })),
      tableCounts: points.map((point) => point.total_table_count ?? 0),
    };
  }
  const periods = [...new Set([...comparison.shop, ...comparison.takeout].map((point) => point.period))].sort();
  const sourceSeries = (rows: RevenueTrendPoint[]) => {
    const byPeriod = new Map(rows.map((point) => [point.period, point]));
    return periods.map((period) => {
      const point = byPeriod.get(period);
      return point && !point.missing ? point.net_income : null;
    });
  };
  return {
    orderCounts: periods.map((period) => [...comparison.shop, ...comparison.takeout].filter((point) => point.period === period && !point.missing).reduce((sum, point) => sum + point.order_count, 0)),
    periods,
    series: [
      { available: true, id: 'source:shop', label: '堂食', primary: true, styleIndex: 0, values: sourceSeries(comparison.shop) },
      { available: true, id: 'source:takeout', label: '外卖', primary: true, styleIndex: 1, values: sourceSeries(comparison.takeout) },
    ],
    tableCounts: periods.map(() => 0),
  };
}

export function buildTrendOption(display: DisplayModel, theme: AppTheme, valueMode: ValueMode): EChartsCoreOption {
  const visualStyles = trendSeriesStyles(theme);
  return {
    animation: false,
    backgroundColor: 'transparent',
    dataZoom: display.periods.length > 31 ? [{ filterMode: 'none', startValue: Math.max(0, display.periods.length - 31), type: 'inside' }] : undefined,
    grid: { bottom: 36, left: 48, right: 12, top: 16 },
    tooltip: {
      axisPointer: { label: { show: false }, type: 'cross' },
      backgroundColor: theme.background.surface,
      borderColor: theme.border.strong,
      confine: true,
      formatter: (value: unknown) => formatTrendTooltip(value, valueMode),
      textStyle: { color: theme.text.primary, fontSize: 11 },
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: string) => value.slice(5) },
      axisLine: { lineStyle: { color: theme.border.strong } },
      axisPointer: { label: { show: false } },
      boundaryGap: false,
      data: display.periods,
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: number) => valueMode === 'turnover' ? value.toFixed(2) : formatAxisAmount(value) },
      axisPointer: { label: { show: false } },
      name: valueMode === 'turnover' ? '翻台率（次/桌）' : '金额（元）',
      nameTextStyle: { color: theme.text.muted, fontSize: 9 },
      splitLine: { lineStyle: { color: theme.border.default } },
      type: 'value',
    },
    series: display.series.map((series) => {
      const visual = visualStyles[series.styleIndex];
      return {
        connectNulls: false,
        data: series.values,
        emphasis: { focus: 'series' },
        itemStyle: { color: visual.color },
        lineStyle: { color: visual.color, type: series.lineType ?? visual.lineType, width: series.primary ? 2.5 : 1.3 },
        name: series.label,
        showSymbol: series.primary,
        symbol: visual.symbol,
        symbolSize: series.primary ? 5 : 0,
        type: 'line',
      };
    }),
  };
}

function trendSeriesStyles(theme: AppTheme) {
  return chartSeriesStyles(theme).map((style, index) => ({
    ...style,
    color: TREND_SERIES_COLORS[index % TREND_SERIES_COLORS.length],
  }));
}

function intervalSummary(display: DisplayModel, valueMode: ValueMode): number {
  const primaryValues = display.series.filter((series) => series.primary).flatMap((series) => series.values).filter((value): value is number => typeof value === 'number');
  if (!primaryValues.length) return 0;
  const sum = primaryValues.reduce((total, value) => total + value, 0);
  if (valueMode !== 'turnover') return sum;
  const tableCount = (display.tableCounts ?? []).reduce((total, value) => total + value, 0);
  return tableCount > 0 ? display.orderCounts.reduce((total, value) => total + value, 0) / tableCount : 0;
}

function formatTrendTooltip(value: unknown, valueMode: ValueMode): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const rows = value.filter(isRecord);
  const date = typeof rows[0]?.axisValue === 'string' ? rows[0].axisValue : '';
  return [date, ...rows.map((row) => `${String(row.seriesName ?? '')}：${valueMode === 'turnover' ? `${Number(row.value ?? 0).toFixed(2)} 次/桌` : formatChartValue(typeof row.value === 'number' ? row.value : null)}`)].join('\n');
}

function formatMetric(value: number | null | undefined, mode: ValueMode): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return mode === 'turnover' ? `${value.toFixed(2)} 次/桌` : formatAmount(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatAxisAmount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function seriesId(series: TrendSeries): string {
  return series.id ?? series.label;
}

const stylesForPlot = StyleSheet.create({
  accessibilityControls: { height: 1, left: 0, opacity: 0, overflow: 'hidden', position: 'absolute', top: 0, width: 1 },
  plot: { alignSelf: 'stretch', position: 'relative', width: '100%' },
});

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, padding: 14 },
    expandedContainer: { alignSelf: 'stretch', borderWidth: 0, padding: 0, width: '100%' },
    chartContent: { gap: 12 },
    chartContentSide: { alignItems: 'stretch', flexDirection: 'row', gap: 16 },
    plotColumn: { minWidth: 0 },
    plotColumnSide: { flex: 1, minWidth: 0 },
    caption: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '400', letterSpacing: 0 },
    latest: { color: theme.chart.series01, fontFamily: 'monospace', fontSize: 16, letterSpacing: 0, marginTop: 2 },
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    empty: { color: theme.text.secondary, fontSize: 14, paddingVertical: 64, textAlign: 'center' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 4 },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
    legendItemInactive: { opacity: 0.38 },
    legendMark: { borderRadius: 4, borderWidth: 1, height: 8, width: 8 },
    legendText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    detail: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 9, marginTop: 12, paddingTop: 12 },
    detailSide: { borderLeftColor: theme.border.default, borderLeftWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, flexShrink: 0, marginLeft: 0, marginTop: 0, paddingLeft: 16, paddingTop: 0, position: 'relative', width: 208 },
    detailHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    detailHeaderSide: { alignItems: 'flex-start', flexDirection: 'column', gap: 2 },
    detailDate: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    detailOrder: { color: theme.text.secondary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    detailMetrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 9 },
    detailMetricsSide: { flexDirection: 'column', flexWrap: 'nowrap', gap: 10 },
    detailMetric: { minWidth: '50%', paddingRight: 10 },
    detailMetricSide: { minWidth: 0, paddingRight: 0 },
    detailLabel: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    detailValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 0, marginTop: 2 },
    detailShare: { color: theme.text.muted, fontSize: 10, letterSpacing: 0, marginTop: 1 },
    intervalSummary: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 9, paddingBottom: 8 },
    intervalValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 16, fontWeight: '600', letterSpacing: 0, marginTop: 2 },
  });
}
