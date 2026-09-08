import type { EChartsCoreOption } from 'echarts/core';
import { Expand } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EChart, type EChartDataSelection } from '@/components/charts/EChart';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount } from '@/utils/number';
import type { LaborChartPoint, LaborComparisonSeries } from './laborChartModels';
import { LABOR_COMPLETENESS_STATUS, laborCompletenessStatus } from './laborCompleteness';
import type { TrendGranularity, TrendMovingAverageMeta } from './trendPeriod';

export { MIN_LEGACY_LABOR_COMPLETENESS_RATIO } from './laborCompleteness';

export type LaborTrendMetric = 'efficiency' | 'hours';

type Props = {
  comparisonSeries?: LaborComparisonSeries[];
  detailPlacement?: 'below' | 'right';
  expanded?: boolean;
  granularity?: TrendGranularity;
  hiddenSeriesIds?: string[];
  metric: LaborTrendMetric;
  movingAverages?: TrendMovingAverageMeta[];
  onFullscreen?: () => void;
  onSelectPeriod?: (period: string) => void;
  onToggleSeries?: (seriesId: string) => void;
  points: LaborChartPoint[];
  selectedPeriod?: string;
  scopeLabel?: string;
  showHeader?: boolean;
};

type SeriesField = string;

type SeriesSpec = { color: string; field: SeriesField; id: string; lineType: 'solid' | 'dashed'; name: string; points?: LaborChartPoint[]; primary: boolean };

const COLORS = {
  actual: '#d5efe3',
  actualMa7: '#5dbad2',
  actualMa30: '#8f9da2',
  actualMa180: '#9d8fd6',
  planned: '#e6b86f',
  plannedMa7: '#cfa655',
  plannedMa30: '#e78074',
  plannedMa180: '#789098',
} as const;
const SCOPE_COLORS = ['#d5efe3', '#e6b86f', '#5dbad2', '#e78074', '#9d8fd6', '#789098'] as const;

export function LaborTrendChart({ comparisonSeries, detailPlacement = 'below', expanded = false, granularity = 'day', hiddenSeriesIds, metric, movingAverages, onFullscreen, onSelectPeriod, onToggleSeries, points, selectedPeriod, scopeLabel = '所选范围', showHeader = true }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height: windowHeight } = useWindowDimensions();
  const availablePoints = visibleLaborTrendPoints(points);
  const [localSelectedPeriod, setLocalSelectedPeriod] = useState<string | null>(null);
  const [localSelectedSeriesId, setLocalSelectedSeriesId] = useState<string | null>(null);
  const selectedIndex = selectedPointIndex(availablePoints, selectedPeriod ?? localSelectedPeriod);
  const selectedAggregate = availablePoints[selectedIndex];
  const selectedSeries = comparisonSeries?.find((series) => series.id === localSelectedSeriesId);
  const selected = selectedSeries && selectedAggregate
    ? visibleLaborTrendPoints(selectedSeries.points).find((point) => point.period === selectedAggregate.period) ?? selectedAggregate
    : selectedAggregate;
  const selectedScopeLabel = selectedSeries ? comparisonScopeLabel(selectedSeries) : scopeLabel;
  const sideDetail = detailPlacement === 'right';
  const chartHeight = sideDetail ? Math.max(180, Math.min(260, windowHeight - 120)) : expanded ? 220 : 210;
  const comparisonCount = new Set(comparisonSeries?.map((series) => series.styleIndex)).size;
  const labels = metricLabels(metric, movingAverages, granularity, comparisonCount);
  const testIDPrefix = `labor-${metric}`;
  const specs = seriesSpecs(metric, movingAverages, granularity, comparisonSeries);
  const [localHiddenSeriesIds, setLocalHiddenSeriesIds] = useState<string[]>([]);
  const hiddenIds = hiddenSeriesIds ?? localHiddenSeriesIds;

  const selectPoint = (index: number, selection?: EChartDataSelection) => {
    const point = availablePoints[index];
    if (point) {
      const comparison = comparisonSeries?.find((series) => (
        (selection?.seriesId && series.id === selection.seriesId)
        || (selection?.seriesName && series.label === selection.seriesName)
      ));
      setLocalSelectedPeriod(point.period);
      setLocalSelectedSeriesId(comparison?.id ?? null);
      onSelectPeriod?.(point.period);
    }
  };
  const toggleSeries = (spec: SeriesSpec) => {
    const hidden = hiddenIds.includes(spec.id);
    if (onToggleSeries) onToggleSeries(spec.id);
    else setLocalHiddenSeriesIds((current) => hidden ? current.filter((id) => id !== spec.id) : [...current, spec.id]);
  };

  return <View style={[styles.container, expanded && styles.expandedContainer]}>
    {showHeader ? <View style={styles.header}>
      <View style={styles.headerCopy}><Text style={styles.title}>{labels.title}</Text><Text style={styles.subtitle}>{labels.subtitle}</Text></View>
      {onFullscreen ? <Pressable accessibilityLabel={`全屏查看${labels.title}`} accessibilityRole="button" onPress={onFullscreen} style={styles.iconButton}><Expand color={theme.text.primary} size={20} /></Pressable> : null}
    </View> : null}
    {availablePoints.length ? <View style={[styles.chartContent, sideDetail && styles.chartContentSide]} testID={sideDetail ? `${testIDPrefix}-chart-side-layout` : undefined}>
      <View style={[styles.plotColumn, sideDetail && styles.plotColumnSide]}>
        <View style={styles.plot}>
          <EChart gestureMode={sideDetail ? 'all' : 'tap'} height={chartHeight} onDataIndexSelect={selectPoint} option={buildLaborTrendOption(availablePoints, metric, theme, movingAverages, hiddenIds, granularity, comparisonSeries)} testID={`${testIDPrefix}-echart`} />
          <View pointerEvents="box-none" style={styles.accessibilityControls}>
            {availablePoints.map((point, index) => <Pressable accessibilityLabel={`查看 ${point.period} ${labels.title}数据`} accessibilityRole="button" key={point.period} onPress={() => selectPoint(index)} testID={`${testIDPrefix}-chart-point-${point.period}`}><Text>{selected?.period === point.period ? point.period : ''}</Text></Pressable>)}
          </View>
        </View>
        <TrendLegend hiddenIds={hiddenIds} onToggle={toggleSeries} specs={specs} styles={styles} />
      </View>
      {sideDetail && selected ? <LaborPointDetail metric={metric} point={selected} scopeLabel={selectedScopeLabel} side styles={styles} testID={`${testIDPrefix}-chart-side-detail`} /> : null}
    </View> : <Text style={styles.empty}>当前筛选暂无趋势数据</Text>}
    {!sideDetail && selected ? <LaborPointDetail metric={metric} point={selected} scopeLabel={selectedScopeLabel} styles={styles} testID={`${testIDPrefix}-chart-detail`} /> : null}
  </View>;
}

export function visibleLaborTrendPoints(points: LaborChartPoint[]): LaborChartPoint[] {
  return points.filter((point) => (point.availability ?? laborCompletenessStatus(point)) === LABOR_COMPLETENESS_STATUS.visible);
}

export function laborTrendSeriesIds(metric: LaborTrendMetric, movingAverages?: TrendMovingAverageMeta[], granularity: TrendGranularity = 'day', comparisonSeries?: LaborComparisonSeries[]): string[] {
  return seriesSpecs(metric, movingAverages, granularity, comparisonSeries).map((spec) => spec.id);
}

export function buildLaborTrendOption(points: LaborChartPoint[], metric: LaborTrendMetric, theme: AppTheme, movingAverages?: TrendMovingAverageMeta[], hiddenSeriesIds: string[] = [], granularity: TrendGranularity = 'day', comparisonSeries?: LaborComparisonSeries[]): EChartsCoreOption {
  const specs = seriesSpecs(metric, movingAverages, granularity, comparisonSeries).filter((spec) => !hiddenSeriesIds.includes(spec.id));
  const labels = metricLabels(metric, movingAverages, granularity, new Set(comparisonSeries?.map((series) => series.styleIndex)).size);
  return {
    animation: false,
    backgroundColor: 'transparent',
    dataZoom: points.length > 31 ? [{ filterMode: 'none', startValue: Math.max(0, points.length - 31), type: 'inside' }] : undefined,
    grid: { bottom: 36, left: 48, right: 12, top: 18 },
    tooltip: {
      axisPointer: { label: { show: false }, type: 'cross' },
      backgroundColor: theme.background.surface,
      borderColor: theme.border.strong,
      confine: true,
      formatter: (value: unknown) => formatTooltip(value, metric),
      textStyle: { color: theme.text.primary, fontSize: 11 },
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: string) => value.slice(5) },
      axisLine: { lineStyle: { color: theme.border.strong } },
      axisPointer: { label: { show: false } },
      axisTick: { show: false },
      boundaryGap: false,
      data: points.map((point) => point.period),
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) },
      axisPointer: { label: { show: false } },
      name: labels.axis,
      nameTextStyle: { color: theme.text.muted, fontSize: 9 },
      splitLine: { lineStyle: { color: theme.border.default, type: 'dashed' } },
      type: 'value',
    },
    series: specs.map((spec) => ({
      connectNulls: false,
      data: points.map((point) => seriesValue(point.period, spec, points)),
      emphasis: { focus: 'series' },
      itemStyle: { color: spec.color },
      lineStyle: { color: spec.color, opacity: spec.primary ? 1 : 0.72, type: spec.lineType, width: spec.primary ? 2.4 : 1.1 },
      name: spec.name,
      showSymbol: spec.primary,
      smooth: 0.22,
      symbol: spec.primary ? 'circle' : 'none',
      symbolSize: spec.primary ? 5 : 0,
      type: 'line',
    })),
  };
}

function LaborPointDetail({ metric, point, scopeLabel, side = false, styles, testID }: { metric: LaborTrendMetric; point: LaborChartPoint; scopeLabel: string; side?: boolean; styles: ReturnType<typeof createStyles>; testID: string }) {
  const labels = metricLabels(metric);
  const actual = metric === 'hours' ? point.actual_hours : point.actual_revenue_per_hour;
  const planned = metric === 'hours' ? point.planned_hours : point.planned_revenue_per_hour;
  return <View style={[styles.detail, side && styles.detailSide]} testID={testID}>
    <Text style={styles.detailDate}>{point.period}</Text>
    <Text style={styles.detailMeta}>范围 {scopeLabel}</Text>
    <Text style={styles.detailMeta}>周期 {point.period_start ?? point.period} 至 {point.period_end ?? point.period}</Text>
    <View style={[styles.detailMetrics, side && styles.detailMetricsSide]}>
      <DetailMetric label={labels.actual} metric={metric} side={side} styles={styles} value={actual} />
      <DetailMetric label={labels.planned} metric={metric} side={side} styles={styles} value={planned} />
      <DetailTextMetric label="净实收" side={side} styles={styles} value={formatMoney(point.net_revenue)} />
      {metric === 'hours'
        ? <DetailMetric label="实际人效" metric="efficiency" side={side} styles={styles} value={point.actual_revenue_per_hour} />
        : <DetailMetric label="实际工时" metric="hours" side={side} styles={styles} value={point.actual_hours} />}
    </View>
    <Text style={styles.detailStatus}>{completenessText(point)}</Text>
  </View>;
}

function DetailMetric({ label, metric, side = false, styles, value }: { label: string; metric: LaborTrendMetric; side?: boolean; styles: ReturnType<typeof createStyles>; value: number | null }) {
  return <View style={[styles.detailMetric, side && styles.detailMetricSide]}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{formatMetric(value, metric)}</Text></View>;
}

function DetailTextMetric({ label, side = false, styles, value }: { label: string; side?: boolean; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={[styles.detailMetric, side && styles.detailMetricSide]}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

function TrendLegend({ hiddenIds, onToggle, specs, styles }: { hiddenIds: string[]; onToggle: (spec: SeriesSpec) => void; specs: SeriesSpec[]; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.legend}>{specs.map((spec) => {
    const hidden = hiddenIds.includes(spec.id);
    return <Pressable accessibilityLabel={`${hidden ? '显示' : '隐藏'} ${spec.name}`} accessibilityRole="button" accessibilityState={{ selected: !hidden }} key={spec.id} onPress={() => onToggle(spec)} style={[styles.legendItem, hidden && styles.legendItemInactive]}><View style={[styles.legendMark, { backgroundColor: hidden ? 'transparent' : spec.color, borderColor: spec.color }]} /><Text style={styles.legendText}>{spec.name}</Text></Pressable>;
  })}</View>;
}

function comparisonScopeLabel(series: LaborComparisonSeries): string {
  const suffix = series.lineType === 'dashed' ? ' 排班' : ' 实际';
  return series.label.endsWith(suffix) ? series.label.slice(0, -suffix.length) : series.label;
}

function selectedPointIndex(points: LaborChartPoint[], selectedPeriod: string | null): number {
  const matched = points.findIndex((point) => point.period === selectedPeriod);
  return matched >= 0 ? matched : Math.max(0, points.length - 1);
}

function seriesSpecs(metric: LaborTrendMetric, movingAverages?: TrendMovingAverageMeta[], granularity: TrendGranularity = 'day', comparisonSeries?: LaborComparisonSeries[]): SeriesSpec[] {
  if (comparisonSeries?.length) return comparisonSeries.map((series) => ({
    color: SCOPE_COLORS[series.styleIndex % SCOPE_COLORS.length],
    field: series.field,
    id: series.id,
    lineType: series.lineType,
    name: series.label,
    points: series.points,
    primary: true,
  }));
  const primary = metric === 'hours' ? [
    { color: COLORS.actual, field: 'actual_hours', id: 'actual_hours', lineType: 'solid' as const, name: '实际工时', primary: true },
    { color: COLORS.planned, field: 'planned_hours', id: 'planned_hours', lineType: 'solid' as const, name: '排班工时', primary: true },
  ] : [
    { color: COLORS.actual, field: 'actual_revenue_per_hour', id: 'actual_revenue_per_hour', lineType: 'solid' as const, name: '实际人效', primary: true },
    { color: COLORS.planned, field: 'planned_revenue_per_hour', id: 'planned_revenue_per_hour', lineType: 'solid' as const, name: '排班人效', primary: true },
  ];
  const averages = effectiveMovingAverages(metric, movingAverages, granularity);
  return [...primary, ...averages.flatMap((item) => {
    const actualField = metric === 'hours' ? 'actual_hours' : 'actual_revenue_per_hour';
    const plannedField = metric === 'hours' ? 'planned_hours' : 'planned_revenue_per_hour';
    if (item.field.startsWith(`${actualField}_`)) return [{ color: movingAverageColor('actual', item.window, granularity), field: item.field, id: item.field, lineType: 'dashed' as const, name: `实际 ${movingAverageLabel(item)}`, primary: false }];
    if (item.field.startsWith(`${plannedField}_`)) return [{ color: movingAverageColor('planned', item.window, granularity), field: item.field, id: item.field, lineType: 'dashed' as const, name: `排班 ${movingAverageLabel(item)}`, primary: false }];
    return [];
  })];
}

function effectiveMovingAverages(metric: LaborTrendMetric, movingAverages: TrendMovingAverageMeta[] | undefined, granularity: TrendGranularity): TrendMovingAverageMeta[] {
  if (movingAverages !== undefined) return movingAverages.filter((item) => item.available);
  return granularity === 'day' ? legacyMovingAverages(metric) : [];
}

function movingAverageLabel(item: TrendMovingAverageMeta): string {
  return item.window > 0 ? `MA${item.window}` : item.label;
}

function legacyMovingAverages(metric: LaborTrendMetric): TrendMovingAverageMeta[] {
  const prefixes = metric === 'hours' ? ['actual_hours', 'planned_hours'] : ['actual_revenue_per_hour', 'planned_revenue_per_hour'];
  return prefixes.flatMap((prefix) => [7, 30, 180].map((window) => ({ available: true, available_periods: window, field: `${prefix}_ma${window}`, label: `MA${window}`, window })));
}

function movingAverageColor(kind: 'actual' | 'planned', window: number, granularity: TrendGranularity): string {
  const colors = kind === 'actual' ? [COLORS.actualMa7, COLORS.actualMa30, COLORS.actualMa180] : [COLORS.plannedMa7, COLORS.plannedMa30, COLORS.plannedMa180];
  const windows = granularity === 'week' ? [4, 12, 26] : granularity === 'month' ? [3, 6, 12] : [7, 30, 180];
  const index = windows.indexOf(window);
  return colors[index >= 0 ? index : 0];
}

function metricLabels(metric: LaborTrendMetric, movingAverages?: TrendMovingAverageMeta[], granularity: TrendGranularity = 'day', comparisonCount = 0) {
  const movingAverageSummary = [...new Set(effectiveMovingAverages(metric, movingAverages, granularity).map(movingAverageLabel))].join(' / ');
  const subtitle = comparisonCount > 1 ? `${comparisonCount} 个范围 · 实际 / 排班` : null;
  return metric === 'hours'
    ? { actual: '实际工时', axis: '工时（小时）', movingAverageLabel: movingAverageSummary, planned: '排班工时', subtitle: subtitle ?? `实际 / 排班${movingAverageSummary ? ` · ${movingAverageSummary}` : ''}`, title: '工时趋势' }
    : { actual: '实际人效', axis: '人效（元/小时）', movingAverageLabel: movingAverageSummary, planned: '排班人效', subtitle: subtitle ?? `实际人效 / 排班人效${movingAverageSummary ? ` · ${movingAverageSummary}` : ''}`, title: '人效趋势' };
}

function seriesValue(period: string, spec: SeriesSpec, fallbackPoints: LaborChartPoint[]): number | null {
  const point = (spec.points ?? fallbackPoints).find((candidate) => candidate.period === period);
  if (!point || (point.availability ?? laborCompletenessStatus(point)) !== LABOR_COMPLETENESS_STATUS.visible) return null;
  return numericValue(point[spec.field]);
}

function numericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatMetric(value: number | null, metric: LaborTrendMetric): string {
  if (value === null) return '-';
  return metric === 'hours' ? `${formatAmount(value)} 小时` : `${formatAmount(value)} 元/小时`;
}

function formatMoney(value: number): string {
  return `¥ ${formatAmount(value)}`;
}

function completenessText(point: LaborChartPoint): string {
  if (point.missing) return '完整率：当前周期缺失';
  if (point.hours_synced === false) return '完整率：工时同步中';
  return '完整率：工时数据完整';
}

function formatTooltip(value: unknown, metric: LaborTrendMetric): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const rows = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const date = typeof rows[0]?.axisValue === 'string' ? rows[0].axisValue : '';
  return [date, ...rows.map((row) => {
    const metricValue = numericValue(row.value);
    return `${String(row.seriesName ?? '')}：${metricValue === null ? '—' : formatMetric(metricValue, metric)}`;
  })].join('\n');
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { alignSelf: 'stretch', width: '100%' },
    expandedContainer: { flex: 1 },
    header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { color: theme.text.primary, fontSize: 19, fontWeight: '500', letterSpacing: 0 },
    subtitle: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 },
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    chartContent: { marginTop: 12 },
    chartContentSide: { alignItems: 'stretch', flex: 1, flexDirection: 'row', gap: 16, marginTop: 0 },
    plotColumn: { minWidth: 0 },
    plotColumnSide: { flex: 1 },
    plot: { alignSelf: 'stretch', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, overflow: 'hidden', position: 'relative', width: '100%' },
    accessibilityControls: { height: 1, left: 0, opacity: 0, overflow: 'hidden', position: 'absolute', top: 0, width: 1 },
    legend: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 10 },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
    legendItemInactive: { opacity: 0.38 },
    legendMark: { borderRadius: 4, borderWidth: 1, height: 8, width: 8 },
    legendText: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    detail: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 },
    detailSide: { borderLeftColor: theme.border.default, borderLeftWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, flexShrink: 0, marginTop: 0, paddingLeft: 16, paddingTop: 0, position: 'relative', width: 208 },
    detailDate: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    detailMeta: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 },
    detailMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 9 },
    detailMetricsSide: { flexDirection: 'column', flexWrap: 'nowrap', gap: 12 },
    detailMetric: { flex: 1, minWidth: 0 },
    detailMetricSide: { flex: 0 },
    detailLabel: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0 },
    detailValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 0, marginTop: 3 },
    detailStatus: { color: theme.status.warning, fontSize: 11, letterSpacing: 0, marginTop: 10 },
    empty: { color: theme.text.secondary, fontSize: 14, paddingVertical: 64, textAlign: 'center' },
  });
}
