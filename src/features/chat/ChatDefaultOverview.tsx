import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { selectedAnalyticsStoreKeys } from '@/features/analytics/analyticsFilters';
import { createOrderAnalyticsFilters } from '@/features/analytics/orderAnalytics';
import { getOrders, getRevenueAlerts, type OrderRow, type RevenueAlert } from '@/services/api/analytics';
import { getOperationsOverview, type MetricComparison, type OperationsOverview } from '@/services/api/operationsAnalytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatCount } from '@/utils/number';

type Props = {
  onOpenAlerts?: () => void;
  onOpenOrders?: () => void;
  onPrompt?: (message: string) => Promise<void>;
  promptDisabled?: boolean;
};

type LoadState = {
  alerts: RevenueAlert[];
  businessDate: string;
  dataStatus: DataStatus;
  loading: boolean;
  summary: Summary | null;
};

type DataStatus = 'missing' | 'synced' | 'unknown';

type Summary = {
  avgOrderValue: number;
  avgOrderValueChange: number | null;
  netIncome: number;
  netIncomeChange: number | null;
  orderCount: number;
  orderCountChange: number | null;
};

const QUICK_QUESTIONS = ['各门店昨日销售', '本周营收趋势', '门店人效排名', '查看产品表现'];

const wholeCurrencyFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const amountCurrencyFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function ChatDefaultOverview({ onOpenAlerts, onOpenOrders, onPrompt, promptDisabled = false }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<LoadState>(() => createInitialState());
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const visibleAlerts = useMemo(() => topAlerts(state.alerts, 2), [state.alerts]);

  const refreshOverview = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const filters = createOrderAnalyticsFilters();
    setState((current) => ({
      ...current,
      businessDate: filters.dateTo,
      dataStatus: current.businessDate === filters.dateTo ? current.dataStatus : 'unknown',
      loading: true,
    }));
    void loadOverview(filters, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
  }, []);

  useEffect(() => {
    refreshOverview();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshOverview();
    });
    return () => {
      controllerRef.current?.abort();
      subscription.remove();
    };
  }, [refreshOverview]);

  const sendQuestion = async (question: string) => {
    if (!onPrompt || promptDisabled || pendingPrompt) return;
    setPendingPrompt(question);
    try {
      await onPrompt(question);
    } finally {
      setPendingPrompt(null);
    }
  };

  return (
    <View style={styles.container} testID="chat-default-overview">
      <Text style={styles.date}>{displayDate(state.businessDate)}</Text>
      <Text style={styles.heading}>今天想看什么？</Text>

      <View style={styles.summaryCard}>
        <View style={styles.cardHeader}>
	          <View style={styles.cardCopy}>
	            <Text style={styles.eyebrow}>昨日经营摘要</Text>
	            <Text style={styles.dataStatus}>{dataStatusText(state.businessDate, state.dataStatus, state.loading)}</Text>
	            {state.loading ? (
	              <View style={styles.loadingLine}>
                <ActivityIndicator color={theme.action.primary} size="small" />
                <Text style={styles.cardTitle}>正在加载经营数据</Text>
              </View>
            ) : state.summary ? (
              <Text style={styles.cardTitle}>{summaryTitle(visibleAlerts.length)}</Text>
            ) : (
              <Text accessibilityRole="alert" style={styles.cardTitle}>经营摘要暂不可用</Text>
            )}
          </View>
          <Pressable
            accessibilityLabel="查看昨日经营详情"
            accessibilityRole="button"
            onPress={onOpenOrders}
            style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
          >
            <Text style={styles.linkText}>查看详情</Text>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Metric
            change={state.summary?.netIncomeChange ?? null}
            label="净实收"
            styles={styles}
            value={state.summary ? `¥${wholeCurrencyFormatter.format(state.summary.netIncome)}` : '—'}
          />
          <Metric
            change={state.summary?.orderCountChange ?? null}
            label="订单"
            styles={styles}
            value={state.summary ? formatCount(state.summary.orderCount) : '—'}
          />
          <Metric
            change={state.summary?.avgOrderValueChange ?? null}
            label="客单价"
            styles={styles}
            value={state.summary ? `¥${amountCurrencyFormatter.format(state.summary.avgOrderValue)}` : '—'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>待关注</Text>
          <Text style={styles.sectionMeta}>{visibleAlerts.length} 项</Text>
        </View>
        {visibleAlerts.length ? visibleAlerts.map((alert) => (
          <Pressable
            accessibilityLabel={`查看${alertTitle(alert)}`}
            accessibilityRole="button"
            key={`${alert.business_date}:${alert.shop_key}`}
            onPress={onOpenAlerts}
            style={({ pressed }) => [styles.alertRow, pressed && styles.pressed]}
          >
            <View style={[styles.alertBar, alert.direction === 'under' ? styles.alertDanger : styles.alertWarning]} />
            <View style={styles.alertCopy}>
              <Text numberOfLines={1} style={styles.alertTitle}>{alertTitle(alert)}</Text>
              <Text numberOfLines={1} style={styles.alertDescription}>{alertDescription(alert)}</Text>
            </View>
            <Text style={styles.linkText}>查看</Text>
          </Pressable>
        )) : (
          <View style={styles.emptyAlerts}>
            <Text style={styles.alertDescription}>{state.loading ? '正在加载待关注事项' : '暂无重点关注'}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>常用问题</Text>
        <View style={styles.questionGrid}>
          {QUICK_QUESTIONS.map((question) => {
            const disabled = promptDisabled || !onPrompt || pendingPrompt !== null;
            return (
              <Pressable
                accessibilityLabel={question}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                key={question}
                onPress={() => void sendQuestion(question)}
                style={({ pressed }) => [styles.questionButton, disabled && styles.disabled, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={styles.questionText}>{question}</Text>
                {pendingPrompt === question ? <ActivityIndicator color={theme.action.primary} size="small" /> : <ChevronRight color={theme.text.muted} size={16} />}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function Metric({ change, label, styles, value }: { change: number | null; label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
      {change === null ? <Text style={styles.metricPlaceholder}>—</Text> : (
        <Text style={[styles.metricChange, change < 0 ? styles.changeDanger : styles.changeSuccess]}>
          {formatSignedPercent(change)}
        </Text>
      )}
    </View>
  );
	}

function createInitialState(filters = createOrderAnalyticsFilters()): LoadState {
  return {
    alerts: [],
    businessDate: filters.dateTo,
    dataStatus: 'unknown',
    loading: true,
    summary: null,
  };
}

async function loadOverview(filters: ReturnType<typeof createOrderAnalyticsFilters>, signal: AbortSignal): Promise<LoadState> {
  const [ordersResult, overviewResult, alertsResult] = await Promise.allSettled([
    getOrders(filters, { dimensions: [], signal }),
    getOperationsOverview({
      compare: 'previous',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      granularity: filters.granularity ?? 'day',
      orderChannels: [],
      signal,
      storeKeys: selectedAnalyticsStoreKeys(filters),
    }),
    getRevenueAlerts(filters.dateTo, { signal }),
  ]);

  const orders = ordersResult.status === 'fulfilled' ? ordersResult.value : null;
  const row = orders ? totalOrderRow(orders.rows) : null;
  const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
  const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];
  return {
    alerts,
    businessDate: filters.dateTo,
    dataStatus: dataStatusFromSnapshot(orders?.snapshot_status, Boolean(row)),
    loading: false,
    summary: row ? buildSummary(row, overview) : null,
  };
}

function totalOrderRow(rows: OrderRow[]): OrderRow | null {
  return rows.find((row) => row.dim_key === 'ALL' || row.dim_key === 'all') ?? rows[0] ?? null;
}

function buildSummary(row: OrderRow, overview: OperationsOverview | null): Summary {
  return {
    avgOrderValue: row.avg_order_value,
    avgOrderValueChange: metricChange(overview?.metrics.avg_order_value),
    netIncome: row.net_income,
    netIncomeChange: metricChange(overview?.metrics.net_income ?? overview?.metrics.revenue),
    orderCount: row.order_count,
    orderCountChange: metricChange(overview?.metrics.order_count),
  };
}

function metricChange(metric: MetricComparison | undefined): number | null {
  return typeof metric?.change_rate === 'number' ? metric.change_rate : null;
}

function topAlerts(alerts: RevenueAlert[], limit: number): RevenueAlert[] {
  return [...alerts]
    .sort((left, right) => Math.abs(right.deviation_pct) - Math.abs(left.deviation_pct))
    .slice(0, limit);
}

function summaryTitle(alertCount: number): string {
  return alertCount ? `整体平稳，${alertCount} 家门店需关注` : '整体平稳，暂无门店需关注';
}

function alertTitle(alert: RevenueAlert): string {
  const store = alert.shop_label || alert.shop_key;
  const reason = (alert.reason_hints ?? []).join(' ');
  if (/同步|处理中|延迟/.test(reason)) return `${store}同步延迟`;
  return `${store}净实收${alert.direction === 'under' ? '偏低' : '偏高'}`;
}

function alertDescription(alert: RevenueAlert): string {
  const [reason] = alert.reason_hints ?? [];
  if (reason) return reason;
  const direction = alert.direction === 'under' ? '偏低' : '偏高';
  return `较基线${direction} ${Math.abs(alert.deviation_pct * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function dataStatusFromSnapshot(snapshotStatus: string | undefined, hasSummary: boolean): DataStatus {
  const normalized = snapshotStatus?.toLowerCase();
  if (normalized === 'missing' || normalized === 'partial' || normalized === 'incomplete') return 'missing';
  return hasSummary ? 'synced' : 'unknown';
}

function dataStatusText(dateText: string, dataStatus: DataStatus, loading: boolean): string {
  const statusText = loading
    ? '刷新中'
    : dataStatus === 'missing'
      ? '未完整'
      : dataStatus === 'synced'
        ? '已同步'
        : '待确认';
  return `更新时间 ${compactDate(dateText)} · 完整度 ${statusText}`;
}

function compactDate(dateText: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return dateText;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function displayDate(dateText: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return dateText;
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    alertBar: {
      borderRadius: 2,
      height: 35,
      width: 5,
    },
    alertCopy: {
      flex: 1,
      minWidth: 0,
    },
    alertDanger: {
      backgroundColor: theme.status.danger,
    },
    alertDescription: {
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0,
      marginTop: 4,
    },
    alertRow: {
      alignItems: 'center',
      borderTopColor: theme.border.default,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      minHeight: 58,
      paddingVertical: 10,
    },
    alertTitle: {
      color: theme.text.primary,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0,
    },
    alertWarning: {
      backgroundColor: theme.status.warning,
    },
    cardCopy: {
      flex: 1,
      minWidth: 0,
    },
    cardHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'space-between',
    },
	    cardTitle: {
	      color: theme.text.primary,
	      fontSize: 15,
	      fontWeight: '700',
	      letterSpacing: 0,
	      lineHeight: 21,
	      marginTop: 3,
	    },
    changeDanger: {
      color: theme.status.danger,
    },
    changeSuccess: {
      color: theme.status.success,
    },
	    container: {
	      gap: 18,
	      paddingBottom: 8,
	    },
	    dataStatus: {
	      color: theme.text.muted,
	      fontSize: 11,
	      letterSpacing: 0,
	      marginTop: 3,
	    },
    date: {
      color: theme.text.muted,
      fontSize: 13,
      letterSpacing: 0,
    },
    disabled: {
      opacity: 0.46,
    },
    emptyAlerts: {
      borderTopColor: theme.border.default,
      borderTopWidth: StyleSheet.hairlineWidth,
      minHeight: 52,
      justifyContent: 'center',
    },
    eyebrow: {
      color: theme.text.muted,
      fontSize: 13,
      letterSpacing: 0,
    },
	    heading: {
	      color: theme.text.primary,
	      fontSize: 24,
	      fontWeight: '700',
	      letterSpacing: 0,
	      marginTop: -12,
	    },
    linkButton: {
      alignItems: 'center',
      borderRadius: 8,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    linkText: {
      color: theme.action.primary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0,
    },
    loadingLine: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
	    metric: {
	      borderTopColor: theme.border.default,
	      borderTopWidth: StyleSheet.hairlineWidth,
	      flex: 1,
	      minWidth: 0,
	      paddingTop: 10,
	    },
    metricChange: {
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0,
      marginTop: 4,
    },
    metricLabel: {
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0,
    },
    metricPlaceholder: {
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0,
      marginTop: 4,
    },
	    metricValue: {
	      color: theme.text.primary,
	      fontFamily: 'monospace',
	      fontSize: 17,
	      fontWeight: '700',
	      letterSpacing: 0,
	      marginTop: 5,
	    },
	    metrics: {
	      flexDirection: 'row',
	      gap: 12,
	      marginTop: 11,
    },
    pressed: {
      opacity: 0.62,
    },
    questionButton: {
      alignItems: 'center',
      backgroundColor: theme.background.surface,
      borderColor: theme.border.default,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: 12,
      width: '48%',
    },
    questionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    questionText: {
      color: theme.text.primary,
      flex: 1,
      fontSize: 13,
      letterSpacing: 0,
    },
	    section: {
	      gap: 8,
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sectionMeta: {
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0,
    },
    sectionTitle: {
      color: theme.text.primary,
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: 0,
    },
	    summaryCard: {
	      backgroundColor: theme.background.surface,
	      borderColor: theme.border.default,
	      borderRadius: 8,
	      borderWidth: StyleSheet.hairlineWidth,
	      padding: 12,
	    },
  });
}
