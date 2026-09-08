import { CalendarDays, ChevronRight, Filter, RefreshCw } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import { ScreenState } from '@/components/states/ScreenState';
import {
  getLabor,
  getLaborTrend,
  type LaborResult,
  type LaborRow,
  type LaborTrendResult,
} from '@/services/api/analytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { getOperationsLabor, type OperationsLabor } from '@/services/api/operationsAnalytics';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, sumAmounts } from '@/utils/number';
import { beijingToday, formatBeijingDateTime } from '@/utils/time';
import { AnalyticsFilterSheet } from './AnalyticsFilterSheet';
import { createLaborDashboardCacheContext, laborChartNavigationParams, laborDashboardCacheScope, matchesLaborDashboardCacheContext, storeKeyForSelection, type AnalyticsFilters, type LaborAnalyticsMetric, type LaborDashboardCacheContext } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';
import { resolveLaborScope } from './laborScope';
import { buildLaborChartModel, laborComparisonSeries, summarizeLaborRows, type LaborSummary } from './laborChartModels';
import { LaborTrendChart, laborTrendSeriesIds } from './LaborTrendChart';
import { comparisonDisplayItems, comparisonPeriodText } from './periodComparison';
import { PeriodComparisonControl } from './PeriodComparisonControl';
import { buildDetailPeriodOptions, defaultTrendRange, type DetailPeriodOption } from './trendPeriod';

type Status = 'idle' | 'loading' | 'refreshing' | 'force-refreshing' | 'error';
type DetailPeriodSelection = { key: string; rangeKey: string };
type LaborDashboardData = { cacheContext: LaborDashboardCacheContext; comparison: OperationsLabor | null; summary: LaborResult; trend: LaborTrendResult };

const EMPTY_SCOPE_TREE: never[] = [];

export function LaborInsightScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const analytics = useAnalyticsStore();
  const dashboardCacheOffline = analytics.isOffline;
  const lastSyncedAt = analytics.lastSyncedAt;
  const scopeTree = analytics.scopeTree ?? EMPTY_SCOPE_TREE;
  const stores = analytics.stores;
  const setFilters = analytics.setLaborFilters ?? analytics.setFilters;
  const filters = useMemo(() => defaultLaborFilters(analytics.laborFilters ?? analytics.filters), [analytics.filters, analytics.laborFilters]);
  const laborScope = useMemo(() => resolveLaborScope(filters.scopeKeys ?? ['ALL'], scopeTree), [filters.scopeKeys, scopeTree]);
  const [detailPeriodSelection, setDetailPeriodSelection] = useState<DetailPeriodSelection | null>(null);
  const detailRangeKey = `${filters.granularity ?? 'day'}:${filters.dateFrom}:${filters.dateTo}`;
  const detailPeriodOptions = useMemo(() => buildDetailPeriodOptions(filters.granularity ?? 'day', filters.dateFrom, filters.dateTo), [filters.dateFrom, filters.dateTo, filters.granularity]);
  const selectedDetailPeriod = useMemo(
    () => {
      const selectedKey = detailPeriodSelection?.rangeKey === detailRangeKey ? detailPeriodSelection.key : '';
      return detailPeriodOptions.find((option) => option.key === selectedKey) ?? detailPeriodOptions[detailPeriodOptions.length - 1];
    },
    [detailPeriodOptions, detailPeriodSelection?.key, detailPeriodSelection?.rangeKey, detailRangeKey],
  );
  const detailFilters = useMemo(
    () => selectedDetailPeriod ? { ...filters, dateFrom: selectedDetailPeriod.dateFrom, dateTo: selectedDetailPeriod.dateTo } : filters,
    [filters, selectedDetailPeriod],
  );
  useEffect(() => {
    if (selectedDetailPeriod && (detailPeriodSelection?.rangeKey !== detailRangeKey || detailPeriodSelection.key !== selectedDetailPeriod.key)) {
      setDetailPeriodSelection({ key: selectedDetailPeriod.key, rangeKey: detailRangeKey });
    }
  }, [detailPeriodSelection?.key, detailPeriodSelection?.rangeKey, detailRangeKey, selectedDetailPeriod]);
  const comparisonMode = analytics.comparisonModeByModule?.labor ?? 'previous';
  const comparisonDisplayMode = analytics.comparisonDisplayModeByModule?.labor ?? 'percentage';
  const cacheContext = useMemo(
    () => createLaborDashboardCacheContext(detailFilters, laborScope.departmentKeys, laborScope.cacheKey, comparisonMode),
    [comparisonMode, detailFilters, laborScope.cacheKey, laborScope.departmentKeys],
  );
  const dashboardCacheKey = laborDashboardCacheScope(detailFilters, laborScope.cacheKey, comparisonMode);
  const trendDashboardCacheKey = laborDashboardCacheScope(filters, laborScope.cacheKey, comparisonMode);
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const forceRefreshBlocked = networkStatus !== 'online';
  const [data, setData] = useState<LaborDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [cacheOffline, setCacheOffline] = useState(false);
  const [cacheLastSyncedAt, setCacheLastSyncedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);
  const displayedScopeRef = useRef<string | null>(null);
  const offline = dashboardCacheOffline || deviceOffline || cacheOffline;
  const effectiveLastSyncedAt = cacheLastSyncedAt ?? lastSyncedAt;

  useEffect(() => {
    void analytics.loadScopes?.();
  }, [analytics.loadScopes]);

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh && forceRefreshBlocked) return;
    if (laborScope.hasUnresolvedMapping) {
      setData(null);
      setError(null);
      setStatus('idle');
      return;
    }
    controllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const requestFilters = laborScope.requestStoreKeys.length
      ? { ...detailFilters, storeKey: storeKeyForSelection(laborScope.requestStoreKeys), storeKeys: laborScope.requestStoreKeys }
      : detailFilters;
    const cacheScope = dashboardCacheKey;
    if (displayedScopeRef.current !== null && displayedScopeRef.current !== cacheScope) {
      displayedScopeRef.current = null;
      hasDataRef.current = false;
      setData(null);
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
    }
    if (forceRefresh) await clearCachedAnalytics('labor', cacheScope, Date.now()).catch(() => {});
    const cached = forceRefresh
      ? null
      : await readCachedAnalytics<LaborDashboardData>('labor', cacheScope, Date.now()).catch(() => null);
    if (requestId !== requestIdRef.current) return;
    if (cached && matchesLaborDashboardCacheContext(cached.data.cacheContext, cacheContext)) {
      displayedScopeRef.current = cacheScope;
      hasDataRef.current = true;
      setData(cached.data);
      setCacheOffline(deviceOffline);
      setCacheLastSyncedAt(deviceOffline ? cached.lastSyncedAt : null);
      setError(null);
      setStatus('idle');
      if (deviceOffline || isAnalyticsSnapshotFresh(cached.lastSyncedAt)) return;
      setStatus('refreshing');
    }
    if (deviceOffline) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStatus(forceRefresh ? 'force-refreshing' : hasDataRef.current ? 'refreshing' : 'loading');
    try {
      const comparisonRequest = comparisonMode === 'none'
        ? Promise.resolve<OperationsLabor | null>(null)
        : getOperationsLabor({
            compare: comparisonMode,
            dateFrom: detailFilters.dateFrom,
            dateTo: detailFilters.dateTo,
            granularity: detailFilters.granularity ?? 'day',
            signal: controller.signal,
            storeKeys: laborScope.requestStoreKeys,
          }).catch(() => {
            if (!controller.signal.aborted) showToast('上期数据加载失败，已展示当前期数据', 'info');
            return null;
          });
      const [summary, trend, comparison] = await Promise.all([
        getLabor(requestFilters, { forceRefresh, granularity: detailFilters.granularity ?? 'day', periodSnapshot: true, signal: controller.signal }),
        getLaborTrend(filters, { forceRefresh, granularity: filters.granularity, includeCurrent: filters.includeCurrent, signal: controller.signal, storeKeys: laborScope.requestStoreKeys }),
        comparisonRequest,
      ]);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      const next = { cacheContext, comparison, summary, trend };
      displayedScopeRef.current = cacheScope;
      hasDataRef.current = true;
      setData(next);
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
      setStatus('idle');
      void saveCachedAnalytics('labor', cacheScope, next, Date.now()).catch(() => {});
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (!forceRefresh && reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE && cached && matchesLaborDashboardCacheContext(cached.data.cacheContext, cacheContext)) {
        setCacheOffline(true);
        setCacheLastSyncedAt(cached.lastSyncedAt);
        setStatus('idle');
        return;
      }
      if (cached && matchesLaborDashboardCacheContext(cached.data.cacheContext, cacheContext)) {
        hasDataRef.current = false;
        displayedScopeRef.current = null;
        setData(null);
        setCacheOffline(false);
        setCacheLastSyncedAt(null);
        void clearCachedAnalytics('labor', cacheScope, Date.now()).catch(() => {});
      }
      setError(reason instanceof Error ? reason.message : '人效分析加载失败，请稍后重试');
      setStatus('error');
    }
  }, [cacheContext, comparisonMode, dashboardCacheKey, detailFilters, deviceOffline, filters, forceRefreshBlocked, laborScope]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);

  const rows = data?.summary.rows ?? [];
  const comparison = comparisonMode === 'none' ? null : data?.comparison ?? null;
  const scopedRows = laborScope.departmentKeys.length ? rows.filter((row) => laborScope.departmentKeys.includes(row.store_key)) : rows;
  const uniqueDepartmentRows = mergeLaborDepartmentRows(scopedRows);
  const coveredRows = uniqueDepartmentRows.filter((row) => !row.uncovered);
  const rankedRows = coveredRows
    .filter((row) => row.net_revenue > 0)
    .sort((left, right) => right.revenue_per_hour - left.revenue_per_hour);
  const excludedCount = uniqueDepartmentRows.length - rankedRows.length;
  const chartModel = useMemo(() => data ? buildLaborChartModel(data.trend, laborScope.departmentKeys, laborScope.comparisonScopes) : null, [data, laborScope.comparisonScopes, laborScope.departmentKeys]);
  const hoursComparisonSeries = laborComparisonSeries(chartModel?.comparisonScopes ?? [], 'hours');
  const efficiencyComparisonSeries = laborComparisonSeries(chartModel?.comparisonScopes ?? [], 'efficiency');
  const hoursSeriesIds = laborTrendSeriesIds('hours', chartModel?.movingAverages, filters.granularity, hoursComparisonSeries);
  const efficiencySeriesIds = laborTrendSeriesIds('efficiency', chartModel?.movingAverages, filters.granularity, efficiencyComparisonSeries);
  const summary = summarizeLaborRows(coveredRows);
  const storeLabel = laborScope.label;

  const openDetail = (row: LaborRow) => {
    if (!laborScope.canOpenStoreDetail || row.store_key !== laborScope.detailDepartmentKey) return;
    useInsightDetailStore.getState().selectLabor(row, deviceOffline);
    router.push('/analytics/labor/detail' as never);
  };
  const openFullscreen = (metric: LaborAnalyticsMetric) => {
    const chartParams = laborChartNavigationParams(filters, metric, laborScope.departmentKeys, comparisonMode);
    router.push({
      pathname: '/chart',
      params: {
        ...chartParams,
        comparisonMode,
        dashboardCacheKey: trendDashboardCacheKey,
        laborScopes: JSON.stringify(laborScope.comparisonScopes),
        scopeLabel: laborScope.label,
      },
    } as never);
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>人效分析</Text>
            <Text style={styles.updated}>{statusLabel(status, offline, effectiveLastSyncedAt, filters.dateTo)}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={[styles.iconButton, deviceOffline && styles.disabled]}><Filter color={theme.text.primary} size={20} /></Pressable>
            <Pressable accessibilityLabel="强制刷新" accessibilityRole="button" accessibilityState={{ disabled: forceRefreshBlocked }} disabled={forceRefreshBlocked} onPress={() => void load(true)} style={[styles.iconButton, forceRefreshBlocked && styles.disabled]}><RefreshCw color={theme.text.primary} size={20} /></Pressable>
          </View>
        </View>

        <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={[styles.filterSummary, deviceOffline && styles.disabled]}>
          <CalendarDays color={theme.text.secondary} size={18} />
          <Text numberOfLines={1} style={styles.filterText}>{filters.dateFrom.slice(5)} 至 {filters.dateTo.slice(5)} · {storeLabel}</Text>
        </Pressable>
        <Text style={styles.definition}>人效 = 门店净实收 ÷ 实际工时（元/工时）</Text>
        {laborScope.notice ? <Text style={styles.coverageNote}>{laborScope.notice}</Text> : null}
        <PeriodComparisonControl
          displayMode={comparisonDisplayMode}
          mode={comparisonMode}
          onDisplayModeChange={(mode) => analytics.setComparisonDisplayMode?.('labor', mode)}
          onModeChange={(mode) => analytics.setComparisonMode?.('labor', mode)}
        />

        {deviceOffline && !data ? <ScreenState state="offline" /> : null}
        {status === 'loading' && !data && !deviceOffline ? <ScreenState state="loading" /> : null}
        {status === 'error' && !data ? <ScreenState actionLabel="重新加载" onAction={() => void load()} state="error" /> : null}
        {data && rows.length === 0 ? <ScreenState state="empty" /> : null}

        {data && rows.length ? <>
          {selectedDetailPeriod ? <LaborDetailPeriodPicker onChange={(key) => setDetailPeriodSelection({ key, rangeKey: detailRangeKey })} options={detailPeriodOptions} selected={selectedDetailPeriod} styles={styles} /> : null}
          <LaborSummary comparison={comparison} displayMode={comparisonDisplayMode} summary={summary} styles={styles} />
          {comparisonPeriodText(comparison?.previous_period) ? <Text style={styles.comparisonPeriod}>{comparisonPeriodText(comparison?.previous_period)}</Text> : null}
          {comparison?.excluded_dates.length ? <Text style={styles.comparisonPeriod}>已排除日期：{comparison.excluded_dates.join('、')}</Text> : null}

          <View style={styles.section}>
            <LaborTrendChart
              comparisonSeries={hoursComparisonSeries}
              granularity={filters.granularity}
              hiddenSeriesIds={(analytics.hiddenSeriesByChart ?? {})['labor-hours']}
              metric="hours"
              onFullscreen={() => openFullscreen('hours')}
              movingAverages={chartModel?.movingAverages}
              onSelectPeriod={(period) => analytics.setSelectedChartPeriod?.('labor-hours', period)}
              onToggleSeries={(id) => analytics.toggleSeriesVisibility?.('labor-hours', hoursSeriesIds, id)}
              points={chartModel?.points ?? []}
              selectedPeriod={(analytics.selectedPeriodByChart ?? {})['labor-hours']}
              scopeLabel={laborScope.label}
            />
          </View>
          <View style={styles.section}>
            <LaborTrendChart
              comparisonSeries={efficiencyComparisonSeries}
              granularity={filters.granularity}
              hiddenSeriesIds={(analytics.hiddenSeriesByChart ?? {})['labor-efficiency']}
              metric="efficiency"
              onFullscreen={() => openFullscreen('efficiency')}
              movingAverages={chartModel?.movingAverages}
              onSelectPeriod={(period) => analytics.setSelectedChartPeriod?.('labor-efficiency', period)}
              onToggleSeries={(id) => analytics.toggleSeriesVisibility?.('labor-efficiency', efficiencySeriesIds, id)}
              points={chartModel?.points ?? []}
              selectedPeriod={(analytics.selectedPeriodByChart ?? {})['labor-efficiency']}
              scopeLabel={laborScope.label}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.rankingHeader}>
              <View><Text style={styles.sectionTitle}>{laborScope.canOpenStoreDetail ? '门店人效详情' : '人效范围汇总'}</Text><Text style={styles.sectionMeta}>{laborScope.canOpenStoreDetail ? '按实际人效展示' : '按钉钉人效部门汇总'}</Text></View>
              <Text style={styles.rankingCount}>{rankedRows.length} 个范围</Text>
            </View>
            <View style={styles.rankingList}>
              {rankedRows.map((row, index) => <LaborRankingRow index={index} key={row.store_key} onPress={laborScope.canOpenStoreDetail ? () => openDetail(row) : undefined} row={row} styles={styles} theme={theme} />)}
            </View>
            {excludedCount ? <Text style={styles.coverageNote}>{excludedCount} 项记录当前净实收为 0 或未映射，仅作为工时覆盖检查，不进入门店人效排名。</Text> : null}
          </View>
        </> : null}
        {error && data ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <AnalyticsFilterSheet allowMultipleStores filters={filters} onApply={setFilters} onClose={() => setFilterOpen(false)} scopeTree={scopeTree} scopeWarning={(scopeKeys) => resolveLaborScope(scopeKeys, scopeTree).notice} showSource={false} showTrendPeriod stores={stores} visible={filterOpen} />
    </>
  );
}

function LaborSummary({ comparison, displayMode, styles, summary }: { comparison: OperationsLabor | null; displayMode: 'percentage' | 'difference' | 'previous' | 'all'; styles: ReturnType<typeof createStyles>; summary: LaborSummary }) {
  const delta = summary.actualEfficiency !== null && summary.plannedEfficiency ? ((summary.actualEfficiency / summary.plannedEfficiency) - 1) * 100 : null;
  const comparisonItems = comparison ? comparisonDisplayItems(comparison.summary.comparison?.actual_revenue_per_hour, displayMode, 'decimal') : [];
  return <View accessibilityLabel="人效汇总" style={styles.summaryBand}>
    <View style={styles.summaryPrimary}>
      <View style={[styles.metric, styles.summaryHero]}><Text style={styles.metricLabel}>实际人效</Text><Text style={[styles.metricValue, styles.heroValue]}>¥ {formatOne(summary.actualEfficiency)}</Text><Text style={delta !== null && delta >= 0 ? styles.positiveDelta : styles.negativeDelta}>较排班 {formatSignedPercent(delta)}</Text>{comparisonItems.map((item) => <Text key={item.key} style={[styles.comparisonDelta, item.tone === 'positive' && styles.positiveDelta, item.tone === 'negative' && styles.negativeDelta]}>{item.label} {item.value}</Text>)}</View>
      <View style={styles.metric}><Text style={styles.metricLabel}>排班人效</Text><Text style={styles.metricValue}>¥ {formatOne(summary.plannedEfficiency)}</Text></View>
    </View>
    <View style={styles.summarySecondary}>
      <View style={[styles.metric, styles.netMetric]}><Text style={styles.metricLabel}>净实收</Text><Text style={styles.compactValue}>{formatCompactCurrency(summary.netRevenue)}</Text></View>
      <View style={styles.metric}><Text style={styles.metricLabel}>实际工时</Text><Text style={styles.compactValue}>{formatOne(summary.actualHours)}h</Text></View>
      <View style={styles.metric}><Text style={styles.metricLabel}>排班工时</Text><Text style={styles.compactValue}>{formatOne(summary.plannedHours)}h</Text></View>
    </View>
  </View>;
}

function LaborDetailPeriodPicker({ onChange, options, selected, styles }: {
  onChange: (key: string) => void;
  options: DetailPeriodOption[];
  selected: DetailPeriodOption;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={styles.detailPeriod}>
    <View style={styles.detailPeriodHeader}>
      <Text style={styles.detailPeriodTitle}>当前周期：{selected.label}</Text>
      <Text style={styles.detailPeriodMeta}>卡片和排名</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.detailPeriodOptions}>{options.map((option) => {
        const active = option.key === selected.key;
        return <Pressable
          accessibilityLabel={`切换人效数据周期 ${option.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          key={option.key}
          onPress={() => onChange(option.key)}
          style={[styles.detailPeriodChip, active && styles.detailPeriodChipActive]}
        >
          <Text style={[styles.detailPeriodChipText, active && styles.detailPeriodChipTextActive]}>{option.label}</Text>
        </Pressable>;
      })}</View>
    </ScrollView>
  </View>;
}

function LaborRankingRow({ index, onPress, row, styles, theme }: { index: number; onPress?: () => void; row: LaborRow; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  const actualEfficiency = row.actual_hours ? row.net_revenue / row.actual_hours : null;
  const plannedEfficiency = row.planned_hours ? row.net_revenue / row.planned_hours : null;
  const efficiencyDelta = actualEfficiency !== null && plannedEfficiency ? ((actualEfficiency / plannedEfficiency) - 1) * 100 : null;
  const scheduleDelta = row.actual_hours - row.planned_hours;
  const title = row.store_label || row.store_key;
  const content = <>
    <Text style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text>
    <View style={styles.storeColumn}>
      <Text numberOfLines={2} style={styles.storeName}>{title}</Text>
      <Text style={styles.storeHours}>实际 {formatOne(row.actual_hours)}h · 排班 {formatOne(row.planned_hours)}h</Text>
      <Text style={scheduleDelta > 0 ? styles.scheduleWarning : styles.scheduleGap}>{scheduleDelta > 0 ? '超排班' : '排班缺口'} {formatSignedHours(scheduleDelta)}</Text>
    </View>
    <View style={styles.efficiencyColumn}>
      <Text style={styles.rankingEfficiency}>¥ {formatOne(actualEfficiency)}</Text>
      <Text style={styles.plannedEfficiency}>排班 ¥ {formatOne(plannedEfficiency)}</Text>
      <Text style={efficiencyDelta !== null && efficiencyDelta >= 0 ? styles.positiveDelta : styles.negativeDelta}>{formatSignedPercent(efficiencyDelta)}</Text>
    </View>
    {onPress ? <ChevronRight color={theme.text.muted} size={16} style={styles.chevron} /> : null}
  </>;
  return onPress
    ? <Pressable accessibilityLabel={title} accessibilityRole="button" onPress={onPress} style={styles.rankingRow} testID={`labor-ranking-row-${row.store_key}`}>{content}</Pressable>
    : <View style={styles.rankingRow} testID={`labor-ranking-row-${row.store_key}`}>{content}</View>;
}

function mergeLaborDepartmentRows(rows: LaborRow[]): LaborRow[] {
  const rowsByDepartment = new Map<string, LaborRow>();
  for (const row of rows) {
    const current = rowsByDepartment.get(row.store_key);
    if (!current) {
      rowsByDepartment.set(row.store_key, { ...row });
      continue;
    }
    const actualHours = current.actual_hours + row.actual_hours;
    const plannedHours = current.planned_hours + row.planned_hours;
        const netRevenue = sumAmounts([current.net_revenue, row.net_revenue]);
    rowsByDepartment.set(row.store_key, {
      ...current,
      actual_hours: actualHours,
      headcount: current.headcount + row.headcount,
      hours_gap: current.hours_gap + row.hours_gap,
      net_revenue: netRevenue,
      planned_hours: plannedHours,
      revenue_per_hour: actualHours ? netRevenue / actualHours : 0,
      store_label: current.store_label ?? row.store_label,
      uncovered: current.uncovered && row.uncovered,
    });
  }
  return [...rowsByDepartment.values()];
}

function defaultLaborFilters(filters: AnalyticsFilters): AnalyticsFilters {
  if (filters.scopeKeys?.length) return filters;
  const range = defaultTrendRange('week', beijingToday());
  return { ...filters, ...range, granularity: 'week', scopeKeys: ['ALL'], storeKey: 'ALL', storeKeys: ['ALL'] };
}

function statusLabel(status: Status, offline: boolean, lastSyncedAt: number | null, dateTo: string): string {
  if (offline) return offlineLabel(lastSyncedAt);
  if (status === 'force-refreshing') return '正在强制刷新';
  if (status === 'refreshing') return '正在读取最新数据';
  return `更新至 ${dateTo}`;
}

function offlineLabel(lastSyncedAt: number | null): string {
  return `离线查看 · 上次同步 ${formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}`;
}

function formatOne(value: number | null): string {
  return value === null ? '-' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function formatCompactCurrency(value: number): string {
  return Math.abs(value) >= 10_000 ? `¥ ${formatOne(value / 10_000)}万` : `¥ ${formatAmount(value)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatSignedHours(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}h`;
}

function createStyles(theme: AppTheme) {
  const accent = theme.status.success;
  return StyleSheet.create({
    content: { padding: 16, paddingBottom: 36 },
    header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
    title: { color: theme.text.primary, fontSize: 25, fontWeight: '500', letterSpacing: 0 },
    updated: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 4 },
    headerActions: { flexDirection: 'row', marginRight: -4 },
    iconButton: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
    disabled: { opacity: 0.4 },
    filterSummary: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: theme.background.surface, borderColor: theme.border.strong, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, marginTop: 16, maxWidth: '100%', minHeight: 44, paddingHorizontal: 12 },
    filterText: { color: theme.text.secondary, flexShrink: 1, fontSize: 13, letterSpacing: 0 },
    definition: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginTop: 10 },
    detailPeriod: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingTop: 14 },
    detailPeriodHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    detailPeriodTitle: { color: theme.text.primary, flex: 1, fontSize: 14, fontWeight: '500', letterSpacing: 0 },
    detailPeriodMeta: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginLeft: 8 },
    detailPeriodOptions: { flexDirection: 'row', gap: 8, paddingTop: 10 },
    detailPeriodChip: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 36, paddingHorizontal: 12 },
    detailPeriodChipActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    detailPeriodChipText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    detailPeriodChipTextActive: { color: theme.action.onPrimary, fontWeight: '600' },
    summaryBand: { backgroundColor: theme.background.surface, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginTop: 18, overflow: 'hidden' },
    summaryPrimary: { flexDirection: 'row' },
    summarySecondary: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
    metric: { borderLeftColor: theme.border.default, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 13 },
    summaryHero: { borderLeftWidth: 0, flex: 1.3 },
    netMetric: { borderLeftWidth: 0, flex: 1.35 },
    metricLabel: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    metricValue: { color: theme.text.primary, fontSize: 18, fontWeight: '500', letterSpacing: 0, marginTop: 5 },
    heroValue: { color: accent, fontSize: 24 },
    compactValue: { color: theme.text.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0, marginTop: 5 },
    comparisonDelta: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    comparisonPeriod: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginTop: 8 },
    positiveDelta: { color: theme.status.success, fontSize: 10, fontStyle: 'normal', letterSpacing: 0, marginTop: 5 },
    negativeDelta: { color: theme.status.warning, fontSize: 10, fontStyle: 'normal', letterSpacing: 0, marginTop: 5 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 26, paddingTop: 20 },
    sectionTitle: { color: theme.text.primary, fontSize: 19, fontWeight: '500', letterSpacing: 0 },
    sectionMeta: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 },
    rankingHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
    rankingCount: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    rankingList: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12 },
    rankingRow: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 100, paddingHorizontal: 2, paddingVertical: 14 },
    rank: { color: theme.text.muted, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0, width: 32 },
    storeColumn: { flex: 1, minWidth: 0 },
    storeName: { color: theme.text.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0 },
    storeHours: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 7 },
    scheduleGap: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 7 },
    scheduleWarning: { color: theme.status.warning, fontSize: 10, letterSpacing: 0, marginTop: 7 },
    efficiencyColumn: { alignItems: 'flex-end', flexShrink: 0, marginLeft: 8 },
    rankingEfficiency: { color: accent, fontSize: 17, fontWeight: '500', letterSpacing: 0 },
    plannedEfficiency: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    chevron: { marginLeft: 3, marginTop: 2 },
    coverageNote: { backgroundColor: 'rgba(230, 184, 111, 0.08)', borderLeftColor: '#e6b86f', borderLeftWidth: 2, color: theme.text.secondary, fontSize: 11, letterSpacing: 0, lineHeight: 17, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0, marginTop: 14 },
  });
}
