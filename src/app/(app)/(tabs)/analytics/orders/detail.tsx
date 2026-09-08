import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenState } from '@/components/states/ScreenState';
import { RevenueTrendChart } from '@/features/analytics/RevenueTrendChart';
import { serializeAnalyticsFilters, type AnalyticsFilters } from '@/features/analytics/analyticsFilters';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { OrderPeriodTableView } from '@/features/analytics/OrderPeriodTableView';
import { buildOrderDetailTrendModel, buildOrderDetailTrendSeries } from '@/features/analytics/orderDetailTrend';
import { buildOrderSnapshotPeriodRows, type OrderPeriodRow, type OrderStoreMetrics } from '@/features/analytics/orderStoreTable';
import { TrendPeriodControls } from '@/features/analytics/TrendPeriodControls';
import { getOrderPeriodSnapshotRecords, getRevenueTrend, readCachedOrderPeriodSnapshotRecords, type OrderPeriodSnapshotRecord, type OrderRow, type RevenueTrendPoint, type RevenueTrendResult } from '@/services/api/analytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { amountToCents, formatAmount, formatCount, formatPercent } from '@/utils/number';
import { beijingToday } from '@/utils/time';

type DetailMode = 'trend' | 'table';
const DETAIL_PERIOD_COUNT = 5;

export default function OrderDetailRoute() {
  const row = useInsightDetailStore((state) => state.order);
  const isReadOnly = useInsightDetailStore((state) => state.isReadOnly);
  const { orderFilters } = useAnalyticsStore();
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const today = beijingToday();
  const baseFilters = useMemo(() => detailFiltersForStore(orderFilters, row?.dim_key, today), [orderFilters, row?.dim_key, today]);
  const [filters, setFilters] = useState(baseFilters);
  const [mode, setMode] = useState<DetailMode>('trend');
  const [periodRecords, setPeriodRecords] = useState<OrderPeriodSnapshotRecord[] | null>(null);
  const [trend, setTrend] = useState<RevenueTrendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [cacheOffline, setCacheOffline] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const trendCacheScope = useMemo(() => orderDetailTrendCacheScope(filters), [filters]);
  const granularity = filters.granularity ?? 'day';

  useEffect(() => {
    setFilters(baseFilters);
  }, [baseFilters]);

  useEffect(() => {
    if (!row) return;
    const controller = new AbortController();
    const useCacheOnly = deviceOffline || isReadOnly;
    const loadCachedDetailSource = async (markOffline = useCacheOnly): Promise<boolean> => {
      const cached = await readCachedOrderPeriodSnapshotRecords(filters, { dimensions: ['shop'], signal: controller.signal }).catch(() => []);
      if (controller.signal.aborted || cached.length === 0) return false;
      setPeriodRecords(cached);
      setCacheOffline(markOffline);
      return true;
    };
    const loadCachedTrend = async (markOffline = useCacheOnly): Promise<RevenueTrendResult | null> => {
      const cached = await readCachedAnalytics<RevenueTrendResult>('revenue', trendCacheScope, Date.now()).catch(() => null);
      if (controller.signal.aborted || !cached || !isRevenueTrendResult(cached.data)) return null;
      setTrend(cached.data);
      setCacheOffline(markOffline);
      return cached.data;
    };
    const load = async () => {
      setError(null);
      setCacheOffline(false);
      setPeriodRecords(null);
      const [cachedDetail, cachedTrend] = await Promise.all([loadCachedDetailSource(), loadCachedTrend()]);
      if (useCacheOnly) {
        if (!cachedDetail) setPeriodRecords(null);
        if (!cachedTrend) setTrend(null);
        if (!controller.signal.aborted) setLoading(false);
        return;
      }
      if (!cachedTrend) setTrend(null);
      setLoading(!(cachedDetail || cachedTrend));
      const shouldLoadPeriodSnapshots = mode === 'trend';
      let snapshotLoaded = cachedDetail;
      let snapshotError: unknown = null;
      const snapshotPromise = shouldLoadPeriodSnapshots
        ? getOrderPeriodSnapshotRecords(filters, { dimensions: ['shop'], signal: controller.signal })
          .then((next) => {
            if (controller.signal.aborted) return null;
            snapshotLoaded = true;
            setPeriodRecords(next);
            setCacheOffline(false);
            return next;
          })
          .catch((reason) => {
            snapshotError = reason;
            return null;
          })
        : Promise.resolve(null);
      try {
        const trendResult = await getRevenueTrend(filters, { preferServerCache: true, signal: controller.signal });
        if (controller.signal.aborted) return;
        setTrend(trendResult);
        setError(null);
        void saveCachedAnalytics('revenue', trendCacheScope, trendResult, Date.now()).catch(() => undefined);
      } catch (reason) {
        if (controller.signal.aborted) return;
        await snapshotPromise;
        if (controller.signal.aborted) return;
        if (!snapshotLoaded && !cachedDetail && !cachedTrend) {
          const fallbackReason = snapshotError ?? reason;
          setError(fallbackReason instanceof Error ? fallbackReason.message : '订单趋势加载失败，请稍后重试');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [deviceOffline, filters, isReadOnly, reloadVersion, row, trendCacheScope]);

  useEffect(() => {
    if (!row || mode !== 'table') return;
    const controller = new AbortController();
    const useCacheOnly = deviceOffline || isReadOnly;
    if (periodRecords !== null) {
      setDetailError(null);
      setDetailLoading(false);
      return () => controller.abort();
    }
    const loadCachedTable = async (markOffline = useCacheOnly): Promise<boolean> => {
      const cached = await readCachedOrderPeriodSnapshotRecords(filters, { dimensions: ['shop'], signal: controller.signal }).catch(() => []);
      if (controller.signal.aborted || cached.length === 0) return false;
      setPeriodRecords(cached);
      setCacheOffline(markOffline);
      return true;
    };
    const load = async () => {
      setDetailError(null);
      const restored = await loadCachedTable();
      if (useCacheOnly) {
        if (!restored) setPeriodRecords(null);
        if (!controller.signal.aborted) setDetailLoading(false);
        return;
      }
      setDetailLoading(!restored);
      try {
        const next = await getOrderPeriodSnapshotRecords(filters, { dimensions: ['shop'], signal: controller.signal });
        if (controller.signal.aborted) return;
        setPeriodRecords(next);
        setCacheOffline(false);
      } catch (reason) {
        if (controller.signal.aborted) return;
        const restoredAfterNetwork = reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE
          ? await loadCachedTable(true)
          : restored;
        if (!restoredAfterNetwork) setDetailError(reason instanceof Error ? reason.message : '订单明细加载失败，请稍后重试');
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [deviceOffline, filters, isReadOnly, mode, periodRecords, reloadVersion, row]);

  const periods = useMemo(() => (
    row ? buildOrderSnapshotPeriodRows(periodRecords ?? [], row.dim_key, granularity, filters.dateFrom, filters.dateTo) : []
  ), [filters.dateFrom, filters.dateTo, granularity, periodRecords, row]);
  const hasPeriodData = periodRecords !== null;
  const summaryMetrics = useMemo(
    () => hasPeriodData && periods.length ? summarizeOrderPeriods(periods) : row ? metricsFromOrderRow(row) : null,
    [hasPeriodData, periods, row],
  );
  const fallbackTrendModel = useMemo(
    () => buildOrderDetailTrendModel(periods, granularity),
    [granularity, periods],
  );
  const serverTrendPoints = trend?.points ?? [];
  const useServerTrend = hasRenderableTrendPoints(serverTrendPoints);
  const trendPoints = useServerTrend ? serverTrendPoints : fallbackTrendModel.points;
  const trendSeries = useServerTrend
    ? buildOrderDetailTrendSeries(serverTrendPoints, granularity, trend?.moving_averages)
    : fallbackTrendModel.series;
  const canShowTrend = useServerTrend || hasPeriodData;
  const cacheOnly = deviceOffline || isReadOnly || cacheOffline;

  return <SafeAreaView edges={['left', 'right']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {row ? <>
        <View>
          <Text style={styles.name}>{row.dim_label || row.dim_key}</Text>
          <Text style={styles.period}>{filters.dateFrom} 至 {filters.dateTo}</Text>
        </View>
        {summaryMetrics ? <View style={styles.summaryBand}>
          <Metric label="订单数" styles={styles} value={formatCount(summaryMetrics.orderCount)} />
          <Metric label="净实收" styles={styles} value={formatAmount(summaryMetrics.netIncomeCent / 100)} />
          <Metric label="客单价" styles={styles} value={formatAmount(summaryMetrics.avgOrderValueCent / 100)} />
          <Metric label="退款率" styles={styles} value={formatPercent(summaryMetrics.refundRate)} />
        </View> : null}
        <TrendPeriodControls filters={filters} onChange={setFilters} today={today} />
        <View accessibilityLabel="订单详情类型" style={styles.tabs}>
          <DetailTab active={mode === 'trend'} label="趋势图" onPress={() => setMode('trend')} styles={styles} />
          <DetailTab active={mode === 'table'} label="详细数据" onPress={() => setMode('table')} styles={styles} />
        </View>
        {loading && !canShowTrend ? <ScreenState state="loading" /> : null}
        {!loading && !canShowTrend && cacheOnly ? <ScreenState state="offline" /> : null}
        {error && !canShowTrend ? <ScreenState actionLabel="重试" onAction={() => setReloadVersion((value) => value + 1)} state="error" /> : null}
        {cacheOffline && hasPeriodData ? <Text style={styles.note}>离线数据</Text> : null}
        {error && canShowTrend ? <Text style={styles.error}>{error}</Text> : null}
        {canShowTrend && trendPoints.length > 0 && mode === 'trend' ? <RevenueTrendChart metricLabel="净实收" points={trendPoints} series={trendSeries} testIDPrefix="order-detail" title="净实收趋势" /> : null}
        {mode === 'table' && detailLoading && !hasPeriodData ? <ScreenState state="loading" /> : null}
        {mode === 'table' && detailError && !hasPeriodData ? <ScreenState actionLabel="重试" onAction={() => setReloadVersion((value) => value + 1)} state="error" /> : null}
        {mode === 'table' && detailError && hasPeriodData ? <Text style={styles.error}>{detailError}</Text> : null}
        {mode === 'table' && hasPeriodData ? <OrderPeriodTableView rows={periods} /> : null}
      </> : <ScreenState state="empty" />}
    </ScrollView>
  </SafeAreaView>;
}

function detailFiltersForStore(filters: AnalyticsFilters, storeKey?: string, today = beijingToday()): AnalyticsFilters {
  const scoped = storeKey ? { ...filters, storeKey, storeKeys: [storeKey] } : filters;
  return expandSinglePeriodDetailRange(scoped, today);
}

function orderDetailTrendCacheScope(filters: AnalyticsFilters): string {
  return `order-detail-revenue-v1:${serializeAnalyticsFilters(filters)}`;
}

function summarizeOrderPeriods(periods: OrderPeriodRow[]): OrderStoreMetrics {
  return periods.reduce((total, period) => addOrderMetrics(total, period.metrics), emptyOrderMetrics());
}

function isRevenueTrendResult(value: unknown): value is RevenueTrendResult {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as RevenueTrendResult).points));
}

function hasRenderableTrendPoints(points: RevenueTrendPoint[]): boolean {
  return points.some((point) => !point.missing && Number.isFinite(Number(point.net_income)));
}


function metricsFromOrderRow(row: OrderRow): OrderStoreMetrics {
  const orderCount = Math.round(Number(row.order_count || 0));
  const netIncomeCent = amountToCents(row.net_income);
  const paidAmountCent = amountToCents(row.paid_amount);
  const refundAmountCent = amountToCents(row.refund_amount);
  const incomeAmountCent = amountToCents(row.income_amount ?? (row.net_income + (row.refund_amount ?? 0)));
  return {
    avgOrderValueCent: amountToCents(row.avg_order_value),
    incomeAmountCent,
    netIncomeCent,
    orderCount,
    paidAmountCent,
    refundAmountCent,
    refundRate: row.refund_rate,
  };
}

function emptyOrderMetrics(): OrderStoreMetrics {
  return {
    avgOrderValueCent: 0,
    incomeAmountCent: 0,
    netIncomeCent: 0,
    orderCount: 0,
    paidAmountCent: 0,
    refundAmountCent: 0,
    refundRate: 0,
  };
}

function addOrderMetrics(left: OrderStoreMetrics, right: OrderStoreMetrics): OrderStoreMetrics {
  const orderCount = left.orderCount + right.orderCount;
  const netIncomeCent = left.netIncomeCent + right.netIncomeCent;
  const paidAmountCent = left.paidAmountCent + right.paidAmountCent;
  const refundAmountCent = left.refundAmountCent + right.refundAmountCent;
  return {
    avgOrderValueCent: orderCount > 0 ? Math.round(netIncomeCent / orderCount) : 0,
    incomeAmountCent: left.incomeAmountCent + right.incomeAmountCent,
    netIncomeCent,
    orderCount,
    paidAmountCent,
    refundAmountCent,
    refundRate: paidAmountCent > 0 ? refundAmountCent / paidAmountCent : weightedRefundRate(left, right, orderCount),
  };
}

function weightedRefundRate(left: OrderStoreMetrics, right: OrderStoreMetrics, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return (left.refundRate * left.orderCount + right.refundRate * right.orderCount) / orderCount;
}

function expandSinglePeriodDetailRange(filters: AnalyticsFilters, today: string): AnalyticsFilters {
  const granularity = filters.granularity ?? 'day';
  if (!isSinglePeriodRange(filters.dateFrom, filters.dateTo, granularity)) return filters;
  const latestComplete = shiftDate(today, -1);
  const anchorEnd = filters.dateTo > latestComplete ? latestComplete : filters.dateTo;
  if (granularity === 'day') {
    return {
      ...filters,
      dateFrom: shiftDate(anchorEnd, -(DETAIL_PERIOD_COUNT - 1)),
      dateTo: anchorEnd,
      includeCurrent: false,
    };
  }
  if (granularity === 'week') {
    return {
      ...filters,
      dateFrom: shiftDate(startOfIsoWeek(anchorEnd), -7 * (DETAIL_PERIOD_COUNT - 1)),
      dateTo: anchorEnd,
    };
  }
  return {
    ...filters,
    dateFrom: shiftMonth(startOfMonth(anchorEnd), -(DETAIL_PERIOD_COUNT - 1)),
    dateTo: anchorEnd,
  };
}

function isSinglePeriodRange(dateFrom: string, dateTo: string, granularity: string): boolean {
  if (!isValidDate(dateFrom) || !isValidDate(dateTo) || dateFrom > dateTo) return false;
  if (granularity === 'day') return dateFrom === dateTo;
  if (granularity === 'week') return startOfIsoWeek(dateFrom) === startOfIsoWeek(dateTo);
  if (granularity === 'month') return dateFrom.slice(0, 7) === dateTo.slice(0, 7);
  return false;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDate(value).getTime());
}

function shiftDate(dateText: string, days: number): string {
  const date = parseDate(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function shiftMonth(dateText: string, months: number): string {
  const date = parseDate(dateText);
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}

function startOfIsoWeek(dateText: string): string {
  const date = parseDate(dateText);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatDate(date);
}

function startOfMonth(dateText: string): string {
  const date = parseDate(dateText);
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function parseDate(value: string): Date {
  return new Date(value + 'T00:00:00Z');
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function DetailTab({ active, label, onPress, styles }: { active: boolean; label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </Pressable>;
}

function Metric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={styles.metric}><Text style={styles.label}>{label}</Text><Text numberOfLines={1} style={styles.value}>{value}</Text></View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.background.canvas, flex: 1 },
    content: { gap: 12, padding: 14, paddingBottom: 36 },
    name: { color: theme.text.primary, fontSize: 20, fontWeight: '500', letterSpacing: 0, lineHeight: 29 },
    period: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 3 },
    summaryBand: { borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', overflow: 'hidden' },
    metric: { borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, flex: 1, minWidth: 0, padding: 9 },
    label: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0 },
    value: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 13, letterSpacing: 0, marginTop: 3 },
    tabs: { borderColor: theme.border.strong, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', overflow: 'hidden' },
    tab: { alignItems: 'center', flex: 1, height: 38, justifyContent: 'center' },
    tabActive: { backgroundColor: theme.background.surface },
    tabText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    tabTextActive: { color: theme.text.primary, fontWeight: '600' },
    note: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0 },
  });
}
