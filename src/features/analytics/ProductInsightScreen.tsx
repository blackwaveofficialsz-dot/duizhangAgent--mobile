import { CalendarDays, ChevronDown, ChevronRight, Filter, RefreshCw, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenState } from '@/components/states/ScreenState';
import { showToast } from '@/components/feedback/AppToast';
import {
  getProducts,
  getProductTrend,
  listPlatformDim,
  type PlatformDim,
  type ProductRow,
  type ProductRequestOptions,
  type ProductsResult,
  type ProductTrendResult,
} from '@/services/api/analytics';
import { getOperationsProducts, type OperationsProducts } from '@/services/api/operationsAnalytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatBeijingDateTime } from '@/utils/time';
import { productAnalyticsCacheKey, selectedAnalyticsStoreKeys, type AnalyticsFilters } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';
import {
  DEFAULT_PRODUCT_SCOPE,
  effectiveProductScope,
  ProductFilterSheet,
  productScopeLabel,
  type ProductScope,
} from './ProductFilterSheet';
import { ProductTrendChart } from './ProductTrendChart';
import { buildMultiProductChartModel, normalizeProductSelection } from './productChartModels';
import { resolveStoreScopeSelection } from './storeScope';
import { comparisonDisplayItems, comparisonPeriodText } from './periodComparison';
import { PeriodComparisonControl } from './PeriodComparisonControl';
import { buildDetailPeriodOptions, type DetailPeriodOption } from './trendPeriod';

type Status = 'idle' | 'loading' | 'refreshing' | 'force-refreshing' | 'error';
type DetailPeriodSelection = { key: string; rangeKey: string };
type ProductDashboardData = {
  comparison: OperationsProducts | null;
  comparisonMode?: 'none' | 'previous';
  filters?: AnalyticsFilters;
  ranking: ProductsResult;
  selectedProductKeys?: string[];
  scope?: ProductScope;
  trends: Record<string, ProductTrendResult>;
};

const SALES_DEFINITION = '商品销额按订单商品原价或销售额统计，不扣优惠、退款和平台佣金，不等同财务净实收。';
const PRODUCT_CHART_KEY = 'product:trend';
const NOOP = () => {};

export function ProductInsightScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const analyticsStore = useAnalyticsStore();
  const {
    filters: sharedFilters,
    isOffline: dashboardCacheOffline,
    lastSyncedAt,
    loadScopes,
    loadStores,
    hiddenSeriesByChart = {},
    productFilters: productFilters = sharedFilters,
    scopeTree,
    selectedPeriodByChart = {},
    selectedSeriesByChart = {},
    setFilters: setSharedFilters,
    setProductFilters: setProductFilters = setSharedFilters,
    selectedProductKeys = [],
    setSelectedChartSelection,
    setSelectedProductKeys = NOOP,
    stores,
    syncSeriesVisibility,
    toggleSeriesVisibility,
  } = analyticsStore;
  const filters = productFilters;
  const setFilters = setProductFilters;
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const forceRefreshBlocked = networkStatus !== 'online';
  const [data, setData] = useState<ProductDashboardData | null>(null);
  const [scope, setScope] = useState<ProductScope>(DEFAULT_PRODUCT_SCOPE);
  const [platforms, setPlatforms] = useState<PlatformDim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [cacheOffline, setCacheOffline] = useState(false);
  const [cacheLastSyncedAt, setCacheLastSyncedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [trendLoading, setTrendLoading] = useState(false);
  const [detailPeriodSelection, setDetailPeriodSelection] = useState<DetailPeriodSelection | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const trendControllerRef = useRef<AbortController | null>(null);
  const comparisonControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const comparisonRequestIdRef = useRef(0);
  const trendRequestIdRef = useRef(0);
  const selectedProductKeysRef = useRef<string[]>(selectedProductKeys);
  const hasDataRef = useRef(false);
  const displayedScopeRef = useRef<string | null>(null);
  const offline = dashboardCacheOffline || deviceOffline || cacheOffline;
  const effectiveLastSyncedAt = cacheLastSyncedAt ?? lastSyncedAt;
  const requestScope = useMemo(() => effectiveProductScope(scope), [scope]);
  const scopeSelection = useMemo(() => resolveStoreScopeSelection(filters.scopeKeys ?? ['ALL'], scopeTree), [filters.scopeKeys, scopeTree]);
  const requestStoreKeys = useMemo(() => productRequestStoreKeys(filters, scopeSelection.shopKeys), [filters, scopeSelection.shopKeys]);
  const requestedTrendKeys = data?.selectedProductKeys ?? selectedProductKeys;
  const productChartModel = useMemo(() => data ? buildMultiProductChartModel(data.trends, scopeSelection.scopes, requestedTrendKeys) : null, [data, requestedTrendKeys, scopeSelection.scopes]);
  const productSeriesIds = useMemo(() => productChartModel?.series.filter((series) => series.available).map((series) => series.id) ?? [], [productChartModel]);
  const detailRangeKey = `${filters.granularity ?? 'day'}:${filters.dateFrom}:${filters.dateTo}`;
  const detailPeriodOptions = useMemo(
    () => buildDetailPeriodOptions(filters.granularity ?? 'day', filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo, filters.granularity],
  );
  const selectedDetailPeriod = useMemo(
    () => {
      const selectedKey = detailPeriodSelection?.rangeKey === detailRangeKey ? detailPeriodSelection.key : '';
      return detailPeriodOptions.find((option) => option.key === selectedKey)
        ?? detailPeriodOptions[detailPeriodOptions.length - 1];
    },
    [detailPeriodOptions, detailPeriodSelection?.key, detailPeriodSelection?.rangeKey, detailRangeKey],
  );
  const detailFilters = useMemo(
    () => selectedDetailPeriod
      ? { ...filters, dateFrom: selectedDetailPeriod.dateFrom, dateTo: selectedDetailPeriod.dateTo }
      : filters,
    [filters, selectedDetailPeriod?.dateFrom, selectedDetailPeriod?.dateTo],
  );

  useEffect(() => {
    if (selectedDetailPeriod && (detailPeriodSelection?.rangeKey !== detailRangeKey || detailPeriodSelection.key !== selectedDetailPeriod.key)) {
      setDetailPeriodSelection({ key: selectedDetailPeriod.key, rangeKey: detailRangeKey });
    }
  }, [detailPeriodSelection?.key, detailPeriodSelection?.rangeKey, detailRangeKey, selectedDetailPeriod]);

  useEffect(() => {
    if (productChartModel) syncSeriesVisibility(PRODUCT_CHART_KEY, productSeriesIds);
  }, [productChartModel, productSeriesIds, syncSeriesVisibility]);

  useEffect(() => {
    if (deviceOffline) return;
    const controller = new AbortController();
    void listPlatformDim({ signal: controller.signal }).then(setPlatforms).catch(() => {});
    return () => controller.abort();
  }, [deviceOffline]);

  useEffect(() => {
    void loadStores?.();
    void loadScopes?.();
  }, [loadScopes, loadStores]);

  useEffect(() => {
    selectedProductKeysRef.current = selectedProductKeys;
  }, [selectedProductKeys]);

  const loadTrends = useCallback(async (keys: string[], forceRefresh = false) => {
    trendControllerRef.current?.abort();
    const controller = new AbortController();
    trendControllerRef.current = controller;
    const requestId = ++trendRequestIdRef.current;
    const comparisonMode = analyticsStore.comparisonModeByModule?.products ?? 'previous';
    setData((current) => current ? {
      ...current,
      selectedProductKeys: keys,
      trends: Object.fromEntries(Object.entries(current.trends).filter(([key]) => keys.includes(key))),
    } : current);
    setTrendError(null);
    if (!keys.length || deviceOffline) {
      setTrendLoading(false);
      return;
    }
    setTrendLoading(true);
    try {
      const settled = await Promise.allSettled(keys.map(async (key) => [key, await getProductTrend(key, filters, productRequestOptions(filters, requestScope, { forceRefresh, signal: controller.signal, storeKeys: requestStoreKeys }))] as const));
      if (controller.signal.aborted || requestId !== trendRequestIdRef.current) return;
      const entries = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failed = settled.some((result) => result.status === 'rejected');
      setData((current) => {
        if (!current) return current;
        const next = { ...current, selectedProductKeys: keys, trends: Object.fromEntries(entries) };
        void saveCachedAnalytics('products', productAnalyticsCacheKey(detailFilters, requestScope, keys, comparisonMode), next, Date.now()).catch(() => {});
        const trendCacheScope = productAnalyticsCacheKey(filters, requestScope, keys, comparisonMode);
        if (trendCacheScope !== productAnalyticsCacheKey(detailFilters, requestScope, keys, comparisonMode)) {
          void saveCachedAnalytics('products', trendCacheScope, next, Date.now()).catch(() => {});
        }
        return next;
      });
      if (failed) {
        setTrendError(entries.length ? '部分产品趋势加载失败' : '产品趋势加载失败');
        showToast(entries.length ? '部分产品趋势加载失败' : '产品趋势加载失败', 'error');
      }
    } finally {
      if (!controller.signal.aborted && requestId === trendRequestIdRef.current) setTrendLoading(false);
    }
  }, [analyticsStore.comparisonModeByModule?.products, detailFilters, deviceOffline, filters, requestScope, requestStoreKeys]);

  const loadComparison = useCallback(async (keys: string[], modeOverride?: 'none' | 'previous') => {
    comparisonControllerRef.current?.abort();
    const controller = new AbortController();
    comparisonControllerRef.current = controller;
    const requestId = ++comparisonRequestIdRef.current;
    const comparisonMode = modeOverride ?? analyticsStore.comparisonModeByModule?.products ?? 'previous';
    const platformId = Number(requestScope.dimKey);
    setData((current) => current ? { ...current, comparison: null, comparisonMode } : current);
    if (comparisonMode === 'none' || deviceOffline || !keys.length) return;
    try {
      const comparison = await getOperationsProducts({
        compare: comparisonMode,
        dateFrom: detailFilters.dateFrom,
        dateTo: detailFilters.dateTo,
        granularity: detailFilters.granularity ?? 'day',
        orderChannels: requestScope.dimType === 'channel'
          ? [requestScope.dimKey as 'shop' | 'takeout']
          : detailFilters.sourceType === 'all' ? [] : [detailFilters.sourceType],
        platformIds: requestScope.dimType === 'platform' && Number.isFinite(platformId) ? [platformId] : [],
        productKeys: keys,
        signal: controller.signal,
        storeKeys: requestStoreKeys,
      });
      if (controller.signal.aborted || requestId !== comparisonRequestIdRef.current) return;
      setData((current) => {
        if (!current) return current;
        const next = { ...current, comparison, comparisonMode };
        void saveCachedAnalytics('products', productAnalyticsCacheKey(detailFilters, requestScope, keys, comparisonMode), next, Date.now()).catch(() => {});
        return next;
      });
    } catch (reason) {
      if (!controller.signal.aborted && requestId === comparisonRequestIdRef.current) {
        setData((current) => current ? { ...current, comparison: null, comparisonMode } : current);
        showToast('上期数据加载失败，已展示当前期数据', 'info');
      }
    }
  }, [analyticsStore.comparisonModeByModule?.products, detailFilters, deviceOffline, requestScope, requestStoreKeys]);

  const load = useCallback(async (forceRefresh = false) => {
    if (!selectedDetailPeriod) return;
    if (forceRefresh && forceRefreshBlocked) return;
    controllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const comparisonMode = analyticsStore.comparisonModeByModule?.products ?? 'previous';
    const cacheScope = productAnalyticsCacheKey(detailFilters, requestScope, selectedProductKeysRef.current, comparisonMode);
    if (displayedScopeRef.current !== null && displayedScopeRef.current !== cacheScope) {
      displayedScopeRef.current = null;
      hasDataRef.current = false;
      setData(null);
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
    }
    if (forceRefresh) {
      trendControllerRef.current?.abort();
      comparisonControllerRef.current?.abort();
      trendRequestIdRef.current += 1;
      comparisonRequestIdRef.current += 1;
      setTrendLoading(false);
    }
    if (forceRefresh) await clearCachedAnalytics('products', cacheScope, Date.now()).catch(() => {});
    const cached = forceRefresh
      ? null
      : await readCachedAnalytics<ProductDashboardData>('products', cacheScope, Date.now()).catch(() => null);
    if (requestId !== requestIdRef.current) return;
    if (cached?.data) {
      const legacyTrend = (cached.data as ProductDashboardData & { trend?: ProductTrendResult | null }).trend;
      const trends = cached.data.trends ?? (legacyTrend ? { [legacyTrend.product_key]: legacyTrend } : {});
      const cachedKeys = normalizeProductSelection(cached.data.ranking.top, cached.data.selectedProductKeys ?? Object.keys(trends));
      setSelectedProductKeys(cachedKeys);
      displayedScopeRef.current = cacheScope;
      hasDataRef.current = true;
      setData({ ...cached.data, comparison: cached.data.comparison ?? null, comparisonMode: cached.data.comparisonMode ?? comparisonMode, selectedProductKeys: cachedKeys, trends });
      setScope(cached.data.scope ?? requestScope);
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
      const ranking = await getProducts(detailFilters, productRequestOptions(detailFilters, requestScope, { forceRefresh, limit: 0, periodSnapshot: true, signal: controller.signal, storeKeys: requestStoreKeys }));
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      const keys = normalizeProductSelection(ranking.top, selectedProductKeysRef.current);
      selectedProductKeysRef.current = keys;
      setSelectedProductKeys(keys);
      const next = { comparison: null, comparisonMode, filters: detailFilters, ranking, selectedProductKeys: keys, scope: requestScope, trends: {} };
      hasDataRef.current = true;
      displayedScopeRef.current = productAnalyticsCacheKey(detailFilters, requestScope, keys, comparisonMode);
      setData(next);
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
      setStatus('idle');
      void loadTrends(keys, forceRefresh);
      void loadComparison(keys);
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (!forceRefresh && reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE && cached?.data) {
        setCacheOffline(true);
        setCacheLastSyncedAt(cached.lastSyncedAt);
        setStatus('idle');
        return;
      }
      if (cached?.data) {
        hasDataRef.current = false;
        displayedScopeRef.current = null;
        setData(null);
        setCacheOffline(false);
        setCacheLastSyncedAt(null);
        void clearCachedAnalytics('products', cacheScope, Date.now()).catch(() => {});
      }
      const message = reason instanceof Error ? reason.message : '产品分析加载失败，请稍后重试';
      setError(message);
      showToast(message, 'error');
      setStatus('error');
    }
  }, [analyticsStore.comparisonModeByModule?.products, detailFilters, deviceOffline, forceRefreshBlocked, loadComparison, loadTrends, requestScope, requestStoreKeys, selectedDetailPeriod, setSelectedProductKeys]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      trendRequestIdRef.current += 1;
      comparisonRequestIdRef.current += 1;
      controllerRef.current?.abort();
      trendControllerRef.current?.abort();
      comparisonControllerRef.current?.abort();
    };
  }, [load]);

  const ranking = data?.ranking;
  const rows = ranking?.top ?? [];
  const selectedProduct = rows.find((row) => row.product_key === selectedProductKeys[0]) || rows[0] || null;
  const trendProduct = requestedTrendKeys
    .map((key) => rows.find((row) => row.product_key === key))
    .find((row): row is ProductRow => Boolean(row && data?.trends[row.product_key]))
    ?? selectedProduct;
  const scopeLabel = scope.dimType === 'shop' && scopeTree.length ? scopeSelection.label : productScopeLabel(scope, stores, platforms);

  const openDetail = (row: ProductRow) => {
    useInsightDetailStore.getState().selectProduct(row, deviceOffline, requestScope);
    router.push('/analytics/products/trend' as never);
  };
  const openFullscreen = () => {
    if (!trendProduct) return;
    const selectedTrend = data?.trends[trendProduct.product_key] ?? null;
    const storeKeys = selectedAnalyticsStoreKeys(filters).sort();
    const comparisonMode = analyticsStore.comparisonModeByModule?.products ?? 'previous';
    const previousPeriod = comparisonMode === 'none' ? null : data?.comparison?.previous_period;
    useInsightDetailStore.getState().selectProduct(trendProduct, deviceOffline, requestScope, selectedTrend);
    router.push({
      pathname: '/chart',
      params: {
        cacheKey: productAnalyticsCacheKey(filters, requestScope, selectedProductKeys, comparisonMode),
        comparisonMode,
        ...(previousPeriod ? { comparisonDateFrom: previousPeriod.date_from, comparisonDateTo: previousPeriod.date_to } : {}),
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        dimKey: requestScope.dimKey,
        dimType: requestScope.dimType,
        granularity: filters.granularity ?? 'day',
        includeCurrent: String(Boolean(filters.includeCurrent)),
        productKey: trendProduct.product_key,
        selectedProductKeys: selectedProductKeys.join(','),
        productScopes: JSON.stringify(scopeSelection.scopes),
        scopeKeys: [...new Set(filters.scopeKeys ?? [])].filter(Boolean).sort().join(',') || 'ALL',
        sourceType: filters.sourceType,
        storeKeys: storeKeys.join(',') || 'ALL',
        type: 'product',
      },
    } as never);
  };
  const selectTrendProduct = (row: ProductRow) => {
    const isSelected = selectedProductKeys.includes(row.product_key);
    if (!isSelected && selectedProductKeys.length >= 5) {
      showToast('最多选择 5 款产品', 'info');
      return;
    }
    const keys = isSelected
      ? selectedProductKeys.filter((key) => key !== row.product_key)
      : [...selectedProductKeys, row.product_key];
    selectedProductKeysRef.current = keys;
    setSelectedProductKeys(keys);
    void loadTrends(keys);
    void loadComparison(keys);
  };

  return <>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View><Text style={styles.title}>产品分析</Text><Text style={styles.updated}>{statusLabel(status, offline, effectiveLastSyncedAt, filters.dateTo)}</Text></View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={[styles.iconButton, deviceOffline && styles.disabled]}><Filter color={theme.text.primary} size={20} /></Pressable>
          <Pressable accessibilityLabel="强制刷新" accessibilityRole="button" accessibilityState={{ disabled: forceRefreshBlocked }} disabled={forceRefreshBlocked} onPress={() => void load(true)} style={[styles.iconButton, forceRefreshBlocked && styles.disabled]}><RefreshCw color={theme.text.primary} size={20} /></Pressable>
        </View>
      </View>

      <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={deviceOffline} onPress={() => setFilterOpen(true)} style={[styles.filterSummary, deviceOffline && styles.disabled]}><CalendarDays color={theme.text.secondary} size={18} /><Text numberOfLines={1} style={styles.filterText}>{filters.dateFrom.slice(5)} 至 {filters.dateTo.slice(5)} · {scopeLabel}</Text></Pressable>
      <Text style={styles.definition}>{SALES_DEFINITION}</Text>

      {deviceOffline && !data ? <ScreenState state="offline" /> : null}
      {status === 'loading' && !data && !deviceOffline ? <ScreenState state="loading" /> : null}
      {status === 'error' && !data ? <ScreenState actionLabel="重新加载" onAction={() => void load()} state="error" /> : null}
      {data && rows.length === 0 ? <ScreenState state="empty" /> : null}

      {rows.length ? <>
        {selectedDetailPeriod ? <ProductDetailPeriodPicker onChange={(key) => setDetailPeriodSelection({ key, rangeKey: detailRangeKey })} options={detailPeriodOptions} selected={selectedDetailPeriod} styles={styles} /> : null}
        <ProductSummary comparison={data?.comparison ?? null} displayMode={analyticsStore.comparisonDisplayModeByModule?.products ?? 'percentage'} ranking={ranking as ProductsResult} selectedProduct={selectedProduct} styles={styles} />
        <View style={styles.comparisonControls}><PeriodComparisonControl displayMode={analyticsStore.comparisonDisplayModeByModule?.products ?? 'percentage'} mode={analyticsStore.comparisonModeByModule?.products ?? 'previous'} onDisplayModeChange={(mode) => analyticsStore.setComparisonDisplayMode?.('products', mode)} onModeChange={(mode) => { analyticsStore.setComparisonMode?.('products', mode); void loadComparison(selectedProductKeys, mode); }} />{comparisonPeriodText(data?.comparison?.previous_period) ? <Text style={styles.comparisonPeriod}>{comparisonPeriodText(data?.comparison?.previous_period)}</Text> : null}</View>
        <View style={styles.section}>
          {trendLoading ? <ScreenState state="loading" /> : <ProductTrendChart hiddenSeriesIds={hiddenSeriesByChart[PRODUCT_CHART_KEY]} model={productChartModel ?? undefined} onFullscreen={status === 'idle' ? openFullscreen : undefined} onSelectProduct={!deviceOffline && status === 'idle' ? () => setProductPickerOpen(true) : undefined} onSelectionChange={(selection) => setSelectedChartSelection?.(PRODUCT_CHART_KEY, selection)} onToggleSeries={(id) => toggleSeriesVisibility(PRODUCT_CHART_KEY, productSeriesIds, id)} points={trendProduct ? data?.trends[trendProduct.product_key]?.points ?? [] : []} productName={trendProduct?.product_name || trendProduct?.product_key || '选择产品'} selectedPeriod={selectedPeriodByChart[PRODUCT_CHART_KEY]} selectedSeriesId={selectedSeriesByChart[PRODUCT_CHART_KEY]} />}
          {trendError ? <Text style={styles.error}>{trendError}</Text> : null}
        </View>
        <View style={styles.section}>
          <View style={styles.rankingHeader}><View><Text style={styles.sectionTitle}>产品销售排名</Text><Text style={styles.sectionMeta}>按商品销额从高到低</Text></View><Text style={styles.rankingCount}>{ranking?.total ?? rows.length} 款产品</Text></View>
          <View style={styles.rankingList}>{rows.map((row, index) => <ProductRankingRow index={index} key={row.product_key} maxSales={rows[0]?.sales_amount || 0} onPress={() => openDetail(row)} row={row} styles={styles} theme={theme} />)}</View>
        </View>
      </> : null}
      {error && data ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
    <ProductFilterSheet filters={filters} onApply={(nextFilters, nextScope) => { setFilters(nextFilters); setScope(nextScope); }} onClose={() => setFilterOpen(false)} platforms={platforms} scope={scope} scopeTree={scopeTree?.length ? scopeTree : undefined} stores={stores} visible={filterOpen} />
    <ProductPicker onClose={() => setProductPickerOpen(false)} onSelect={selectTrendProduct} rows={rows} selectedKeys={selectedProductKeys} styles={styles} theme={theme} visible={productPickerOpen} />
  </>;
}

function ProductSummary({ comparison, displayMode, ranking, selectedProduct, styles }: { comparison: OperationsProducts | null; displayMode: 'percentage' | 'difference' | 'previous' | 'all'; ranking: ProductsResult; selectedProduct: ProductRow | null; styles: ReturnType<typeof createStyles> }) {
  const top = selectedProduct ?? ranking.top[0];
  const topComparison = comparison?.items.find((item) => item.product_key === top?.product_key)?.comparison?.sales_amount;
  return <View accessibilityLabel="产品经营概览" style={styles.summaryBand}>
    <View style={styles.summaryPrimary}>
      <View style={[styles.metric, styles.productCountMetric]}><Text style={styles.metricLabel}>产品数</Text><Text style={[styles.metricValue, styles.heroValue]}>{ranking.total ?? ranking.top.length}</Text><Text style={styles.metricHint}>当前筛选范围</Text></View>
      <View style={styles.metric}><Text style={styles.metricLabel}>销额 TOP1</Text><Text numberOfLines={2} style={styles.topProduct}>{top?.product_name || top?.product_key || '—'}</Text></View>
    </View>
    <View style={styles.summarySecondary}>
      <View style={[styles.metric, styles.salesMetric]}><Text style={styles.metricLabel}>TOP1 销额</Text><Text style={styles.compactValue}>{top ? formatMoney(top.sales_amount) : '—'}</Text>{comparisonDisplayItems(topComparison, displayMode).map((item) => <Text key={item.key} style={styles.metricHint}>{item.label} {item.value}</Text>)}</View>
      <View style={styles.metric}><Text style={styles.metricLabel}>销量</Text><Text style={styles.compactValue}>{top ? `${formatInteger(top.quantity)} 份` : '—'}</Text></View>
      <View style={styles.metric}><Text style={styles.metricLabel}>占比</Text><Text style={styles.compactValue}>{top ? formatShare(top.sales_share) : '—'}</Text></View>
    </View>
  </View>;
}

function ProductDetailPeriodPicker({ onChange, options, selected, styles }: {
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
          accessibilityLabel={`切换产品数据周期 ${option.label}`}
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

function ProductRankingRow({ index, maxSales, onPress, row, styles, theme }: { index: number; maxSales: number; onPress: () => void; row: ProductRow; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  const title = row.product_name || row.product_key;
  const width = `${maxSales > 0 ? Math.max(4, Math.min(100, row.sales_amount / maxSales * 100)) : 0}%` as `${number}%`;
  return <Pressable accessibilityLabel={title} accessibilityRole="button" onPress={onPress} style={styles.rankingRow} testID={`product-ranking-row-${row.product_key}`}>
    <Text style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text>
    <View style={styles.productColumn}>
      <Text numberOfLines={2} style={styles.productTitle}>{title}</Text>
      <Text style={styles.productMeta}>销量 {formatInteger(row.quantity)} · 订单 {formatInteger(row.order_count)}</Text>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width }]} /></View>
    </View>
    <View style={styles.salesColumn}><Text style={styles.rankingSales}>{formatMoney(row.sales_amount)}</Text><Text style={styles.salesLabel}>销额</Text><Text style={styles.share}>占比 {formatShare(row.sales_share)}</Text></View>
    <ChevronRight color={theme.text.muted} size={16} style={styles.chevron} />
  </Pressable>;
}

function ProductPicker({ onClose, onSelect, rows, selectedKeys, styles, theme, visible }: { onClose: () => void; onSelect: (row: ProductRow) => void; rows: ProductRow[]; selectedKeys: string[]; styles: ReturnType<typeof createStyles>; theme: AppTheme; visible: boolean }) {
  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
    <Pressable accessibilityLabel="关闭产品选择" onPress={onClose} style={styles.pickerBackdrop} />
    <View accessibilityViewIsModal style={styles.pickerSheet}>
      <View style={styles.pickerHeader}><Text style={styles.pickerTitle}>趋势产品</Text><Pressable accessibilityLabel="关闭产品选择" accessibilityRole="button" onPress={onClose} style={styles.iconButton}><X color={theme.text.primary} size={20} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.pickerContent} showsVerticalScrollIndicator={false}>{rows.map((row) => {
        const title = row.product_name || row.product_key;
        const selected = selectedKeys.includes(row.product_key);
        return <Pressable accessibilityLabel={`${selected ? '移除' : '选择'}趋势产品 ${title}`} accessibilityRole="button" accessibilityState={{ selected }} key={row.product_key} onPress={() => onSelect(row)} style={styles.pickerRow}><View style={styles.pickerCopy}><Text numberOfLines={2} style={styles.pickerName}>{title}</Text><Text style={styles.pickerSales}>{formatMoney(row.sales_amount)}</Text></View><ChevronDown color={theme.text.muted} size={16} /></Pressable>;
      })}</ScrollView>
    </View>
  </Modal>;
}

function productRequestStoreKeys(filters: AnalyticsFilters, scopedShopKeys: readonly string[]): string[] {
  const hasExplicitScope = Boolean(filters.scopeKeys?.some((key) => key && key !== 'ALL'));
  return hasExplicitScope && scopedShopKeys.length ? [...scopedShopKeys] : selectedAnalyticsStoreKeys(filters);
}

function productRequestOptions(filters: AnalyticsFilters, scope: ProductScope, options: Pick<ProductRequestOptions, 'forceRefresh' | 'limit' | 'periodSnapshot' | 'signal' | 'storeKeys'>): ProductRequestOptions {
  const storeKeys = options.storeKeys ?? selectedAnalyticsStoreKeys(filters);
  return {
    ...options,
    dimKey: scope.dimKey,
    dimType: scope.dimType,
    granularity: filters.granularity ?? 'day',
    includeCurrent: Boolean(filters.includeCurrent),
    ...(storeKeys.length ? { storeKeys } : {}),
  };
}

function statusLabel(status: Status, offline: boolean, lastSyncedAt: number | null, dateTo: string): string {
  if (offline) return `离线查看 · 上次同步 ${formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}`;
  if (status === 'force-refreshing') return '正在强制刷新';
  if (status === 'refreshing') return '正在读取最新数据';
  return `更新至 ${dateTo}`;
}

function formatMoney(value: number): string {
  return `¥ ${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function formatInteger(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function formatShare(value: number): string {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
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
    definition: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, lineHeight: 17, marginTop: 10 },
    detailPeriod: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 18, paddingTop: 14 },
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
    productCountMetric: { borderLeftWidth: 0, flex: 0.8 },
    salesMetric: { borderLeftWidth: 0, flex: 1.25 },
    metricLabel: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    metricValue: { color: theme.text.primary, fontSize: 18, fontWeight: '500', letterSpacing: 0, marginTop: 5 },
    heroValue: { color: accent, fontSize: 25 },
    metricHint: { color: theme.status.success, fontSize: 10, letterSpacing: 0, marginTop: 5 },
    topProduct: { color: theme.text.primary, fontSize: 15, fontWeight: '500', letterSpacing: 0, lineHeight: 21, marginTop: 5 },
    compactValue: { color: theme.text.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0, marginTop: 5 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 26, paddingTop: 20 },
    sectionTitle: { color: theme.text.primary, fontSize: 19, fontWeight: '500', letterSpacing: 0 },
    sectionMeta: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 },
    rankingHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
    rankingCount: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    rankingList: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12 },
    rankingRow: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 102, paddingHorizontal: 2, paddingVertical: 14 },
    rank: { color: theme.text.muted, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0, width: 32 },
    productColumn: { flex: 1, minWidth: 0 },
    productTitle: { color: theme.text.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0 },
    productMeta: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 7 },
    progressTrack: { backgroundColor: theme.background.subtle, height: 3, marginTop: 10, overflow: 'hidden', width: '100%' },
    progressFill: { backgroundColor: theme.status.info, height: 3 },
    salesColumn: { alignItems: 'flex-end', flexShrink: 0, marginLeft: 10 },
    rankingSales: { color: accent, fontSize: 17, fontWeight: '500', letterSpacing: 0 },
    salesLabel: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    share: { color: theme.status.warning, fontSize: 10, letterSpacing: 0, marginTop: 7 },
    chevron: { marginLeft: 3, marginTop: 2 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0, marginTop: 12 },
    comparisonControls: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 8, marginTop: 18, paddingTop: 16 },
    comparisonPeriod: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    pickerBackdrop: { backgroundColor: theme.overlay.scrim, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    pickerSheet: { backgroundColor: theme.background.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, bottom: 0, left: 0, maxHeight: '72%', position: 'absolute', right: 0 },
    pickerHeader: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 16 },
    pickerTitle: { color: theme.text.primary, fontSize: 18, fontWeight: '600', letterSpacing: 0 },
    pickerContent: { paddingBottom: 24, paddingHorizontal: 16 },
    pickerRow: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 64, paddingVertical: 10 },
    pickerCopy: { flex: 1, minWidth: 0 },
    pickerName: { color: theme.text.primary, fontSize: 14, letterSpacing: 0 },
    pickerSales: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 4 },
  });
}
