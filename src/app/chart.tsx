import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnalyticsCalendar } from '@/features/analytics/AnalyticsCalendar';
import { ChartExportMenu } from '@/features/analytics/ChartExportMenu';
import { FullscreenChartScreen } from '@/features/analytics/FullscreenChartScreen';
import { LaborTrendChart, laborTrendSeriesIds } from '@/features/analytics/LaborTrendChart';
import { ProductTrendChart, visibleProductTrendPoints } from '@/features/analytics/ProductTrendChart';
import { buildLaborChartModel, laborComparisonSeries, type LaborChartModel, type LaborChartPoint } from '@/features/analytics/laborChartModels';
import { resolveLaborScope } from '@/features/analytics/laborScope';
import { buildMultiProductChartModel } from '@/features/analytics/productChartModels';
import { StoreScopePicker } from '@/features/analytics/StoreScopePicker';
import { TrendPeriodControls } from '@/features/analytics/TrendPeriodControls';
import type { AnalyticsFilters, LaborDashboardCacheContext } from '@/features/analytics/analyticsFilters';
import { analyticsDateRange, createLaborDashboardCacheContext, laborAnalyticsCacheKey, laborDashboardCacheScope, latestAnalyticsDate, matchesLaborDashboardCacheContext, normalizeStoreSelection, productAnalyticsCacheKey, selectedAnalyticsStoreKeys, serializeAnalyticsFilters, storeKeyForSelection } from '@/features/analytics/analyticsFilters';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { buildMealChartModel, buildRevenueChartModel, MEAL_PERIOD_OPTIONS, type DashboardChartPoint, type DashboardTrendSeries, type RevenueChartMode } from '@/features/analytics/dashboardChartModels';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { resolveStoreScopeSelection, type ExplicitStoreScope, type StoreScopeNode } from '@/features/analytics/storeScope';
import { defaultTrendRange, normalizeTrendRange, type TrendGranularity, type TrendMovingAverageMeta } from '@/features/analytics/trendPeriod';
import {
  getMealPeriodTrend,
  getMealPeriodTurnover,
  getLaborTrend,
  getProductTrend,
  getRevenueTrend,
  type LaborTrendResult,
  type MealPeriodKey,
  type ProductDimension,
  type ProductTrendPoint,
  type ProductTrendResult,
  type RevenueTrendPoint,
} from '@/services/api/analytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import type { ComparisonMode, OperationsLabor, PreviousPeriod } from '@/services/api/operationsAnalytics';
import { readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import type { ChartComparisonSummaryRow, ChartExportSeries } from '@/services/files/shareChart';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, sumAmounts } from '@/utils/number';
import { beijingToday } from '@/utils/time';

type ChartType = 'revenue' | 'meal-business' | 'meal-turnover' | 'labor-hours' | 'labor-efficiency' | 'product';
type ChartRouteParams = { cacheKey?: string; comparisonDateFrom?: string; comparisonDateTo?: string; comparisonMode?: string; dashboardCacheKey?: string; dateFrom?: string; dateTo?: string; departmentKeys?: string; dimKey?: string; dimType?: string; granularity?: string; includeCurrent?: string; laborMetric?: string; laborScopes?: string; periodKey?: string; productKey?: string; productScopes?: string; revenueMode?: string; scopeKeys?: string; scopeLabel?: string; selectedProductKeys?: string; sourceType?: string; storeKeys?: string; type?: string };
type ChartData = { laborComparison?: OperationsLabor | null; laborModel?: LaborChartModel; meta: string; points: DashboardChartPoint[]; previousPeriod?: PreviousPeriod | null; productName?: string; productPoints?: ProductTrendPoint[]; productTrend?: ProductTrendResult; productTrends?: Record<string, ProductTrendResult>; series?: DashboardTrendSeries[] };
type DashboardSnapshot = NonNullable<ReturnType<typeof useAnalyticsStore.getState>['data']>;
type LaborLoadContext = { cacheKey: string; comparisonMode: ComparisonMode; comparisonScopes: ExplicitStoreScope[]; dashboardCacheContext: LaborDashboardCacheContext; dashboardCacheKey?: string; departmentKeys: string[]; deviceOffline: boolean; metric: 'efficiency' | 'hours'; scopeLabel: string };
type ProductLoadContext = { cacheKey?: string; cachedTrend: ProductTrendResult | null; deviceOffline: boolean; dimKey: string; dimType: ProductDimension; productKey: string; productKeys: string[] };
type ProductCachePayload = { selectedProductKeys?: string[]; trend?: ProductTrendResult | null; trends?: Record<string, ProductTrendResult> };
type LaborDashboardCachePayload = { cacheContext?: unknown; comparison?: OperationsLabor | null; trend?: LaborTrendResult };

export default function ChartRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<ChartRouteParams>();
  const store = useAnalyticsStore();
  const product = useInsightDetailStore((state) => state.product);
  const cachedProductTrend = useInsightDetailStore((state) => state.productTrend);
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const initialChartType = normalizeChartType(params.type ?? laborChartTypeFromMetric(params.laborMetric));
  const [activeFilters, setActiveFilters] = useState(() => initialFiltersForChart(initialChartType, store, params));
  const [laborDepartmentOverride, setLaborDepartmentOverride] = useState<string[] | null>(() => isLaborChart(initialChartType) ? parseCsvOrNull(params.departmentKeys) : null);
  const [laborCacheOverride, setLaborCacheOverride] = useState<string | null>(() => isLaborChart(initialChartType) ? params.cacheKey || null : null);
  const [laborDashboardCacheOverride, setLaborDashboardCacheOverride] = useState<string | null>(() => isLaborChart(initialChartType) ? params.dashboardCacheKey || null : null);
  const [laborScopeOverride, setLaborScopeOverride] = useState<ExplicitStoreScope[] | null>(() => isLaborChart(initialChartType) ? parseExplicitScopes(params.laborScopes) : null);
  const [laborScopeLabelOverride, setLaborScopeLabelOverride] = useState<string | null>(() => isLaborChart(initialChartType) ? params.scopeLabel || null : null);
  const [chartType, setChartType] = useState<ChartType>(initialChartType);
  const [periodKey, setPeriodKey] = useState<MealPeriodKey>(normalizePeriodKey(params.periodKey));
  const [revenueMode, setRevenueMode] = useState<RevenueChartMode>(normalizeRevenueMode(params.revenueMode));
  const chartCaptureRef = useRef<View>(null);
  const initialFilterKey = useRef(serializeAnalyticsFilters(activeFilters));
  const urlProductKeys = parseCsvOrNull(params.selectedProductKeys) ?? [];
  const selectedProductKeys = urlProductKeys.length
    ? urlProductKeys
    : params.productKey
      ? [params.productKey]
      : store.selectedProductKeys ?? [];
  const productKey = params.productKey || selectedProductKeys[0] || product?.product_key || '';
  const productKeys = selectedProductKeys.length ? selectedProductKeys : params.productKey ? [params.productKey] : [];
  const [chartData, setChartData] = useState<ChartData>(() => matchesProductTrend(cachedProductTrend, productKey, params.dimKey, params.dimType, activeFilters)
    ? productChartData(cachedProductTrend as NonNullable<typeof cachedProductTrend>, '已加载数据')
    : { meta: '正在加载图表数据', points: [] });
  const laborMetric = chartType === 'labor-hours' ? 'hours' : 'efficiency';
  const comparisonMode = normalizeComparisonMode(params.comparisonMode);
  const laborScope = useMemo(() => resolveLaborScope(activeFilters.scopeKeys ?? ['ALL'], store.scopeTree ?? []), [activeFilters.scopeKeys, store.scopeTree]);
  const productScopeOverride = useMemo(() => parseExplicitScopes(params.productScopes), [params.productScopes]);
  const laborDepartmentKeys = laborDepartmentOverride ?? laborScope.requestStoreKeys;
  const laborComparisonScopes = laborScopeOverride ?? laborScope.comparisonScopes;
  const laborScopeLabel = laborScopeLabelOverride ?? laborScope.label ?? storeSelectionLabel(activeFilters, store.stores, store.scopeTree ?? []);
  const expectedLaborCacheKey = laborAnalyticsCacheKey(activeFilters, laborMetric, laborDepartmentKeys, comparisonMode);
  const laborCacheKey = laborCacheOverride === expectedLaborCacheKey
    ? laborCacheOverride
    : expectedLaborCacheKey;
  const laborDashboardCacheContext = useMemo(
    () => createLaborDashboardCacheContext(activeFilters, laborDepartmentKeys, laborScope.cacheKey, comparisonMode),
    [activeFilters, comparisonMode, laborDepartmentKeys, laborScope.cacheKey],
  );
  const productComparisonScopes = useMemo(() => productScopeOverride
    ?? resolveStoreScopeSelection(activeFilters.scopeKeys ?? ['ALL'], store.scopeTree ?? []).scopes,
  [activeFilters.scopeKeys, productScopeOverride, store.scopeTree]);
  const productScope = { dimKey: params.dimKey || 'ALL', dimType: normalizeProductDimension(params.dimType) };
  const expectedProductCacheKey = productAnalyticsCacheKey(activeFilters, productScope, productKeys, comparisonMode);
  const productCacheKey = params.cacheKey === expectedProductCacheKey ? params.cacheKey : undefined;
  const expectedLaborDashboardCacheKey = laborDashboardCacheScope(activeFilters, laborScope.cacheKey, comparisonMode);
  const laborDashboardCacheKey = laborDashboardCacheOverride === expectedLaborDashboardCacheKey ? laborDashboardCacheOverride : undefined;
  const initialDashboardSnapshot = useRef(store.data && store.dataSource && store.dataFilterKey
    ? { data: store.data, filterKey: store.dataFilterKey }
    : null);
  const dashboardSnapshot = initialDashboardSnapshot.current?.filterKey === serializeAnalyticsFilters(activeFilters)
    ? initialDashboardSnapshot.current.data
    : null;
  const laborComparison = laborComparisonSeries(chartData.laborModel?.comparisonScopes ?? [], laborMetric);

  useEffect(() => {
    if (chartType === 'product' && deviceOffline && !productCacheKey && productKeys.length <= 1) {
      if (matchesProductTrend(cachedProductTrend, productKey, params.dimKey, params.dimType, activeFilters)) {
        setChartData(productChartData(cachedProductTrend as NonNullable<typeof cachedProductTrend>, '离线缓存'));
        return;
      }
    }
    const controller = new AbortController();
    setChartData((current) => ({ ...current, meta: '正在加载图表数据' }));
    void loadChartData(chartType, revenueMode, periodKey, activeFilters, store.stores, store.scopeTree ?? [], controller.signal, {
      cacheKey: productCacheKey,
      cachedTrend: cachedProductTrend,
      deviceOffline,
      dimKey: productScope.dimKey,
      dimType: productScope.dimType,
      productKey,
      productKeys,
    }, { cacheKey: laborCacheKey, comparisonMode, comparisonScopes: laborComparisonScopes, dashboardCacheContext: laborDashboardCacheContext, dashboardCacheKey: laborDashboardCacheKey, departmentKeys: laborDepartmentKeys, deviceOffline, metric: laborMetric, scopeLabel: laborScopeLabel }, dashboardSnapshot)
      .then((result) => { if (!controller.signal.aborted) setChartData(result); })
      .catch((error) => { if (!controller.signal.aborted) setChartData((current) => chartType === 'product' && current.productPoints?.length
        ? { ...current, meta: '更新失败，显示已加载数据' }
        : { meta: error instanceof Error ? error.message : '图表数据加载失败', points: [] }); });
    return () => controller.abort();
  }, [activeFilters, cachedProductTrend, chartType, comparisonMode, dashboardSnapshot, deviceOffline, laborCacheKey, laborComparisonScopes, laborDashboardCacheContext, laborDashboardCacheKey, laborDepartmentKeys, laborMetric, laborScopeLabel, params.dimKey, params.dimType, periodKey, productCacheKey, productKey, productKeys.join(','), productScope.dimKey, productScope.dimType, revenueMode, store.scopeTree, store.stores]);

  const fullscreenProductCount = productKeys.length || Object.keys(chartData.productTrends ?? {}).length;
  const title = chartType === 'product' && fullscreenProductCount > 1 ? '多产品销量趋势' : chartTitle(chartType, revenueMode);
  const mealLabel = MEAL_PERIOD_OPTIONS.find((item) => item.key === periodKey)?.label ?? '午餐';
  const storeLabel = storeSelectionLabel(activeFilters, store.stores, store.scopeTree ?? []);
  const productScopeLabel = productComparisonScopes.length
    ? productComparisonScopes.map((scope) => scope.label).join('、')
    : storeLabel;
  const activeChartKey = chartStateKey(chartType, revenueMode, periodKey);
  const productChartModel = useMemo(() => chartType === 'product'
    ? buildMultiProductChartModel(chartData.productTrends ?? (chartData.productTrend ? { [chartData.productTrend.product_key]: chartData.productTrend } : {}), productComparisonScopes, productKeys)
    : null, [chartData.productTrend, chartData.productTrends, chartType, productComparisonScopes, productKeys.join(',')]);
  const visibleLaborComparison = comparisonMode === 'none' ? null : chartData.laborComparison ?? null;
  const routePreviousPeriod = comparisonMode === 'none' || initialFilterKey.current !== serializeAnalyticsFilters(activeFilters)
    ? undefined
    : previousPeriodFromParams(params);
  const exportPreviousPeriod = comparisonMode === 'none'
    ? undefined
    : isLaborChart(chartType)
      ? visibleLaborComparison?.previous_period
      : chartType === 'product'
        ? routePreviousPeriod
        : chartData.previousPeriod ?? routePreviousPeriod;
  const laborExportSeries = isLaborChart(chartType) && chartData.laborModel ? buildLaborExportSeries(chartData.laborModel, laborMetric) : [];
  const laborComparisonSummaryRows = isLaborChart(chartType) ? laborComparisonSummaryRowsForMetric(visibleLaborComparison, laborMetric) : undefined;
  const exportSeries = chartData.series ?? productChartModel?.series ?? laborExportSeries;
  const availableIds = isLaborChart(chartType)
    ? laborTrendSeriesIds(laborMetric, chartData.laborModel?.movingAverages, activeFilters.granularity ?? 'day', laborComparison)
    : exportSeries.filter((item) => item.available !== false).map((item) => item.id);
  const filterSummary = chartType === 'product'
    ? `${activeFilters.dateFrom} 至 ${activeFilters.dateTo} · 按${granularityLabel(activeFilters.granularity)} · ${productDimensionSummary(normalizeProductDimension(params.dimType), params.dimKey || 'ALL')}`
    : `${activeFilters.dateFrom} 至 ${activeFilters.dateTo} · ${storeLabel}${chartType === 'revenue' ? ` · ${revenueMode === 'sources' ? '堂食/外卖' : '净实收'}` : isLaborChart(chartType) ? ` · 按${granularityLabel(activeFilters.granularity)}` : ` · ${mealLabel}`}`;
  const customChart = isLaborChart(chartType)
    ? <LaborTrendChart comparisonSeries={laborComparison} detailPlacement="right" expanded granularity={activeFilters.granularity} hiddenSeriesIds={(store.hiddenSeriesByChart ?? {})[activeChartKey]} metric={laborMetric} movingAverages={chartData.laborModel?.movingAverages} onSelectPeriod={(period) => store.setSelectedChartPeriod?.(activeChartKey, period)} onToggleSeries={(id) => store.toggleSeriesVisibility?.(activeChartKey, availableIds, id)} points={chartData.laborModel?.points ?? []} selectedPeriod={(store.selectedPeriodByChart ?? {})[activeChartKey]} scopeLabel={laborScopeLabel} showHeader={false} />
    : chartType === 'product'
      ? <ProductTrendChart detailPlacement="right" expanded hiddenSeriesIds={(store.hiddenSeriesByChart ?? {})[activeChartKey]} model={productChartModel ?? undefined} onSelectionChange={(selection) => store.setSelectedChartSelection?.(activeChartKey, selection)} onToggleSeries={(id) => store.toggleSeriesVisibility?.(activeChartKey, availableIds, id)} points={chartData.productPoints ?? []} productName={chartData.productName || product?.product_name || productKey || '产品'} selectedPeriod={(store.selectedPeriodByChart ?? {})[activeChartKey]} selectedSeriesId={(store.selectedSeriesByChart ?? {})[activeChartKey]} showHeader={false} />
      : undefined;

  return <FullscreenChartScreen
    captureTarget={chartCaptureRef}
    chart={customChart}
    filterPanel={chartType === 'product' ? undefined : (close) => <LandscapeFilterPanel
      chartType={chartType}
      filters={activeFilters}
      onApply={(next) => {
        const resolvedFilters = resolveScopeFilters(next.filters, store.scopeTree ?? []);
        setActiveFilters(resolvedFilters);
        setChartType(next.chartType);
        setPeriodKey(next.periodKey);
        setRevenueMode(next.revenueMode);
        if (isDashboardChart(next.chartType)) {
          store.setDashboardFilters(resolvedFilters);
          void store.refresh();
        } else if (isLaborChart(next.chartType)) {
          setLaborDepartmentOverride(null);
          setLaborCacheOverride(null);
          setLaborDashboardCacheOverride(null);
          setLaborScopeOverride(null);
          setLaborScopeLabelOverride(null);
          store.setLaborFilters(resolvedFilters);
        } else {
          store.setFilters(resolvedFilters);
        }
        close();
      }}
      periodKey={periodKey}
      revenueMode={revenueMode}
      scopeTree={store.scopeTree ?? []}
      stores={store.stores}
    />}
    filterSummary={filterSummary}
    headerAction={exportSeries.length ? <ChartExportMenu
      captureTarget={chartCaptureRef}
      comparisonSummaryRows={laborComparisonSummaryRows}
      dateFrom={activeFilters.dateFrom}
      dateTo={activeFilters.dateTo}
      excludedDates={visibleLaborComparison?.excluded_dates}
      extraColumns={isLaborChart(chartType) && !chartData.laborModel?.comparisonScopes.length ? [{ field: laborMetric === 'hours' ? 'headcount' : 'net_revenue', label: laborMetric === 'hours' ? '人数' : '净实收' }] : undefined}
      granularity={chartType === 'product' ? productChartModel?.granularity ?? activeFilters.granularity ?? 'day' : chartType === 'revenue' || isLaborChart(chartType) ? activeFilters.granularity ?? 'day' : 'day'}
      hiddenSeriesIds={(store.hiddenSeriesByChart ?? {})[activeChartKey]}
      includeOrderCount={!isLaborChart(chartType)}
      previousPeriod={exportPreviousPeriod}
      scopeLabel={isLaborChart(chartType) ? laborScopeLabel : chartType === 'product' ? productScopeLabel : undefined}
      series={exportSeries}
      seriesMetrics={chartType === 'product' ? [{ field: 'quantity', label: '销量' }, { field: 'sales_amount', label: '销售额' }, { field: 'order_count', label: '订单数' }] : undefined}
      title={`${title}-${chartType === 'product' ? productScopeLabel : storeLabel}`}
    /> : undefined}
    hiddenSeriesIds={(store.hiddenSeriesByChart ?? {})[activeChartKey]}
    meta={chartData.meta}
    metricLabel={chartType === 'meal-business' || chartType === 'meal-turnover' ? mealLabel : undefined}
    onClose={() => router.back()}
    onSelectPeriod={(period) => store.setSelectedChartPeriod?.(activeChartKey, period)}
    onToggleSeries={(id) => store.toggleSeriesVisibility?.(activeChartKey, availableIds, id)}
    points={chartData.points}
    selectedPeriod={(store.selectedPeriodByChart ?? {})[activeChartKey]}
    series={chartData.series}
    title={title}
    valueMode={chartType === 'meal-turnover' ? 'turnover' : 'currency'}
  />;
}

function LandscapeFilterPanel({ chartType, filters, onApply, periodKey, revenueMode, scopeTree, stores }: {
  chartType: ChartType;
  filters: AnalyticsFilters;
  onApply: (next: { chartType: ChartType; filters: AnalyticsFilters; periodKey: MealPeriodKey; revenueMode: RevenueChartMode }) => void;
  periodKey: MealPeriodKey;
  revenueMode: RevenueChartMode;
  scopeTree: StoreScopeNode[];
  stores: Array<{ key: string; label: string }>;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [draftFilters, setDraftFilters] = useState(filters);
  const [draftType, setDraftType] = useState(chartType);
  const [draftPeriod, setDraftPeriod] = useState(periodKey);
  const [draftRevenueMode, setDraftRevenueMode] = useState(revenueMode);
  const [customOpen, setCustomOpen] = useState(false);
  const today = beijingToday();
  useEffect(() => { setDraftFilters(filters); setDraftType(chartType); setDraftPeriod(periodKey); setDraftRevenueMode(revenueMode); setCustomOpen(false); }, [chartType, filters, periodKey, revenueMode]);

  const toggleStore = (key: string) => {
    setDraftFilters((current) => {
      const selected = current.storeKeys?.length ? current.storeKeys : [current.storeKey];
      const next = key === 'ALL' ? ['ALL'] : selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
      const storeKeys = normalizeStoreSelection(selected, next);
      return { ...current, storeKey: storeKeyForSelection(storeKeys), storeKeys };
    });
  };

  return <>
    {chartType === 'revenue' || isLaborChart(chartType) ? <TrendPeriodControls filters={draftFilters} onChange={setDraftFilters} today={today} /> : null}
    <Text style={styles.label}>日期区间</Text>
    {(draftFilters.granularity ?? 'day') === 'day' || (!isLaborChart(chartType) && chartType !== 'revenue') ? <View style={styles.quickRanges}>{([['last10', '近10日'], ['last30', '近30日'], ['lastMonth', '上月']] as const).map(([value, label]) => <Pressable accessibilityLabel={label} accessibilityRole="button" key={value} onPress={() => { setDraftFilters((current) => ({ ...current, ...analyticsDateRange(value, today) })); setCustomOpen(false); }} style={styles.option}><Text style={styles.optionText}>{label}</Text></Pressable>)}</View> : <Pressable accessibilityRole="button" onPress={() => setDraftFilters((current) => ({ ...current, ...defaultTrendRange(current.granularity ?? 'day', today) }))} style={styles.option}><Text style={styles.optionText}>最近 5 个完整{draftFilters.granularity === 'week' ? '周' : '月'}</Text></Pressable>}
    <Pressable accessibilityLabel="自定义" accessibilityRole="button" accessibilityState={{ expanded: customOpen }} onPress={() => setCustomOpen((open) => !open)} style={[styles.option, customOpen && styles.optionSelected]}><Text style={[styles.optionText, customOpen && { color: theme.action.onPrimary }]}>自定义 · {draftFilters.dateFrom.slice(5)} 至 {draftFilters.dateTo.slice(5)}</Text></Pressable>
    {customOpen ? <AnalyticsCalendar dateFrom={draftFilters.dateFrom} dateTo={draftFilters.dateTo} maxDate={latestAnalyticsDate(today)} onChange={(dateFrom, dateTo) => setDraftFilters((current) => {
      if (chartType !== 'revenue' && !isLaborChart(chartType)) return { ...current, dateFrom, dateTo };
      const normalized = normalizeTrendRange(current.granularity ?? 'day', dateFrom, dateTo, Boolean(current.includeCurrent), today);
      return { ...current, dateFrom: normalized[0], dateTo: normalized[1] };
    })} /> : null}
    <Text style={styles.label}>{scopeTree.length ? '经营范围' : '门店'}</Text>
    {scopeTree.length ? <StoreScopePicker nodes={scopeTree} onChange={(scopeKeys) => setDraftFilters((current) => ({ ...current, scopeKeys }))} selectedKeys={draftFilters.scopeKeys ?? ['ALL']} /> : <View style={styles.options}>{[{ key: 'ALL', label: '全部门店' }, ...stores].map((item) => <FilterOption accessibilityLabel={`选择门店 ${item.label}`} key={item.key} label={item.label} onPress={() => toggleStore(item.key)} selected={(draftFilters.storeKeys?.length ? draftFilters.storeKeys : [draftFilters.storeKey]).includes(item.key)} styles={styles} theme={theme} />)}</View>}
    {chartType === 'revenue' ? <>
      <Text style={styles.label}>营收图表</Text>
      <View style={styles.options}>{([['net', '净实收'], ['sources', '堂食 · 外卖']] as const).map(([value, label]) => <FilterOption key={value} label={label} onPress={() => setDraftRevenueMode(value)} selected={draftRevenueMode === value} styles={styles} theme={theme} />)}</View>
    </> : isLaborChart(chartType) ? null : <>
      <Text style={styles.label}>餐段指标</Text>
      <View style={styles.options}>{([['meal-business', '经营'], ['meal-turnover', '翻台率']] as const).map(([value, label]) => <FilterOption key={value} label={label} onPress={() => setDraftType(value)} selected={draftType === value} styles={styles} theme={theme} />)}</View>
      <Text style={styles.label}>餐段</Text>
      <View style={styles.options}>{MEAL_PERIOD_OPTIONS.map((item) => <FilterOption key={item.key} label={item.label} onPress={() => setDraftPeriod(item.key)} selected={draftPeriod === item.key} styles={styles} theme={theme} />)}</View>
    </>}
    <Pressable accessibilityLabel="应用图表筛选" accessibilityRole="button" onPress={() => {
      const granularity = draftFilters.granularity ?? 'day';
      const [dateFrom, dateTo] = normalizeTrendRange(granularity, draftFilters.dateFrom, draftFilters.dateTo, Boolean(draftFilters.includeCurrent), today);
      onApply({ chartType: draftType, filters: { ...draftFilters, dateFrom, dateTo, granularity }, periodKey: draftPeriod, revenueMode: draftRevenueMode });
    }} style={styles.apply}><Text style={styles.applyText}>确定</Text></Pressable>
  </>;
}

function FilterOption({ accessibilityLabel, label, onPress, selected, styles, theme }: { accessibilityLabel?: string; label: string; onPress: () => void; selected: boolean; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  return <Pressable accessibilityLabel={accessibilityLabel ?? `选择 ${label}`} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected && styles.optionSelected]}><Text numberOfLines={1} style={[styles.optionText, selected && { color: theme.action.onPrimary }]}>{label}</Text></Pressable>;
}

async function loadChartData(chartType: ChartType, revenueMode: RevenueChartMode, periodKey: MealPeriodKey, filters: AnalyticsFilters, stores: Array<{ key: string; label: string }>, scopeTree: StoreScopeNode[], signal: AbortSignal, productContext: ProductLoadContext, laborContext: LaborLoadContext, dashboardSnapshot: DashboardSnapshot | null): Promise<ChartData> {
  if (chartType === 'revenue') {
    if (revenueMode === 'sources') {
      const [shopResult, takeoutResult] = dashboardSnapshot
        ? [dashboardSnapshot.revenueSources.shop, dashboardSnapshot.revenueSources.takeout]
        : await Promise.all([
            getRevenueTrend({ ...filters, sourceType: 'shop' }, { signal }),
            getRevenueTrend({ ...filters, sourceType: 'takeout' }, { signal }),
          ]);
      const model = buildRevenueChartModel({ filters, mode: 'sources', revenue: shopResult, revenueSources: { shop: shopResult, takeout: takeoutResult }, scopeTree, stores });
      const periods = new Set(model.series?.flatMap((series) => series.points.map((point) => point.period)) ?? []);
      const total = sumAmounts(
        [shopResult, takeoutResult]
          .flatMap((result) => result.points)
          .map((point) => (point.missing ? 0 : point.net_income)),
      );
      return { meta: `区间净实收 ${formatAmount(total)} · ${periods.size} ${periodNoun(filters.granularity)}`, points: model.points, previousPeriod: dashboardSnapshot?.comparison?.previous_period ?? null, series: model.series };
    }
    const result = dashboardSnapshot?.revenue ?? await getRevenueTrend({ ...filters, sourceType: 'all' }, { signal });
    const model = buildRevenueChartModel({ filters, mode: 'net', revenue: result, revenueSources: { shop: result, takeout: result }, scopeTree, stores });
    const points = availableRevenuePoints(result.points);
    return { meta: `区间净实收 ${formatAmount(sumAmounts(points.map((point) => point.net_income)))} · ${points.length} ${periodNoun(filters.granularity)}`, points: model.points, previousPeriod: dashboardSnapshot?.comparison?.previous_period ?? null, series: model.series };
  }
  if (isLaborChart(chartType)) {
    const result = await loadLaborTrend(filters, signal, laborContext);
    const laborModel = buildLaborChartModel(result.trend, laborContext.departmentKeys, laborContext.comparisonScopes);
    return { laborComparison: result.comparison, laborModel, meta: `${laborContext.scopeLabel || storeSelectionLabel(filters, stores, scopeTree)} · ${laborModel.points.length} ${periodNoun(filters.granularity)}`, points: [] };
  }
  if (chartType === 'product') {
    const trends = await loadProductTrends(filters, signal, productContext);
    const keys = Object.keys(trends);
    const result = trends[productContext.productKey] ?? Object.values(trends)[0];
    if (!result) throw new Error('未选择趋势产品');
    const points = visibleProductTrendPoints(result.points);
    const selectedCount = productContext.productKeys.length || keys.length;
    return { meta: `${selectedCount > 1 ? `${selectedCount} 款产品` : result.product_name || productContext.productKey} · ${points.length} ${periodNoun(result.granularity ?? filters.granularity)}`, points: [], productName: result.product_name || productContext.productKey, productPoints: result.points, productTrend: result, productTrends: trends };
  }
  if (chartType === 'meal-business') {
    const result = dashboardSnapshot?.mealTrend ?? await getMealPeriodTrend(filters, { signal });
    const model = buildMealChartModel(result, undefined, 'business', periodKey, mealScopes(filters, scopeTree));
    const periods = new Set(model.series?.flatMap((series) => series.points.map((point) => point.period)) ?? model.points.map((point) => point.period));
    const total = sumAmounts(model.points.map((point) => point.net_income));
    return { meta: `区间净实收 ${formatAmount(total)} · ${periods.size} 天`, points: model.points, previousPeriod: dashboardSnapshot?.comparison?.previous_period ?? null, series: model.series };
  }
  const result = dashboardSnapshot?.turnover ?? await getMealPeriodTurnover(filters, { signal });
  const model = buildMealChartModel({
    date_from: result.date_from ?? filters.dateFrom,
    date_to: result.date_to ?? filters.dateTo,
    points: [],
    store_key: filters.storeKey,
  }, result, 'turnover', periodKey, mealScopes(filters, scopeTree));
  const excludedStoreCount = result.excluded_stores?.length ?? 0;
  return {
    meta: `有效 ${result.eligible_store_count} 家门店 · 桌台总数 ${result.table_count} 张 · 排除 ${excludedStoreCount} 家门店`,
    points: model.points,
    previousPeriod: dashboardSnapshot?.comparison?.previous_period ?? null,
    series: model.series,
  };
}

async function loadProductTrends(filters: AnalyticsFilters, signal: AbortSignal, context: ProductLoadContext): Promise<Record<string, ProductTrendResult>> {
  // The detail key is a compatibility fallback. Keep an empty selection empty here so a v4 cache can restore its full saved selection.
  const requestedKeys = context.productKeys.slice(0, 5);
  const readCache = async (): Promise<Record<string, ProductTrendResult>> => {
    if (!context.cacheKey) return {};
    const cached = await readCachedAnalytics<ProductCachePayload>('products', context.cacheKey, Date.now()).catch(() => null);
    const cachedTrends = cached?.data.trends ?? {};
    const cacheKeys = cached?.data.selectedProductKeys?.length ? cached.data.selectedProductKeys : Object.keys(cachedTrends);
    const keys = requestedKeys.length ? requestedKeys : cacheKeys;
    const trends = Object.fromEntries(keys.flatMap((key) => {
      const trend = cachedTrends[key];
      return trend && matchesProductTrend(trend, key, context.dimKey, context.dimType, filters) ? [[key, trend] as const] : [];
    }));
    if (Object.keys(trends).length) return trends;
    const legacy = cached?.data.trend;
    return legacy && matchesProductTrend(legacy, context.productKey, context.dimKey, context.dimType, filters)
      ? { [legacy.product_key]: legacy }
      : {};
  };
  if (context.deviceOffline) {
    const cached = await readCache();
    if (Object.keys(cached).length) return cached;
    const detail = matchesProductTrend(context.cachedTrend, context.productKey, context.dimKey, context.dimType, filters) ? context.cachedTrend : null;
    if (detail) return { [detail.product_key]: detail };
    throw new Error('离线状态下暂无已加载趋势');
  }
  const keys = requestedKeys.length ? requestedKeys : context.productKey ? [context.productKey] : [];
  if (!keys.length) throw new Error('未选择趋势产品');
  return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await loadProductTrend(filters, signal, { ...context, productKey: key, productKeys: [key] })] as const)));
}

async function loadProductTrend(filters: AnalyticsFilters, signal: AbortSignal, context: ProductLoadContext): Promise<ProductTrendResult> {
  const cachedTrend = matchesProductTrend(context.cachedTrend, context.productKey, context.dimKey, context.dimType, filters)
    ? context.cachedTrend
    : null;
  const readPortraitCache = async () => {
    if (!context.cacheKey) return null;
    const cached = await readCachedAnalytics<{ trend: ProductTrendResult | null }>('products', context.cacheKey, Date.now()).catch(() => null);
    return matchesProductTrend(cached?.data.trend ?? null, context.productKey, context.dimKey, context.dimType, filters)
      ? cached?.data.trend ?? null
      : null;
  };
  if (context.deviceOffline) {
    const persistentTrend = cachedTrend ?? await readPortraitCache();
    if (persistentTrend) return persistentTrend;
    throw new Error('离线状态下暂无已加载趋势');
  }
  try {
    return await getProductTrend(context.productKey, filters, {
      dimKey: context.dimKey,
      dimType: context.dimType,
      granularity: filters.granularity ?? 'day',
      includeCurrent: Boolean(filters.includeCurrent),
      signal,
      storeKeys: selectedAnalyticsStoreKeys(filters),
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE) throw error;
    const persistentTrend = cachedTrend ?? await readPortraitCache();
    if (persistentTrend) return persistentTrend;
    throw error;
  }
}

async function loadLaborTrend(filters: AnalyticsFilters, signal: AbortSignal, context: LaborLoadContext): Promise<{ comparison: OperationsLabor | null; trend: LaborTrendResult }> {
  const readPortraitCache = async () => {
    if (!context.dashboardCacheKey) return null;
    const cached = await readCachedAnalytics<LaborDashboardCachePayload>('labor', context.dashboardCacheKey, Date.now()).catch(() => null);
    const payload = cached?.data;
    const trend = payload?.trend;
    return trend
      && matchesLaborTrend(trend, filters)
      && matchesLaborDashboardCacheContext(payload.cacheContext, context.dashboardCacheContext)
      ? { comparison: context.comparisonMode === 'none' ? null : payload.comparison ?? null, trend }
      : null;
  };
  if (context.deviceOffline) {
    const portraitTrend = await readPortraitCache();
    if (portraitTrend) return portraitTrend;
    const cached = await readCachedAnalytics<LaborTrendResult>('laborTrend', context.cacheKey, Date.now()).catch(() => null);
    if (cached && matchesLaborTrend(cached.data, filters)) return { comparison: null, trend: cached.data };
    throw new Error('离线状态下暂无同条件人效趋势');
  }
  const portraitCache = await readPortraitCache();
  try {
    const result = await getLaborTrend(filters, {
      granularity: filters.granularity ?? 'day',
      includeCurrent: Boolean(filters.includeCurrent),
      signal,
      storeKeys: context.departmentKeys,
    });
    void saveCachedAnalytics('laborTrend', context.cacheKey, result, Date.now()).catch(() => {});
    return { comparison: portraitCache?.comparison ?? null, trend: result };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE) throw error;
    const cached = await readCachedAnalytics<LaborTrendResult>('laborTrend', context.cacheKey, Date.now()).catch(() => null);
    if (cached && matchesLaborTrend(cached.data, filters)) return { comparison: null, trend: cached.data };
    const portraitTrend = await readPortraitCache();
    if (portraitTrend) return portraitTrend;
    throw error;
  }
}

function buildLaborExportSeries(model: LaborChartModel, metric: 'efficiency' | 'hours'): ChartExportSeries[] {
  const exportPoints = (points: LaborChartPoint[]) => points.map((point) => ({
    ...point,
    missing: point.availability !== 'visible',
  }));
  if (model.comparisonScopes.length) {
    const comparison = laborComparisonSeries(model.comparisonScopes, metric).map((series) => ({ ...series, points: exportPoints(series.points) }));
    const extraFields = metric === 'hours'
      ? [{ field: 'net_revenue', label: '净实收' }, { field: 'headcount', label: '人数' }]
      : [{ field: 'net_revenue', label: '净实收' }, { field: 'actual_hours', label: '实际工时' }];
    return [
      ...comparison,
      ...model.comparisonScopes.flatMap((scope) => extraFields.map((extra) => ({
        field: extra.field,
        id: `${scope.id}:${extra.field}`,
        label: `${scope.label} ${extra.label}`,
        points: exportPoints(scope.points),
        primary: false,
      }))),
    ];
  }
  const points = exportPoints(model.allPoints);
  return metric === 'hours'
    ? [
        { field: 'actual_hours', id: 'actual_hours', label: '实际工时', points, primary: true },
        { field: 'planned_hours', id: 'planned_hours', label: '排班工时', points, primary: true },
      ]
    : [
        { field: 'actual_revenue_per_hour', id: 'actual_revenue_per_hour', label: '实际人效', points, primary: true },
        { field: 'planned_revenue_per_hour', id: 'planned_revenue_per_hour', label: '排班人效', points, primary: true },
      ];
}

function laborComparisonSummaryRowsForMetric(comparison: OperationsLabor | null, metric: 'efficiency' | 'hours'): ChartComparisonSummaryRow[] | undefined {
  if (!comparison) return undefined;
  return laborComparisonMetrics(metric).map(({ field, label }) => {
    const value = comparison.summary.comparison?.[field];
    return {
      统计范围: '统计区间汇总',
      指标: label,
      本期: value?.current ?? '',
      上期: value?.previous ?? '',
      差额: value?.difference ?? '',
      变动率: value?.change_rate ?? '',
    };
  });
}

function laborComparisonMetrics(metric: 'efficiency' | 'hours') {
  return metric === 'hours'
    ? [{ field: 'actual_hours', label: '实际工时' }, { field: 'planned_hours', label: '排班工时' }]
    : [{ field: 'net_revenue', label: '净实收' }, { field: 'actual_revenue_per_hour', label: '实际人效' }, { field: 'planned_revenue_per_hour', label: '排班人效' }];
}

function mealScopes(filters: AnalyticsFilters, scopeTree: StoreScopeNode[]): ExplicitStoreScope[] {
  return resolveStoreScopeSelection(filters.scopeKeys ?? ['ALL'], scopeTree).scopes;
}

function availableRevenuePoints(points: RevenueTrendPoint[]): RevenueTrendPoint[] {
  return points.filter((point) => !point.missing);
}

function initialFiltersForChart(chartType: ChartType, store: { dashboardFilters: AnalyticsFilters; filters: AnalyticsFilters; laborFilters?: AnalyticsFilters; productFilters?: AnalyticsFilters }, params: ChartRouteParams): AnalyticsFilters {
  if (chartType === 'product') return routeFilters(store.productFilters ?? store.filters, params);
  if (isDashboardChart(chartType)) return store.dashboardFilters;
  if (!isLaborChart(chartType)) return store.filters;
  return routeFilters(store.laborFilters ?? store.filters, params);
}

function routeFilters(base: AnalyticsFilters, params: ChartRouteParams): AnalyticsFilters {
  const scopeKeys = parseCsv(params.scopeKeys);
  const storeKeys = parseCsv(params.storeKeys);
  const resolvedStoreKeys = storeKeys.length ? storeKeys : base.storeKeys;
  return {
    ...base,
    dateFrom: params.dateFrom || base.dateFrom,
    dateTo: params.dateTo || base.dateTo,
    granularity: normalizeGranularity(params.granularity, base.granularity),
    includeCurrent: params.includeCurrent === undefined ? base.includeCurrent : params.includeCurrent === 'true',
    scopeKeys: scopeKeys.length ? scopeKeys : base.scopeKeys,
    sourceType: normalizeSourceType(params.sourceType, base.sourceType),
    storeKey: storeKeyForSelection(resolvedStoreKeys),
    storeKeys: resolvedStoreKeys,
  };
}

function parseExplicitScopes(value?: string): ExplicitStoreScope[] | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Record<string, unknown>;
      const type = item.type;
      if (typeof item.key !== 'string' || typeof item.label !== 'string'
        || !Array.isArray(item.storeKeys) || !item.storeKeys.every((key) => typeof key === 'string')
        || (type !== 'department' && type !== 'store' && type !== 'group' && type !== 'ungrouped')) return [];
      const departmentKeys = Array.isArray(item.departmentKeys) && item.departmentKeys.every((key) => typeof key === 'string')
        ? item.departmentKeys
        : undefined;
      return [{ departmentKeys, key: item.key, label: item.label, storeKeys: item.storeKeys, type }];
    });
  } catch {
    return null;
  }
}

function parseCsv(value?: string): string[] {
  return [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseCsvOrNull(value?: string): string[] | null {
  const values = parseCsv(value);
  return values.length ? values : null;
}

function normalizeGranularity(value?: string, fallback?: TrendGranularity): TrendGranularity {
  return value === 'week' || value === 'month' || value === 'day' ? value : fallback ?? 'day';
}

function normalizeChartType(value?: string): ChartType {
  return value === 'meal-business' || value === 'meal-turnover' || value === 'labor-hours' || value === 'labor-efficiency' || value === 'product' ? value : 'revenue';
}

function laborChartTypeFromMetric(value?: string): ChartType | undefined {
  return value === 'hours' || value === 'efficiency' ? `labor-${value}` : undefined;
}

function normalizeSourceType(value: string | undefined, fallback: AnalyticsFilters['sourceType']): AnalyticsFilters['sourceType'] {
  return value === 'shop' || value === 'takeout' || value === 'all' ? value : fallback;
}

function normalizeComparisonMode(value?: string): ComparisonMode {
  return value === 'none' ? 'none' : 'previous';
}

function previousPeriodFromParams(params: ChartRouteParams): PreviousPeriod | undefined {
  if (!params.comparisonDateFrom || !params.comparisonDateTo) return undefined;
  return { date_from: params.comparisonDateFrom, date_to: params.comparisonDateTo };
}

function isLaborChart(value: ChartType): value is 'labor-hours' | 'labor-efficiency' {
  return value === 'labor-hours' || value === 'labor-efficiency';
}

function isDashboardChart(value: ChartType): value is 'revenue' | 'meal-business' | 'meal-turnover' {
  return value === 'revenue' || value === 'meal-business' || value === 'meal-turnover';
}

function chartTitle(chartType: ChartType, revenueMode: RevenueChartMode): string {
  if (chartType === 'revenue') return revenueMode === 'sources' ? '堂食/外卖净实收趋势' : '净实收趋势';
  if (chartType === 'meal-business') return '餐段经营趋势';
  if (chartType === 'meal-turnover') return '餐段翻台率趋势';
  if (chartType === 'product') return '单品销量趋势';
  return chartType === 'labor-hours' ? '工时趋势' : '人效趋势';
}

function normalizeProductDimension(value?: string): ProductDimension {
  if (value === 'source_type') return 'channel';
  return value === 'shop' || value === 'platform' || value === 'channel' ? value : 'all';
}

function productDimensionSummary(dimType: ProductDimension, dimKey: string): string {
  if (dimType === 'all') return '整合';
  if (dimType === 'shop') return `门店 ${dimKey}`;
  if (dimType === 'platform') return `平台 ${dimKey}`;
  return dimKey === 'takeout' ? '外卖' : '堂食';
}

function matchesProductTrend(result: ProductTrendResult | null, productKey: string | undefined, dimKey: string | undefined, dimType: string | undefined, filters: AnalyticsFilters): boolean {
  return Boolean(result
    && productKey
    && result.product_key === productKey
    && result.dim_key === (dimKey || 'ALL')
    && result.dim_type === normalizeProductDimension(dimType)
    && result.date_from === filters.dateFrom
    && result.date_to === filters.dateTo
    && (result.granularity ?? 'day') === (filters.granularity ?? 'day'));
}

function matchesLaborTrend(result: LaborTrendResult | null | undefined, filters: AnalyticsFilters): result is LaborTrendResult {
  const granularity = filters.granularity ?? 'day';
  return Boolean(result
    && result.granularity === granularity
    && ((result.date_from === filters.dateFrom && result.date_to === filters.dateTo)
      || result.period === `${filters.dateFrom}_${filters.dateTo}`));
}

function productChartData(result: ProductTrendResult, suffix?: string): ChartData {
  const points = visibleProductTrendPoints(result.points);
  const meta = `${result.product_name || result.product_key} · ${points.length} ${periodNoun(result.granularity)}${suffix ? ` · ${suffix}` : ''}`;
  return { meta, points: [], productName: result.product_name || result.product_key, productPoints: result.points, productTrend: result };
}

function normalizePeriodKey(value?: string): MealPeriodKey {
  return MEAL_PERIOD_OPTIONS.some((item) => item.key === value) ? value as MealPeriodKey : 'lunch';
}

function normalizeRevenueMode(value?: string): RevenueChartMode {
  return value === 'sources' ? 'sources' : 'net';
}

function storeSelectionLabel(filters: AnalyticsFilters, stores: Array<{ key: string; label: string }>, scopeTree: StoreScopeNode[]): string {
  if (scopeTree.length && filters.scopeKeys?.length) return resolveStoreScopeSelection(filters.scopeKeys, scopeTree).label;
  const storeKeys = selectedAnalyticsStoreKeys(filters);
  if (!storeKeys.length) return '全部门店';
  if (storeKeys.length > 1) return `${storeKeys.length} 家门店`;
  return stores.find((item) => item.key === storeKeys[0])?.label ?? '已选门店';
}

function resolveScopeFilters(filters: AnalyticsFilters, scopeTree: StoreScopeNode[]): AnalyticsFilters {
  if (!scopeTree.length || !filters.scopeKeys?.length) return filters;
  const selection = resolveStoreScopeSelection(filters.scopeKeys, scopeTree);
  const storeKeys = selection.shopKeys.length ? selection.shopKeys : ['ALL'];
  return { ...filters, scopeKeys: selection.scopeKeys, storeKey: storeKeyForSelection(storeKeys), storeKeys };
}

function chartStateKey(chartType: ChartType, revenueMode: RevenueChartMode, periodKey: MealPeriodKey): string {
  if (chartType === 'revenue') return `revenue:${revenueMode}`;
  if (chartType === 'meal-business') return `meal:business:${periodKey}`;
  if (chartType === 'meal-turnover') return `meal:turnover:${periodKey}`;
  if (chartType === 'product') return 'product:trend';
  return chartType;
}

function periodNoun(granularity?: string): string {
  return granularity === 'week' ? '周' : granularity === 'month' ? '月' : '天';
}

function granularityLabel(granularity?: string): string {
  return granularity === 'week' ? '周' : granularity === 'month' ? '月' : '日';
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    label: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    quickRanges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    option: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 6, borderWidth: 1, height: 36, justifyContent: 'center', maxWidth: '100%', minWidth: 68, paddingHorizontal: 10 },
    optionSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    optionText: { color: theme.text.primary, fontSize: 12, letterSpacing: 0 },
    apply: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 6, height: 44, justifyContent: 'center', marginTop: 4 },
    applyText: { color: theme.action.onPrimary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
  });
}
