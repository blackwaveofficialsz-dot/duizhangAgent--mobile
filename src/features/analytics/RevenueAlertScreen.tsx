import { Filter, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenState } from '@/components/states/ScreenState';
import { getRevenueAlerts, type RevenueAlert } from '@/services/api/analytics';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { isAnalyticsSnapshotFresh } from '@/services/cache/cachePolicy';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount } from '@/utils/number';
import { AnalyticsFilterSheet } from './AnalyticsFilterSheet';
import { useAnalyticsStore } from './analyticsStore';
import { RevenueAlertChart } from './RevenueAlertChart';

type Status = 'idle' | 'loading' | 'refreshing' | 'error';

export function RevenueAlertScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { filters, setFilters, stores } = useAnalyticsStore();
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const refreshBlocked = networkStatus !== 'online';
  const [alerts, setAlerts] = useState<RevenueAlert[] | null>(null);
  const [cacheOffline, setCacheOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);
  const displayedBusinessDateRef = useRef<string | null>(null);
  const businessDate = filters.dateTo;

  const load = useCallback(async (forceRefresh = false) => {
    controllerRef.current?.abort();
    const requestId = ++requestIdRef.current;
    if (displayedBusinessDateRef.current !== null && displayedBusinessDateRef.current !== businessDate) {
      displayedBusinessDateRef.current = null;
      hasDataRef.current = false;
      setAlerts(null);
      setCacheOffline(false);
    }
    const cached = forceRefresh
      ? null
      : await readCachedAnalytics<RevenueAlert[]>('revenueAlerts', businessDate, Date.now()).catch(() => null);
    if (requestId !== requestIdRef.current) return;
    if (cached) {
      displayedBusinessDateRef.current = businessDate;
      hasDataRef.current = true;
      setAlerts(cached.data);
      setCacheOffline(deviceOffline);
      setError(null);
      setStatus('idle');
      if (deviceOffline || isAnalyticsSnapshotFresh(cached.lastSyncedAt)) return;
      setStatus('refreshing');
    }
    if (forceRefresh) await clearCachedAnalytics('revenueAlerts', businessDate).catch(() => {});
    if (requestId !== requestIdRef.current) return;
    if (deviceOffline) {
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStatus(hasDataRef.current ? 'refreshing' : 'loading');
    try {
      const next = await getRevenueAlerts(businessDate, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      displayedBusinessDateRef.current = businessDate;
      hasDataRef.current = true;
      setAlerts(next);
      setCacheOffline(false);
      setStatus('idle');
      void saveCachedAnalytics('revenueAlerts', businessDate, next, Date.now()).catch(() => {});
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (!forceRefresh && reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE && cached) {
        setCacheOffline(true);
        setStatus('idle');
        return;
      }
      if (cached) {
        hasDataRef.current = false;
        displayedBusinessDateRef.current = null;
        setAlerts(null);
        setCacheOffline(false);
        void clearCachedAnalytics('revenueAlerts', businessDate).catch(() => {});
      }
      setError(reason instanceof Error ? reason.message : '营收报警加载失败，请稍后重试');
      setStatus('error');
    }
  }, [businessDate, deviceOffline]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);

  const visibleAlerts = useMemo(
    () => (alerts ?? [])
      .filter((alert) => filters.storeKey === 'ALL' || alert.shop_key === filters.storeKey)
      .sort((left, right) => Math.abs(right.deviation_pct) - Math.abs(left.deviation_pct)),
    [alerts, filters.storeKey],
  );
  const store = filters.storeKey === 'ALL'
    ? '全部门店'
    : stores.find((item) => item.key === filters.storeKey)?.label ?? '已选门店';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>营收报警</Text>
            <Text style={styles.updated}>
              检测日 {businessDate}{cacheOffline ? ' · 离线缓存' : status === 'refreshing' ? ' · 正在刷新' : ''}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="打开筛选"
              accessibilityRole="button"
              disabled={deviceOffline}
              onPress={() => setFilterOpen(true)}
              style={[styles.iconButton, deviceOffline && styles.disabled]}
            >
              <Filter color={theme.text.primary} size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="强制刷新"
              accessibilityRole="button"
              accessibilityState={{ disabled: refreshBlocked }}
              disabled={refreshBlocked}
              onPress={() => void load(true)}
              style={[styles.iconButton, refreshBlocked && styles.disabled]}
            >
              <RefreshCw color={theme.text.primary} size={20} />
            </Pressable>
          </View>
        </View>
        <Pressable
          accessibilityLabel="打开筛选"
          accessibilityRole="button"
          disabled={deviceOffline}
          onPress={() => setFilterOpen(true)}
          style={[styles.filterSummary, deviceOffline && styles.disabled]}
        >
          <Text numberOfLines={1} style={styles.filterText}>{businessDate} · {store}</Text>
        </Pressable>
        {deviceOffline && !alerts ? <ScreenState state="offline" /> : null}
        {status === 'loading' && !alerts && !deviceOffline ? <ScreenState state="loading" /> : null}
        {status === 'error' && !alerts ? (
          <ScreenState actionLabel="重新加载" description={error ?? undefined} onAction={() => void load()} state="error" />
        ) : null}
        {alerts && visibleAlerts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>当前日期暂无营收报警</Text>
            <Text style={styles.emptyDescription}>当前检测日和门店没有超过阈值的营收偏离</Text>
          </View>
        ) : null}
        {visibleAlerts.length ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>报警偏离率</Text>
              <RevenueAlertChart alerts={visibleAlerts} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>报警列表</Text>
              {visibleAlerts.map((alert) => (
                <View key={`${alert.business_date}:${alert.shop_key}`} style={styles.alertRow} testID={`revenue-alert-row-${alert.shop_key}`}>
                  <View style={styles.alertHeader}>
                    <Text numberOfLines={2} style={styles.shopName}>{alert.shop_label || alert.shop_key}</Text>
                    <Text style={[styles.alertDirection, alert.direction === 'under' ? styles.under : styles.over]}>
                      {directionText(alert)}
                    </Text>
                  </View>
                  <View style={styles.alertMetrics}>
                    <Text style={styles.alertMetric}>实际 {formatAmount(alert.actual_amount)}</Text>
                    <Text style={styles.alertMetric}>基线 {formatAmount(alert.baseline_amount)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
        {error && alerts ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <AnalyticsFilterSheet
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
        stores={stores}
        visible={filterOpen}
      />
    </>
  );
}

function directionText(alert: RevenueAlert): string {
  return `${alert.direction === 'under' ? '偏低' : '偏高'} ${Math.abs(alert.deviation_pct * 100).toFixed(1)}%`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: { gap: 14, padding: 16 },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { color: theme.text.primary, fontSize: 24, fontWeight: '400', letterSpacing: 0 },
    updated: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 4 },
    headerActions: { flexDirection: 'row' },
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    disabled: { opacity: 0.4 },
    filterSummary: { alignSelf: 'flex-start', backgroundColor: theme.background.subtle, borderRadius: 18, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8 },
    filterText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    section: { gap: 10, marginTop: 2 },
    sectionTitle: { color: theme.text.primary, fontSize: 18, fontWeight: '400', letterSpacing: 0 },
    empty: { alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 40 },
    emptyTitle: { color: theme.text.primary, fontSize: 16, fontWeight: '500', letterSpacing: 0 },
    emptyDescription: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, textAlign: 'center' },
    alertRow: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8, paddingVertical: 13 },
    alertHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    shopName: { color: theme.text.primary, flex: 1, fontSize: 15, letterSpacing: 0, lineHeight: 21 },
    alertDirection: { fontFamily: 'monospace', fontSize: 13, letterSpacing: 0 },
    under: { color: theme.status.danger },
    over: { color: theme.status.success },
    alertMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    alertMetric: { color: theme.text.secondary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0 },
  });
}
