import type { EChartsCoreOption } from 'echarts/core';
import { Expand } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EChart, type EChartDataSelection } from '@/components/charts/EChart';
import { chartSeriesStyles } from '@/components/charts/chartTheme';
import type { ProductTrendPoint } from '@/services/api/analytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatProductPeriodLabel, productPeriodRange, productPointStatusText, type ProductChartModel, type ProductChartSeries } from './productChartModels';

type Props = {
  detailPlacement?: 'below' | 'right';
  expanded?: boolean;
  hiddenSeriesIds?: string[];
  model?: ProductChartModel;
  onFullscreen?: () => void;
  onSelectProduct?: () => void;
  onSelectionChange?: (selection: ProductTrendSelection) => void;
  onToggleSeries?: (seriesId: string) => void;
  points: ProductTrendPoint[];
  productName: string;
  selectedPeriod?: string;
  selectedSeriesId?: string;
  showHeader?: boolean;
};

export type ProductTrendSelection = { period: string; seriesId?: string };

type DisplaySeries = Pick<ProductChartSeries, 'available' | 'field' | 'id' | 'label' | 'lineType' | 'primary' | 'styleIndex'> & { points: ProductTrendPoint[]; values: Array<number | null> };
type DisplayModel = { granularity: ProductChartModel['granularity']; periods: string[]; series: DisplaySeries[] };

const LEGACY_SERIES = [
  { field: 'quantity', label: '每日销量', primary: true },
  { field: 'ma7', label: 'MA7', primary: false },
  { field: 'ma30', label: 'MA30', primary: false },
  { field: 'ma180', label: 'MA180', primary: false },
] as const;

export function ProductTrendChart({ detailPlacement = 'below', expanded = false, hiddenSeriesIds, model, onFullscreen, onSelectProduct, onSelectionChange, onToggleSeries, points, productName, selectedPeriod, selectedSeriesId, showHeader = true }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height: windowHeight } = useWindowDimensions();
  const display = useMemo(() => buildDisplayModel(model ?? legacyModel(points)), [model, points]);
  const [localHiddenSeriesIds, setLocalHiddenSeriesIds] = useState<string[]>([]);
  const hiddenIds = hiddenSeriesIds ?? localHiddenSeriesIds;
  const visibleDisplay = useMemo(() => ({ ...display, series: display.series.filter((series) => series.available && !hiddenIds.includes(series.id)) }), [display, hiddenIds]);
  const [localSelection, setLocalSelection] = useState<ProductTrendSelection | null>(null);
  const selectedSelection = selectedPeriod ? { period: selectedPeriod, seriesId: selectedSeriesId } : localSelection;
  const selected = selectedProductDetails(display, visibleDisplay, selectedSelection);
  const sideDetail = detailPlacement === 'right';
  const chartHeight = sideDetail ? Math.max(180, Math.min(260, windowHeight - 120)) : expanded ? 220 : 210;

  const selectPoint = (index: number, eventSelection?: EChartDataSelection) => {
    const period = display.periods[eventSelection?.dataIndex ?? index];
    if (!period) return;
    const seriesId = eventSelection?.seriesId
      ?? visibleDisplay.series.find((series) => series.label === eventSelection?.seriesName)?.id;
    const selection = { period, seriesId: seriesId ?? selectedSelection?.seriesId };
    setLocalSelection(selection);
    onSelectionChange?.(selection);
  };
  const toggleSeries = (series: DisplaySeries) => {
    if (!series.available) return;
    const hidden = hiddenIds.includes(series.id);
    const visiblePrimaryCount = display.series.filter((item) => item.available && item.primary && !hiddenIds.includes(item.id)).length;
    if (!hidden && series.primary && visiblePrimaryCount <= 1) return;
    if (onToggleSeries) onToggleSeries(series.id);
    else setLocalHiddenSeriesIds((current) => hidden ? current.filter((id) => id !== series.id) : [...current, series.id]);
  };

  return <View style={[styles.container, expanded && styles.expandedContainer]}>
    {showHeader ? <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>{model?.selectionMode === 'products' ? '多产品销量趋势' : '单品销量趋势'}</Text>
        <Text style={styles.subtitle}>{model ? `${granularityLabel(model.granularity)}销量 · ${model.subtitle}` : '每日销量 · MA7 / MA30 / MA180'}</Text>
      </View>
      {onFullscreen ? <Pressable accessibilityLabel="全屏查看单品销量趋势" accessibilityRole="button" onPress={onFullscreen} style={styles.iconButton}><Expand color={theme.text.primary} size={20} /></Pressable> : null}
    </View> : null}
    {showHeader ? onSelectProduct ? <Pressable accessibilityLabel={`选择趋势产品 ${productName}`} accessibilityRole="button" onPress={onSelectProduct} style={styles.productSelector}><Text numberOfLines={2} style={styles.productName}>{productName}</Text></Pressable> : <Text numberOfLines={2} style={[styles.productSelector, styles.productName]}>{productName}</Text> : null}
    {display.periods.length ? <View style={[styles.chartContent, sideDetail && styles.chartContentSide]} testID={sideDetail ? 'product-chart-side-layout' : undefined}>
      <View style={[styles.plotColumn, sideDetail && styles.plotColumnSide]}>
        <View style={styles.plot}>
          <EChart gestureMode={sideDetail ? 'all' : 'tap'} height={chartHeight} onDataIndexSelect={selectPoint} option={buildDisplayOption(visibleDisplay, theme)} testID="product-echart" />
          <View pointerEvents="box-none" style={styles.accessibilityControls}>
            {display.periods.map((period, index) => <Pressable accessibilityLabel={`查看 ${period} 单品销量数据`} accessibilityRole="button" key={period} onPress={() => selectPoint(index)} testID={`product-chart-point-${period}`}><Text>{selected?.period === period ? period : ''}</Text></Pressable>)}
          </View>
        </View>
        <TrendLegend hiddenIds={hiddenIds} onToggle={toggleSeries} series={display.series} styles={styles} theme={theme} />
      </View>
      {sideDetail && selected ? <ProductPointDetail detail={selected} side styles={styles} testID="product-chart-side-detail" /> : null}
    </View> : <Text style={styles.empty}>当前筛选暂无单品趋势数据</Text>}
    {!sideDetail && selected ? <ProductPointDetail detail={selected} styles={styles} testID="product-chart-detail" /> : null}
  </View>;
}

export function visibleProductTrendPoints(points: ProductTrendPoint[]): ProductTrendPoint[] {
  return points;
}

export function buildProductTrendOption(points: ProductTrendPoint[], theme: AppTheme): EChartsCoreOption {
  return buildDisplayOption(buildDisplayModel(legacyModel(points)), theme);
}

function TrendLegend({ hiddenIds, onToggle, series, styles, theme }: { hiddenIds: string[]; onToggle: (series: DisplaySeries) => void; series: DisplaySeries[]; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  const visuals = productSeriesStyles(theme);
  return <View style={styles.legend}>{series.map((series) => {
    const hidden = hiddenIds.includes(series.id);
    const disabled = !series.available;
    return <Pressable accessibilityLabel={disabled ? `${series.label}不可用` : `${hidden ? '显示' : '隐藏'} ${series.label}`} accessibilityRole="button" accessibilityState={{ disabled, selected: !hidden && !disabled }} disabled={disabled} key={series.id} onPress={() => onToggle(series)} style={[styles.legendItem, (hidden || disabled) && styles.legendItemInactive]}><View style={[styles.legendMark, { backgroundColor: hidden || disabled ? 'transparent' : visuals[series.styleIndex % visuals.length].color, borderColor: visuals[series.styleIndex % visuals.length].color }]} /><Text style={styles.legendText}>{series.label}</Text></Pressable>;
  })}</View>;
}

function ProductPointDetail({ detail, side = false, styles, testID }: { detail: { label: string; period: string; point: ProductTrendPoint }; side?: boolean; styles: ReturnType<typeof createStyles>; testID: string }) {
  const { point } = detail;
  const status = productPointStatusText(point);
  return <View style={[styles.detail, side && styles.detailSide]} testID={testID}>
    <Text style={styles.detailDate}>{point.period}</Text>
    <Text style={styles.detailMeta}>范围 {detail.label}</Text>
    <Text style={styles.detailMeta}>{productPeriodRange(point, point.period.includes('-W') ? 'week' : point.period.length === 7 ? 'month' : 'day')}</Text>
    <View style={[styles.detailMetrics, side && styles.detailMetricsSide]}>
      <DetailMetric label="销量" side={side} styles={styles} value={`${formatQuantity(point.quantity)} 份`} />
      <DetailMetric label="销售额" side={side} styles={styles} value={formatMoney(point.sales_amount)} />
      <DetailMetric label="订单数" side={side} styles={styles} value={formatInteger(point.order_count)} />
    </View>
    {status ? <Text style={styles.detailStatus}>{status}</Text> : null}
  </View>;
}

function DetailMetric({ label, side, styles, value }: { label: string; side: boolean; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={[styles.detailMetric, side && styles.detailMetricSide]}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{label} {value}</Text></View>;
}

function buildDisplayModel(model: ProductChartModel): DisplayModel {
  const periods = [...new Set(model.series.flatMap((series) => series.points.map((point) => point.period)))].sort();
  return {
    granularity: model.granularity,
    periods,
    series: model.series.map((series) => {
      const pointsByPeriod = new Map(series.points.map((point) => [point.period, point]));
      return {
        ...series,
        values: periods.map((period) => {
          const point = pointsByPeriod.get(period);
          const value = point?.[series.field];
          return point && !point.missing && typeof value === 'number' ? value : null;
        }),
      };
    }),
  };
}

function legacyModel(points: ProductTrendPoint[]): ProductChartModel {
  return {
    granularity: 'day',
    points,
    series: LEGACY_SERIES.map((series, index) => ({ available: true, field: series.field, id: series.field, label: series.label, lineType: series.primary ? 'solid' : 'dashed', points, primary: series.primary, styleIndex: index })),
    subtitle: 'MA7 / MA30 / MA180',
    unit: '份',
  };
}

function selectedProductDetails(display: DisplayModel, visibleDisplay: DisplayModel, selection: { period: string; seriesId?: string } | null): { label: string; period: string; point: ProductTrendPoint } | null {
  const period = selection?.period ?? display.periods.at(-1);
  if (!period) return null;
  const selectedSeries = selection?.seriesId ? visibleDisplay.series.find((series) => series.id === selection.seriesId) : undefined;
  const fallbackSeries = [
    ...visibleDisplay.series.filter((series) => series.primary),
    ...visibleDisplay.series,
  ];
  const series = [selectedSeries, ...fallbackSeries].find((item, index, all) => {
    if (!item) return false;
    return all.findIndex((candidate) => candidate?.id === item.id) === index
      && item.points.some((point) => point.period === period);
  });
  const point = series?.points.find((item) => item.period === period);
  return point && series ? { label: series.label, period, point } : null;
}

function buildDisplayOption(display: DisplayModel, theme: AppTheme): EChartsCoreOption {
  const visuals = productSeriesStyles(theme);
  return {
    animation: false,
    backgroundColor: 'transparent',
    dataZoom: display.periods.length > 31 ? [{ filterMode: 'none', startValue: Math.max(0, display.periods.length - 31), type: 'inside' }] : undefined,
    grid: { bottom: 36, left: 48, right: 12, top: 18 },
    tooltip: { axisPointer: { label: { show: false }, type: 'cross' }, backgroundColor: theme.background.surface, borderColor: theme.border.strong, confine: true, formatter: formatTooltip, textStyle: { color: theme.text.primary, fontSize: 11 }, trigger: 'axis' },
    xAxis: { axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: string) => formatProductPeriodLabel(value, display.granularity), interval: Math.max(0, Math.ceil(display.periods.length / 6) - 1) }, axisLine: { lineStyle: { color: theme.border.strong } }, axisPointer: { label: { show: false } }, axisTick: { show: false }, boundaryGap: false, data: display.periods, type: 'category' },
    yAxis: { axisLabel: { color: theme.text.muted, fontSize: 9, formatter: (value: number) => formatInteger(value) }, axisPointer: { label: { show: false } }, name: '销量（份）', nameTextStyle: { color: theme.text.muted, fontSize: 9 }, splitLine: { lineStyle: { color: theme.border.default, type: 'dashed' } }, type: 'value' },
    series: display.series.map((series) => {
      const visual = visuals[series.styleIndex % visuals.length];
      return { connectNulls: false, data: series.values, emphasis: { focus: 'series' }, id: series.id, itemStyle: { color: visual.color }, lineStyle: { color: visual.color, opacity: series.primary ? 1 : 0.72, type: series.lineType, width: series.primary ? 2.4 : 1.1 }, name: series.label, showSymbol: series.primary, smooth: 0.22, symbol: series.primary ? 'circle' : 'none', symbolSize: series.primary ? 5 : 0, type: 'line' };
    }),
  };
}

function productSeriesStyles(theme: AppTheme) {
  return chartSeriesStyles(theme).map((style, index) => ({ ...style, color: ['#d5efe3', '#5dbad2', '#e6b86f', '#8f9da2', '#e78074', '#9d8fd6'][index % 6] }));
}

function granularityLabel(granularity: ProductChartModel['granularity']): string {
  return granularity === 'day' ? '每日' : granularity === 'week' ? '每周' : '每月';
}

function formatQuantity(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : '—';
}

function formatInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—';
}

function formatMoney(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥ ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
}

function formatTooltip(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const rows = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const period = typeof rows[0]?.axisValue === 'string' ? rows[0].axisValue : '';
  return [period, ...rows.map((row) => `${String(row.seriesName ?? '')}：${formatQuantity(typeof row.value === 'number' ? row.value : null)} 份`)].join('\n');
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { alignSelf: 'stretch', width: '100%' }, expandedContainer: { flex: 1 }, header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 }, headerCopy: { flex: 1, minWidth: 0 }, title: { color: theme.text.primary, fontSize: 19, fontWeight: '500', letterSpacing: 0 }, subtitle: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 }, iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, productSelector: { alignSelf: 'flex-start', borderColor: theme.border.strong, borderRadius: 8, borderWidth: 1, marginTop: 12, maxWidth: '82%', minHeight: 40, paddingHorizontal: 12, paddingVertical: 10 }, productName: { color: theme.text.primary, fontSize: 13, letterSpacing: 0 }, chartContent: { marginTop: 12 }, chartContentSide: { alignItems: 'stretch', flex: 1, flexDirection: 'row', gap: 16, marginTop: 0 }, plotColumn: { minWidth: 0 }, plotColumnSide: { flex: 1 }, plot: { alignSelf: 'stretch', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, overflow: 'hidden', position: 'relative', width: '100%' }, accessibilityControls: { height: 1, left: 0, opacity: 0, overflow: 'hidden', position: 'absolute', top: 0, width: 1 }, legend: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 10 }, legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 }, legendItemInactive: { opacity: 0.38 }, legendMark: { borderRadius: 4, borderWidth: 1, height: 8, width: 8 }, legendText: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 }, detail: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 }, detailSide: { borderLeftColor: theme.border.default, borderLeftWidth: StyleSheet.hairlineWidth, borderTopWidth: 0, flexShrink: 0, marginTop: 0, paddingLeft: 16, paddingTop: 0, position: 'relative', width: 208 }, detailDate: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 }, detailMeta: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 }, detailMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 9 }, detailMetricsSide: { flexDirection: 'column', flexWrap: 'nowrap', gap: 12 }, detailMetric: { minWidth: '44%' }, detailMetricSide: { minWidth: 0 }, detailLabel: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0 }, detailValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 0, marginTop: 3 }, detailStatus: { color: theme.status.warning, fontSize: 11, letterSpacing: 0, marginTop: 10 }, empty: { color: theme.text.secondary, fontSize: 14, paddingVertical: 64, textAlign: 'center' },
  });
}
