import { CalendarDays, Expand, Filter, RefreshCw } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenState } from '@/components/states/ScreenState';
import type { MealPeriodKey } from '@/services/api/analytics';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, formatCount } from '@/utils/number';
import { formatBeijingDateTime } from '@/utils/time';
import { AnalyticsFilterSheet } from './AnalyticsFilterSheet';
import { ChartExportMenu } from './ChartExportMenu';
import { selectedAnalyticsStoreKeys } from './analyticsFilters';
import { buildMealChartModel, buildRevenueChartModel, MEAL_PERIOD_OPTIONS, type MealChartMode, type RevenueChartMode } from './dashboardChartModels';
import { KpiStrip } from './KpiStrip';
import { PeriodComparisonControl } from './PeriodComparisonControl';
import { comparisonDisplayItems, comparisonPeriodText } from './periodComparison';
import { RevenueTrendChart } from './RevenueTrendChart';
import { selectMealTurnover } from './scopeTrendSeries';
import { useAnalyticsStore } from './analyticsStore';
import { resolveStoreScopeSelection, type StoreScopeNode } from './storeScope';
import { buildDetailPeriodOptions, type DetailPeriodOption } from './trendPeriod';
import { TurnoverExclusionSheet } from './TurnoverExclusionSheet';

export function DashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filters?: string }>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [turnoverExclusionOpen, setTurnoverExclusionOpen] = useState(false);
  const [mealMode, setMealMode] = useState<MealChartMode>('business');
  const [mealPeriodKey, setMealPeriodKey] = useState<MealPeriodKey>('lunch');
  const [revenueMode, setRevenueMode] = useState<RevenueChartMode>('net');
  const mealCaptureRef = useRef<View>(null);
  const revenueCaptureRef = useRef<View>(null);
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const forceRefreshBlocked = networkStatus !== 'online';
  const { comparisonDisplayModeByModule, comparisonModeByModule, data, dataSource, dashboardFilters: filters, error, hiddenSeriesByChart, isOffline: cacheOffline, lastSyncedAt, loadScopes, loadStores, mealStatus, refresh, refreshComparison, scopeTree, selectedPeriodByChart, selectMealDate, setComparisonDisplayMode, setComparisonMode, setDashboardFilters, setSelectedChartPeriod, status, stores, syncSeriesVisibility, toggleSeriesVisibility } = useAnalyticsStore();
  const usingCache = cacheOffline || deviceOffline;
  useEffect(() => { void refresh(); void loadStores(); void loadScopes(); }, [loadScopes, loadStores, refresh]);
  useEffect(() => { if (params.filters === '1' && !deviceOffline) setFilterOpen(true); }, [deviceOffline, params.filters]);
  const revenueChart = useMemo(() => data ? buildRevenueChartModel({ filters, mode: revenueMode, revenue: data.revenue, revenueSources: data.revenueSources, scopeTree, stores }) : null, [data, filters, revenueMode, scopeTree, stores]);
  const mealScopes = useMemo(() => resolveStoreScopeSelection(filters.scopeKeys ?? ['ALL'], scopeTree).scopes, [filters.scopeKeys, scopeTree]);
  const mealChart = useMemo(() => data ? buildMealChartModel(data.mealTrend, data.turnover, mealMode, mealPeriodKey, mealScopes) : null, [data, mealMode, mealPeriodKey, mealScopes]);
  const turnoverScope = useMemo(() => {
    if (!data) return null;
    return mealScopes.length ? selectMealTurnover(data.turnover, mealScopes.flatMap((scope) => scope.storeKeys)) : data.turnover;
  }, [data, mealScopes]);
  const revenueChartKey = `revenue:${revenueMode}`;
  const mealChartKey = `meal:${mealMode}:${mealPeriodKey}`;
  const revenueSeriesIds = useMemo(() => availableSeriesIds(revenueChart?.series), [revenueChart]);
  const mealSeriesIds = useMemo(() => availableSeriesIds(mealChart?.series), [mealChart]);
  const detailPeriodOptions = useMemo(() => buildDetailPeriodOptions(filters.granularity ?? 'day', filters.dateFrom, filters.dateTo), [filters.dateFrom, filters.dateTo, filters.granularity]);
  const selectedDetailPeriod = useMemo(
    () => selectedDashboardDetailPeriod(detailPeriodOptions, data?.revenue.points ?? [], selectedPeriodByChart),
    [data?.revenue.points, detailPeriodOptions, selectedPeriodByChart],
  );
  useEffect(() => { if (revenueChart) syncSeriesVisibility(revenueChartKey, revenueSeriesIds); }, [revenueChart, revenueChartKey, revenueSeriesIds, syncSeriesVisibility]);
  useEffect(() => { if (mealChart) syncSeriesVisibility(mealChartKey, mealSeriesIds); }, [mealChart, mealChartKey, mealSeriesIds, syncSeriesVisibility]);

  if (!data && (status === 'loading' || status === 'refreshing')) return <ScreenState state="loading" />;
  if (!data && deviceOffline) return <ScreenState state="offline" />;
  if (!data) return <ScreenState actionLabel="重新加载" description={error ?? undefined} onAction={() => void refresh()} state="error" />;
  if (!revenueChart || !mealChart) return <ScreenState state="loading" />;

  const selectedRevenuePoint = selectedDetailPeriod ? selectedRevenuePointFor(data.revenue.points, selectedDetailPeriod) : undefined;
  const periodNetIncome = currentMetricValue(data.comparison?.metrics.net_income) ?? selectedRevenuePoint?.net_income ?? null;
  const periodOrderCount = currentMetricValue(data.comparison?.metrics.order_count) ?? selectedRevenuePoint?.order_count ?? null;
  const periodAverage = currentMetricValue(data.comparison?.metrics.avg_order_value) ?? (periodNetIncome !== null && periodOrderCount ? periodNetIncome / periodOrderCount : null);
  const selectedStoresLabel = storeSelectionLabel(filters, stores, scopeTree);
  const periodNoun = filters.granularity === 'week' ? '周' : filters.granularity === 'month' ? '月' : '日';
  const mealHiddenSeriesIds = (hiddenSeriesByChart[mealChartKey] ?? []).filter((id) => mealSeriesIds.includes(id));
  const exportFilterSummary = `${filters.dateFrom} 至 ${filters.dateTo} · ${selectedStoresLabel}`;
  const excludedTurnoverStores = turnoverScope?.excluded_stores ?? [];
  const turnoverUnavailable = !turnoverScope || turnoverScope.eligible_store_count <= 0 || turnoverScope.table_count <= 0;
  const previousPeriod = comparisonModeByModule.dashboard === 'none' ? undefined : data.comparison?.previous_period;
  const comparisonRouteParams = {
    comparisonMode: comparisonModeByModule.dashboard,
    ...(previousPeriod ? { comparisonDateFrom: previousPeriod.date_from, comparisonDateTo: previousPeriod.date_to } : {}),
  };
  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.title}>经营看板</Text><Text style={styles.updated}>{dashboardUpdateText({ dataSource, dateTo: data.revenue.date_to, isOffline: usingCache, lastSyncedAt, status })}</Text></View>
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={styles.iconButton}><Filter color={theme.text.primary} size={20} /></Pressable>
            <Pressable accessibilityLabel="强制刷新" accessibilityRole="button" accessibilityState={{ disabled: forceRefreshBlocked }} disabled={forceRefreshBlocked} onPress={() => void Promise.all([refresh(true), loadStores(), loadScopes()])} style={[styles.iconButton, forceRefreshBlocked && styles.disabled]}><RefreshCw color={theme.text.primary} size={20} /></Pressable>
          </View>
        </View>
        <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={styles.filterSummary}>
          <CalendarDays color={theme.text.secondary} size={15} />
          <Text numberOfLines={1} style={styles.filterText}>{shortDate(filters.dateFrom)} 至 {shortDate(filters.dateTo)} · 按{periodNoun} · {selectedStoresLabel}</Text>
        </Pressable>
        <PeriodComparisonControl
          displayMode={comparisonDisplayModeByModule.dashboard}
          mode={comparisonModeByModule.dashboard}
          onDisplayModeChange={(mode) => setComparisonDisplayMode('dashboard', mode)}
          onModeChange={(mode) => { setComparisonMode('dashboard', mode); void refresh(); }}
        />
        {selectedDetailPeriod ? <DashboardDetailPeriodPicker
          onChange={(option) => {
            setSelectedChartPeriod('dashboard:revenue', option.key);
            void refreshComparison();
            if (!deviceOffline && (filters.granularity ?? 'day') === 'day') void selectMealDate(option.key);
          }}
          options={detailPeriodOptions}
          selected={selectedDetailPeriod}
          styles={styles}
        /> : null}
        <KpiStrip items={[
          { label: '周期净实收', value: formatAmount(periodNetIncome), wide: true },
          { label: '周期订单', value: formatCount(periodOrderCount) },
          { label: '客单价', value: formatAmount(periodAverage) },
        ]} />
        {data.comparison ? <View style={styles.kpiComparison}>
          <KpiComparison items={comparisonDisplayItems(data.comparison.metrics.net_income, comparisonDisplayModeByModule.dashboard)} label="周期净实收" styles={styles} />
          {data.comparison.metrics.order_count ? <KpiComparison items={comparisonDisplayItems(data.comparison.metrics.order_count, comparisonDisplayModeByModule.dashboard, 'integer')} label="周期订单" styles={styles} /> : null}
          {data.comparison.metrics.avg_order_value ? <KpiComparison items={comparisonDisplayItems(data.comparison.metrics.avg_order_value, comparisonDisplayModeByModule.dashboard)} label="客单价" styles={styles} /> : null}
          {comparisonPeriodText(data.comparison.previous_period) ? <Text style={styles.comparisonPeriod}>{comparisonPeriodText(data.comparison.previous_period)}</Text> : null}
        </View> : null}
        <View collapsable={false} ref={revenueCaptureRef} style={styles.section}>
          <SectionHeading exportAction={<ChartExportMenu captureTarget={revenueCaptureRef} dateFrom={filters.dateFrom} dateTo={filters.dateTo} granularity={filters.granularity ?? 'day'} hiddenSeriesIds={hiddenSeriesByChart[revenueChartKey]} previousPeriod={previousPeriod} series={revenueChart.series ?? []} title={`营收趋势-${selectedStoresLabel}`} />} onFullscreen={() => router.push({ pathname: '/chart', params: { ...comparisonRouteParams, revenueMode, type: 'revenue' } })} styles={styles} subtitle={`${exportFilterSummary} · ${revenueChart.subtitle}`} theme={theme} title="营收趋势" />
          <ModeControl onChange={setRevenueMode} options={[['net', '净实收'], ['sources', '堂食 · 外卖']]} styles={styles} theme={theme} value={revenueMode} />
          <RevenueTrendChart hiddenSeriesIds={hiddenSeriesByChart[revenueChartKey]} metricLabel="净实收" onSelectPeriod={(period) => { setSelectedChartPeriod(revenueChartKey, period); setSelectedChartPeriod('dashboard:revenue', period); void refreshComparison(); if (!deviceOffline && (filters.granularity ?? 'day') === 'day') void selectMealDate(period); }} onToggleSeries={(id) => toggleSeriesVisibility(revenueChartKey, revenueSeriesIds, id)} points={revenueChart.points} selectedPeriod={selectedPeriodByChart[revenueChartKey]} series={revenueChart.series} showHeader={false} valueMode={revenueChart.valueMode} />
        </View>
        <View collapsable={false} ref={mealCaptureRef} style={styles.section}>
          <SectionHeading exportAction={<ChartExportMenu captureTarget={mealCaptureRef} dateFrom={filters.dateFrom} dateTo={filters.dateTo} granularity="day" hiddenSeriesIds={mealHiddenSeriesIds} previousPeriod={previousPeriod} series={mealChart.series ?? []} title={`餐段指标-${selectedStoresLabel}`} />} onFullscreen={() => router.push({ pathname: '/chart', params: { ...comparisonRouteParams, periodKey: mealPeriodKey, type: mealMode === 'business' ? 'meal-business' : 'meal-turnover' } })} styles={styles} subtitle={`${exportFilterSummary} · ${mealChart.subtitle}`} theme={theme} title="餐段指标" />
          <ModeControl onChange={setMealMode} options={[['business', '经营'], ['turnover', '翻台率']]} styles={styles} theme={theme} value={mealMode} />
          <View accessibilityRole="tablist" style={styles.periodTabs}>
            {MEAL_PERIOD_OPTIONS.map((item) => <Pressable accessibilityLabel={item.label} accessibilityRole="button" accessibilityState={{ selected: mealPeriodKey === item.key }} key={item.key} onPress={() => setMealPeriodKey(item.key)} style={[styles.periodTab, mealPeriodKey === item.key && styles.periodTabActive]}><Text style={[styles.periodText, mealPeriodKey === item.key && styles.periodTextActive]}>{item.label}</Text></Pressable>)}
          </View>
          {mealMode === 'turnover' && turnoverUnavailable ? <Text style={styles.empty}>所选范围暂无有效桌台配置，无法计算翻台率</Text> : <RevenueTrendChart detailScopeLabel={mealChart.detailScopeLabel} hiddenSeriesIds={mealHiddenSeriesIds} metricLabel={mealChart.metricLabel} onSelectPeriod={(period) => { setSelectedChartPeriod(mealChartKey, period); if (!deviceOffline) void selectMealDate(period); }} onToggleSeries={(id) => toggleSeriesVisibility(mealChartKey, mealSeriesIds, id)} points={mealChart.points} selectedPeriod={selectedPeriodByChart[mealChartKey]} series={mealChart.series} showHeader={false} testIDPrefix="meal" valueMode={mealChart.valueMode} />}
          {mealStatus === 'loading' ? <Text style={styles.note}>正在加载所选日期餐段数据…</Text> : null}
          {mealMode === 'business' ? data.mealPeriods.periods.map((item) => (
            <View key={item.period_key} style={styles.metricRow}><Text style={styles.metricLabel}>{item.period_label}</Text><Text style={styles.metricValue}>{formatAmount(item.net_income)}</Text><Text style={styles.metricMeta}>{formatCount(item.order_count)} 单</Text></View>
          )) : !turnoverUnavailable ? turnoverScope.summary.map((item) => (
            <View key={item.period_key} style={styles.metricRow}><Text style={styles.metricLabel}>{item.period_label}</Text><Text style={styles.metricValue}>{typeof item.avg_daily_turnover === 'number' ? `${item.avg_daily_turnover.toFixed(2)} 次/桌` : '—'}</Text><Text style={styles.metricMeta}>{formatCount(item.shop_order_count)} 单</Text></View>
          )) : null}
          {mealMode === 'turnover' ? <View style={styles.turnoverSummary}>
            <Text style={styles.note}>有效 {turnoverScope?.eligible_store_count ?? 0} 家门店 · 共 {turnoverScope?.table_count ?? 0} 桌 · 排除 {excludedTurnoverStores.length} 家 · 仅统计堂食订单</Text>
            {excludedTurnoverStores.length ? <Pressable accessibilityLabel="查看已排除门店" accessibilityRole="button" onPress={() => setTurnoverExclusionOpen(true)}><Text style={styles.exclusionAction}>查看排除详情</Text></Pressable> : null}
          </View> : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <AnalyticsFilterSheet allowMultipleStores filters={filters} onApply={(nextFilters) => { setDashboardFilters(nextFilters); void refresh(); }} onClose={() => setFilterOpen(false)} scopeTree={scopeTree.length ? scopeTree : undefined} showSource={false} showTrendPeriod stores={stores} visible={filterOpen} />
      <TurnoverExclusionSheet excludedStores={excludedTurnoverStores} onClose={() => setTurnoverExclusionOpen(false)} visible={turnoverExclusionOpen} />
    </>
  );
}

function dashboardUpdateText({
  dataSource,
  dateTo,
  isOffline,
  lastSyncedAt,
  status,
}: {
  dataSource: 'network' | 'local-cache' | 'offline-cache' | null;
  dateTo: string;
  isOffline: boolean;
  lastSyncedAt: number | null;
  status: 'idle' | 'loading' | 'refreshing' | 'force-refreshing' | 'error';
}): string {
  if (isOffline || dataSource === 'offline-cache') {
    return `离线查看 · 上次同步 ${formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}`;
  }
  if (dataSource === 'local-cache' && status === 'error') return '刷新失败，当前为缓存数据';
  if (status === 'force-refreshing') return `正在强制刷新 · 当前数据更新至 ${dateTo}`;
  if (status === 'refreshing') return `正在读取最新数据 · 当前数据更新至 ${dateTo}`;
  return `更新至 ${dateTo}`;
}

function storeSelectionLabel(filters: Parameters<typeof selectedAnalyticsStoreKeys>[0] & { scopeKeys?: string[] }, stores: Array<{ key: string; label: string }>, scopeTree: StoreScopeNode[]): string {
  if (scopeTree.length && filters.scopeKeys?.length) return resolveStoreScopeSelection(filters.scopeKeys, scopeTree).label;
  const storeKeys = selectedAnalyticsStoreKeys(filters);
  if (!storeKeys.length) return '全部门店';
  if (storeKeys.length > 1) return `${storeKeys.length} 家门店`;
  return stores.find((store) => store.key === storeKeys[0])?.label ?? '已选门店';
}

function availableSeriesIds(series?: Array<{ available?: boolean; id: string }>): string[] {
  return series?.filter((item) => item.available !== false).map((item) => item.id) ?? [];
}

function selectedDashboardDetailPeriod(options: DetailPeriodOption[], points: Array<{ period: string; period_start?: string; period_end?: string }>, selectedPeriodByChart: Record<string, string>): DetailPeriodOption | undefined {
  const selectedPeriod = selectedPeriodByChart['dashboard:revenue'] ?? selectedPeriodByChart['revenue:net'] ?? selectedPeriodByChart['revenue:sources'];
  if (selectedPeriod) {
    const direct = options.find((option) => option.key === selectedPeriod);
    if (direct) return direct;
    const point = points.find((item) => item.period === selectedPeriod || item.period_start === selectedPeriod);
    if (point?.period_start && point.period_end) {
      const fromPoint = options.find((option) => option.dateFrom === point.period_start && option.dateTo === point.period_end);
      if (fromPoint) return fromPoint;
    }
  }
  return options[options.length - 1];
}

function selectedRevenuePointFor(points: Array<{ missing?: boolean; net_income: number; order_count: number; period: string; period_start?: string; period_end?: string }>, period: DetailPeriodOption) {
  return points.find((point) => (
    !point.missing
    && (
      point.period === period.key
      || point.period_start === period.key
      || (point.period_start === period.dateFrom && point.period_end === period.dateTo)
    )
  ));
}

function currentMetricValue(metric?: { current: number | null }): number | null {
  return typeof metric?.current === 'number' ? metric.current : null;
}

function shortDate(value: string): string {
  return value.slice(5);
}

function SectionHeading({ exportAction, onFullscreen, styles, subtitle, theme, title }: { exportAction?: ReactNode; onFullscreen: () => void; styles: ReturnType<typeof createStyles>; subtitle: string; theme: AppTheme; title: string }) {
  return <View style={styles.sectionHeader}>
    <View style={styles.sectionCopy}><Text style={styles.sectionTitle}>{title}</Text><Text numberOfLines={2} style={styles.sectionSubtitle}>{subtitle}</Text></View>
    <View style={styles.sectionActions}>{exportAction}<Pressable accessibilityLabel={`全屏查看${title}`} accessibilityRole="button" onPress={onFullscreen} style={styles.iconButton}><Expand color={theme.text.primary} size={19} /></Pressable></View>
  </View>;
}

function ModeControl<T extends string>({ onChange, options, styles, value }: { onChange: (value: T) => void; options: Array<readonly [T, string]>; styles: ReturnType<typeof createStyles>; theme: AppTheme; value: T }) {
  return <View accessibilityRole="tablist" style={styles.modeControl}>{options.map(([option, label]) => {
    const selected = option === value;
    return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected }} key={option} onPress={() => onChange(option)} style={[styles.modeOption, selected && styles.modeOptionActive]}><Text style={[styles.modeText, selected && styles.modeTextActive]}>{label}</Text></Pressable>;
  })}</View>;
}

function KpiComparison({ items, label, styles }: { items: ReturnType<typeof comparisonDisplayItems>; label: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.comparisonRow}>
    <Text style={styles.comparisonLabel}>{label}</Text>
    <View style={styles.comparisonItems}>{items.map((item) => <Text key={item.key} style={[styles.comparisonText, item.tone === 'positive' && styles.comparisonPositive, item.tone === 'negative' && styles.comparisonNegative]}>{item.label} {item.value}</Text>)}</View>
  </View>;
}

function DashboardDetailPeriodPicker({ onChange, options, selected, styles }: {
  onChange: (option: DetailPeriodOption) => void;
  options: DetailPeriodOption[];
  selected: DetailPeriodOption;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={styles.detailPeriod}>
    <View style={styles.detailPeriodHeader}>
      <Text style={styles.detailPeriodTitle}>当前周期：{selected.label}</Text>
      <Text style={styles.detailPeriodMeta}>卡片和对比</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.detailPeriodOptions}>{options.map((option) => {
        const active = option.key === selected.key;
        return <Pressable
          accessibilityLabel={`切换经营看板周期 ${option.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          key={option.key}
          onPress={() => onChange(option)}
          style={[styles.detailPeriodChip, active && styles.detailPeriodChipActive]}
        >
          <Text style={[styles.detailPeriodChipText, active && styles.detailPeriodChipTextActive]}>{option.label}</Text>
        </Pressable>;
      })}</View>
    </ScrollView>
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: { gap: 14, padding: 16, paddingBottom: 32 },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    title: { color: theme.text.primary, fontSize: 24, fontWeight: '400', letterSpacing: 0 },
    updated: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 4 },
    headerActions: { flexDirection: 'row' },
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    disabled: { opacity: 0.45 },
    filterSummary: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 7, maxWidth: '100%', minHeight: 40, paddingHorizontal: 12 },
    filterText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    detailPeriod: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
    detailPeriodHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    detailPeriodTitle: { color: theme.text.primary, flex: 1, fontSize: 14, fontWeight: '500', letterSpacing: 0 },
    detailPeriodMeta: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginLeft: 8 },
    detailPeriodOptions: { flexDirection: 'row', gap: 8, paddingTop: 10 },
    detailPeriodChip: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 36, paddingHorizontal: 12 },
    detailPeriodChipActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    detailPeriodChipText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    detailPeriodChipTextActive: { color: theme.action.onPrimary, fontWeight: '600' },
    kpiComparison: { gap: 6 },
    comparisonRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    comparisonLabel: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, width: 92 },
    comparisonItems: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    comparisonText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    comparisonPositive: { color: theme.status.success },
    comparisonNegative: { color: theme.status.danger },
    comparisonPeriod: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 10, paddingTop: 14 },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    sectionCopy: { flex: 1, minWidth: 0 },
    sectionActions: { flexDirection: 'row' },
    sectionTitle: { color: theme.text.primary, fontSize: 18, fontWeight: '600', letterSpacing: 0 },
    sectionSubtitle: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 3 },
    modeControl: { borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flexDirection: 'row', height: 44, overflow: 'hidden' },
    modeOption: { alignItems: 'center', flex: 1, justifyContent: 'center' },
    modeOptionActive: { backgroundColor: theme.background.subtle },
    modeText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    modeTextActive: { color: theme.text.primary, fontWeight: '600' },
    periodTabs: { flexDirection: 'row', minHeight: 38 },
    periodTab: { alignItems: 'center', borderBottomColor: 'transparent', borderBottomWidth: 2, flex: 1, justifyContent: 'center' },
    periodTabActive: { borderBottomColor: theme.action.primary },
    periodText: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    periodTextActive: { color: theme.text.primary, fontWeight: '600' },
    metricRow: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48 },
    metricLabel: { color: theme.text.primary, flex: 1, fontSize: 15, letterSpacing: 0 },
    metricValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 0 },
    metricMeta: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginLeft: 8, width: 52 },
    note: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    turnoverSummary: { gap: 6 },
    exclusionAction: { color: theme.action.primary, fontSize: 13, fontWeight: '600', letterSpacing: 0 },
    empty: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, paddingVertical: 64, textAlign: 'center' },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0 },
  });
}
