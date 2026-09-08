import { Download, Filter, RefreshCw } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import { ScreenState } from '@/components/states/ScreenState';
import { getOrders, type OrderRow, type OrdersResult } from '@/services/api/analytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import { getOperationsOverview, type ComparisonMode, type OperationsOverview } from '@/services/api/operationsAnalytics';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { shareWorkbook } from '@/services/files/shareWorkbook';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatBeijingDateTime } from '@/utils/time';
import { AnalyticsFilterSheet } from './AnalyticsFilterSheet';
import { orderAnalyticsCacheScope, selectedAnalyticsStoreKeys, serializeAnalyticsFilters, type AnalyticsFilters } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';
import { OrderStoreTable } from './OrderStoreTableView';
import { buildOrderStoreRows, type OrderSecondaryDimension, type OrderStoreTableRow } from './orderStoreTable';
import { comparisonPeriodText } from './periodComparison';
import { PeriodComparisonControl } from './PeriodComparisonControl';
import { buildOrderExportRows, effectiveOrderChannels, effectiveOrderSourceType, type OrderDimension } from './orderAnalytics';

type Status = 'idle' | 'loading' | 'refreshing' | 'force-refreshing' | 'error';
type OrdersCachePayload = {
  cacheContext: string;
  comparison: OperationsOverview | null;
  data: OrdersResult;
};

export function OrderInsightScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { comparisonDisplayModeByModule, comparisonModeByModule, isOffline: dashboardCacheOffline, lastSyncedAt, orderDimensions, orderFilters, setComparisonDisplayMode, setComparisonMode, setOrderDimensions, setOrderFilters, stores } = useAnalyticsStore();
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const forceRefreshBlocked = networkStatus !== 'online';
  const [data, setData] = useState<OrdersResult | null>(null);
  const [secondaryDimension, setSecondaryDimension] = useState<OrderSecondaryDimension>(() => orderSecondaryDimension(orderDimensions));
  const [comparison, setComparison] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [cacheOffline, setCacheOffline] = useState(false);
  const [cacheLastSyncedAt, setCacheLastSyncedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const controllerRef = useRef<AbortController | null>(null);
  const comparisonControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const comparisonRequestIdRef = useRef(0);
  const hasDataRef = useRef(false);
  const displayedScopeRef = useRef<string | null>(null);
  const dataOriginRef = useRef<'cache' | 'server' | null>(null);
  const cacheRequestIdRef = useRef(0);
  const cachePayloadRef = useRef<{ comparison: OperationsOverview | null; data: OrdersResult | null }>({ comparison: null, data: null });
  const offline = dashboardCacheOffline || deviceOffline || cacheOffline;
  const effectiveLastSyncedAt = cacheLastSyncedAt ?? lastSyncedAt;
  const tableDimensions = useMemo(() => orderTableDimensions(secondaryDimension), [secondaryDimension]);
  const tableFilters = useMemo(() => ({
    ...orderFilters,
    sourceType: effectiveOrderSourceType(orderFilters, tableDimensions),
  }), [orderFilters, tableDimensions]);
  const cacheScope = useMemo(() => {
    const base = orderAnalyticsCacheScope(tableFilters, comparisonModeByModule.orders);
    return secondaryDimension === 'total' ? base : base + ':secondary_dimension=' + secondaryDimension;
  }, [comparisonModeByModule.orders, secondaryDimension, tableFilters]);
  const cacheContext = useMemo(() => {
    const base = serializeAnalyticsFilters(tableFilters) + ':comparison_mode=' + comparisonModeByModule.orders;
    return secondaryDimension === 'total' ? base : base + ':secondary_dimension=' + secondaryDimension;
  }, [comparisonModeByModule.orders, secondaryDimension, tableFilters]);
  const saveCache = useCallback((next: Partial<Pick<OrdersCachePayload, 'comparison' | 'data'>>, cacheRequestId = cacheRequestIdRef.current) => {
    if (cacheRequestId !== cacheRequestIdRef.current) return;
    cachePayloadRef.current = { ...cachePayloadRef.current, ...next };
    const payload = cachePayloadRef.current;
    if (!payload.data) return;
    void saveCachedAnalytics('orders', cacheScope, { cacheContext, ...payload }, Date.now()).catch(() => {});
  }, [cacheContext, cacheScope]);

  const clearDisplayedData = useCallback(() => {
    cachePayloadRef.current = { comparison: null, data: null };
    dataOriginRef.current = null;
    displayedScopeRef.current = null;
    hasDataRef.current = false;
    setData(null);
    setComparison(null);
    setCacheOffline(false);
    setCacheLastSyncedAt(null);
  }, []);

  useEffect(() => {
    setSecondaryDimension(orderSecondaryDimension(orderDimensions));
  }, [orderDimensions]);

  const loadComparison = useCallback(async (forceRefresh = false, requestedMode?: ComparisonMode, cacheRequestId = cacheRequestIdRef.current, keepCurrent = false) => {
    comparisonControllerRef.current?.abort();
    const requestId = ++comparisonRequestIdRef.current;
    const mode = requestedMode ?? comparisonModeByModule.orders;
    if (!keepCurrent) cachePayloadRef.current.comparison = null;
    if (deviceOffline || mode === 'none') {
      setComparison(null);
      return;
    }
    const controller = new AbortController();
    comparisonControllerRef.current = controller;
    if (!keepCurrent) setComparison(null);
    try {
      const next = await getOperationsOverview({
        compare: mode,
        dateFrom: tableFilters.dateFrom,
        dateTo: tableFilters.dateTo,
        granularity: tableFilters.granularity ?? 'day',
        refresh: forceRefresh,
        signal: controller.signal,
        orderChannels: effectiveOrderChannels(tableFilters, tableDimensions),
        storeKeys: selectedAnalyticsStoreKeys(tableFilters),
      });
      if (controller.signal.aborted || requestId !== comparisonRequestIdRef.current || cacheRequestId !== cacheRequestIdRef.current) return;
      setComparison(next);
      saveCache({ comparison: next }, cacheRequestId);
    } catch {
      if (controller.signal.aborted || requestId !== comparisonRequestIdRef.current) return;
      showToast('上期数据加载失败，已展示当前期数据', 'info');
    }
  }, [comparisonModeByModule.orders, deviceOffline, saveCache, tableDimensions, tableFilters]);

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh && forceRefreshBlocked) return;
    controllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const cacheRequestId = ++cacheRequestIdRef.current;
    cachePayloadRef.current = { comparison: null, data: null };
    if (displayedScopeRef.current !== null && displayedScopeRef.current !== cacheScope) clearDisplayedData();
    let cached: { data: unknown; lastSyncedAt: number | null } | null = null;
    if (!forceRefresh) {
      cached = await readCachedAnalytics<unknown>('orders', cacheScope, Date.now()).catch(() => null);
      if (requestId !== requestIdRef.current) return;
      if (cached && isOrdersCachePayload(cached.data) && cached.data.cacheContext === cacheContext) {
        hasDataRef.current = true;
        displayedScopeRef.current = cacheScope;
        dataOriginRef.current = 'cache';
        cachePayloadRef.current = cached.data;
        setData(cached.data.data);
        setComparison(comparisonModeByModule.orders === 'none' ? null : cached.data.comparison);
        setCacheOffline(deviceOffline);
        setCacheLastSyncedAt(deviceOffline ? cached.lastSyncedAt : null);
      } else {
        cached = null;
      }
    }
    if (!forceRefresh && cached && !deviceOffline && isAnalyticsSnapshotFresh(cached.lastSyncedAt)) {
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
      setError(null);
      setStatus('idle');
      return;
    }
    if (deviceOffline) {
      comparisonControllerRef.current?.abort();
      comparisonRequestIdRef.current += 1;
      if (!cached) {
        setData(null);
        setComparison(null);
      }
      setStatus('idle');
      return;
    }
    if (forceRefresh) await clearCachedAnalytics('orders', cacheScope).catch(() => {});
    if (requestId !== requestIdRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStatus(forceRefresh ? 'force-refreshing' : hasDataRef.current ? 'refreshing' : 'loading');
    void loadComparison(forceRefresh, undefined, cacheRequestId, Boolean(cached));
    try {
      const next = await getOrders(tableFilters, { dimensions: tableDimensions, forceRefresh, signal: controller.signal });
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      hasDataRef.current = true;
      displayedScopeRef.current = cacheScope;
      dataOriginRef.current = 'server';
      setData(next);
      saveCache({ data: next }, cacheRequestId);
      setCacheOffline(false);
      setCacheLastSyncedAt(null);
      setStatus('idle');
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (!forceRefresh && reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE && cached) {
        setCacheOffline(true);
        setCacheLastSyncedAt(cached.lastSyncedAt);
        setStatus('idle');
        return;
      }
      if (dataOriginRef.current === 'cache') {
        clearDisplayedData();
        void clearCachedAnalytics('orders', cacheScope).catch(() => {});
      }
      setError(reason instanceof Error ? reason.message : '订单洞察加载失败，请稍后重试');
      setStatus('error');
    }
  }, [cacheContext, cacheScope, clearDisplayedData, comparisonModeByModule.orders, deviceOffline, forceRefreshBlocked, loadComparison, saveCache, tableDimensions, tableFilters]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      comparisonRequestIdRef.current += 1;
      comparisonControllerRef.current?.abort();
    };
  }, [load]);

  const rows = data?.rows ?? [];
  const comparisonMode = comparisonModeByModule.orders;
  const displayMode = comparisonDisplayModeByModule.orders;
  const tableRows = useMemo(
    () => buildOrderStoreRows(rows, secondaryDimension),
    [rows, secondaryDimension],
  );
  const selectSecondaryDimension = (next: OrderSecondaryDimension) => {
    setSecondaryDimension(next);
    setOrderDimensions(orderTableDimensions(next));
  };
  const download = async () => {
    if (!rows.length) {
      showToast('当前没有可导出的订单数据', 'error');
      return;
    }
    try {
      await shareWorkbook({
        fileName: `订单统计-${orderFilters.dateFrom}_${orderFilters.dateTo}.xlsx`,
        sheets: [{ name: '订单统计', rows: buildOrderExportRows(rows, { comparisonOverview: comparison, dimensions: tableDimensions }) }],
        title: '订单统计',
      });
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '订单统计导出失败', 'error');
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>订单统计</Text>
            {offline ? <Text style={styles.updated}>{offlineLabel(effectiveLastSyncedAt)}</Text> : status === 'force-refreshing' ? <Text style={styles.updated}>正在强制刷新</Text> : status === 'refreshing' ? <Text style={styles.updated}>正在读取最新数据</Text> : null}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel={controlsExpanded ? '收起筛选条件' : '展开筛选条件'}
              accessibilityRole="button"
              accessibilityState={{ expanded: controlsExpanded }}
              onPress={() => setControlsExpanded((expanded) => !expanded)}
              style={[styles.iconButton, controlsExpanded && styles.iconButtonActive]}
            ><Filter color={controlsExpanded ? theme.action.onPrimary : theme.text.primary} size={20} /></Pressable>
            <Pressable accessibilityLabel="导出订单统计" accessibilityRole="button" accessibilityState={{ disabled: !rows?.length }} disabled={!rows?.length} onPress={() => void download()} style={[styles.iconButton, !rows?.length && styles.disabled]}><Download color={theme.text.primary} size={20} /></Pressable>
            <Pressable accessibilityLabel="强制刷新" accessibilityRole="button" accessibilityState={{ disabled: forceRefreshBlocked }} disabled={forceRefreshBlocked} onPress={() => void load(true)} style={[styles.iconButton, forceRefreshBlocked && styles.disabled]}><RefreshCw color={theme.text.primary} size={20} /></Pressable>
          </View>
        </View>
        {controlsExpanded ? <>
          <FilterSummary filters={orderFilters} isOffline={deviceOffline} onPress={() => setFilterOpen(true)} stores={stores} styles={styles} />
          <OrderDisplayDimensionControl onChange={selectSecondaryDimension} styles={styles} value={secondaryDimension} />
          <PeriodComparisonControl
            displayMode={displayMode}
            mode={comparisonMode}
            onDisplayModeChange={(mode) => setComparisonDisplayMode('orders', mode)}
            onModeChange={(mode) => {
              setComparisonMode('orders', mode);
            }}
          />
          {comparisonPeriodText(comparison?.previous_period) ? <Text style={styles.comparisonPeriod}>{comparisonPeriodText(comparison?.previous_period)}</Text> : null}
        </> : null}
        {deviceOffline && !data ? <ScreenState state="offline" /> : null}
        {status === 'loading' && !data && !deviceOffline ? <ScreenState state="loading" /> : null}
        {status === 'error' && !data ? <ScreenState actionLabel="重新加载" onAction={() => void load()} state="error" /> : null}
        {data && tableRows.length === 0 ? <ScreenState state="empty" /> : null}
        {tableRows.length ? <OrderStoreTable
          comparison={comparisonMode === 'previous' ? comparison : null}
          comparisonMode={comparisonMode}
          displayMode={displayMode}
          onPressStore={(row) => {
            useInsightDetailStore.getState().selectOrder(orderRowFromTableRow(row), offline);
            router.push('/analytics/orders/detail' as never);
          }}
          rows={tableRows}
          secondaryDimension={secondaryDimension}
        /> : null}
        {error && data ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <AnalyticsFilterSheet filters={orderFilters} onApply={(filters) => {
        setOrderFilters(filters);
        setOrderDimensions(filters.orderDimensions ?? []);
        setSecondaryDimension(orderSecondaryDimension(filters.orderDimensions ?? []));
      }} onClose={() => setFilterOpen(false)} periodSelection="single" showOrderDimensions stores={stores} visible={filterOpen} />
    </>
  );
}

function isOrdersCachePayload(value: unknown): value is OrdersCachePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  const data = payload.data;
  return typeof payload.cacheContext === 'string'
    && isOrdersResult(data)
    && (payload.comparison === null || payload.comparison === undefined || isRecord(payload.comparison));
}

function isOrdersResult(value: unknown): value is OrdersResult {
  return isRecord(value) && Array.isArray(value.rows);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function OrderDisplayDimensionControl({ onChange, styles, value }: {
  onChange: (value: OrderSecondaryDimension) => void;
  styles: ReturnType<typeof createStyles>;
  value: OrderSecondaryDimension;
}) {
  return <View style={styles.dimensionControl}>
    {([
      ['total', '总计'],
      ['channel', '堂食外卖'],
      ['platform', '平台'],
    ] as const).map(([key, label]) => {
      const selected = value === key;
      return <Pressable
        accessibilityLabel={'展示维度 ' + label}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        key={key}
        onPress={() => onChange(key)}
        style={[styles.dimensionOption, selected && styles.dimensionOptionActive]}
      ><Text style={[styles.dimensionText, selected && styles.dimensionTextActive]}>{label}</Text></Pressable>;
    })}
  </View>;
}

function orderSecondaryDimension(dimensions: OrderDimension[]): OrderSecondaryDimension {
  if (dimensions.includes('platform')) return 'platform';
  if (dimensions.includes('channel')) return 'channel';
  return 'total';
}

function orderTableDimensions(value: OrderSecondaryDimension): OrderDimension[] {
  return value === 'total' ? ['shop'] : ['shop', value];
}

function orderRowFromTableRow(row: OrderStoreTableRow): OrderRow {
  return {
    avg_order_value: row.totals.avgOrderValueCent / 100,
    dim_key: row.storeKey,
    dim_label: row.storeLabel,
    income_amount: row.totals.incomeAmountCent / 100,
    net_income: row.totals.netIncomeCent / 100,
    order_count: row.totals.orderCount,
    paid_amount: row.totals.paidAmountCent / 100,
    refund_amount: row.totals.refundAmountCent / 100,
    refund_rate: row.totals.refundRate,
  };
}

function FilterSummary({ filters, isOffline, onPress, stores, styles }: { filters: AnalyticsFilters; isOffline: boolean; onPress: () => void; stores: Array<{ key: string; label: string }>; styles: ReturnType<typeof createStyles> }) {
  const source = filters.sourceType === 'all' ? '全部来源' : filters.sourceType === 'shop' ? '堂食' : '外卖';
  const store = filters.storeKey === 'ALL' ? '全部门店' : stores.find((item) => item.key === filters.storeKey)?.label ?? '已选门店';
  return <Pressable accessibilityLabel="打开筛选" accessibilityRole="button" disabled={isOffline} onPress={onPress} style={[styles.filterSummary, isOffline && styles.disabled]}>
    <Text numberOfLines={1} style={styles.filterText}>{filters.dateFrom} 至 {filters.dateTo} · {store} · {source}</Text>
  </Pressable>;
}

function offlineLabel(lastSyncedAt: number | null): string {
  return `离线查看 · 上次同步 ${formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: { gap: 10, padding: 14 },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    title: { color: theme.text.primary, fontSize: 20, fontWeight: '400', letterSpacing: 0 },
    updated: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 2 },
    headerActions: { flexDirection: 'row' },
    iconButton: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
    iconButtonActive: { backgroundColor: theme.action.primary },
    disabled: { opacity: 0.4 },
    filterSummary: { alignSelf: 'stretch', backgroundColor: theme.background.subtle, borderRadius: 8, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 7 },
    filterText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    dimensionControl: { flexDirection: 'row', gap: 6 },
    dimensionOption: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, height: 34, justifyContent: 'center' },
    dimensionOptionActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    dimensionText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    dimensionTextActive: { color: theme.action.onPrimary, fontWeight: '600' },
    comparisonPeriod: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0 },
  });
}
