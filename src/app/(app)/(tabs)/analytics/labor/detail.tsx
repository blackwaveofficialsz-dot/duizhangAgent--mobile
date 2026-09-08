import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenState } from '@/components/states/ScreenState';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { getLaborDetail, type LaborDetailResult, type LaborEmployeeDetail, type LaborRow } from '@/services/api/analytics';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, formatCount } from '@/utils/number';

type DetailMode = 'labor' | 'revenue';
type RevenueDay = LaborDetailResult['revenue']['daily'][number];

export default function LaborDetailRoute() {
  const row = useInsightDetailStore((state) => state.labor);
  const { filters } = useAnalyticsStore();
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [detail, setDetail] = useState<LaborDetailResult | null>(null);
  const [mode, setMode] = useState<DetailMode>('labor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row || deviceOffline) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getLaborDetail(row.store_key, filters, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setDetail(next); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '人效详情加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deviceOffline, filters, row]);

  return <SafeAreaView edges={['left', 'right']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {row ? <>
        <View>
          <Text style={styles.name}>{detail?.store_label || row.store_label || row.store_key}</Text>
          <Text style={styles.period}>{filters.dateFrom} 至 {filters.dateTo}</Text>
        </View>

        <View accessibilityLabel="人效详情类型" style={styles.tabs}>
          <DetailTab active={mode === 'labor'} label="工时明细" onPress={() => setMode('labor')} styles={styles} />
          <DetailTab active={mode === 'revenue'} label="净实收明细" onPress={() => setMode('revenue')} styles={styles} />
        </View>

        {loading ? <ScreenState state="loading" /> : null}
        {deviceOffline && !detail ? <Text style={styles.note}>离线状态下仅显示已加载汇总</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {mode === 'labor'
          ? <LaborDetailContent detail={detail} row={row} styles={styles} />
          : <RevenueDetailContent detail={detail} row={row} styles={styles} />}
      </> : <ScreenState state="empty" />}
    </ScrollView>
  </SafeAreaView>;
}

function DetailTab({ active, label, onPress, styles }: { active: boolean; label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

function LaborDetailContent({ detail, row, styles }: { detail: LaborDetailResult | null; row: LaborRow; styles: ReturnType<typeof createStyles> }) {
  const labor = detail?.labor;
  return <>
    <View style={styles.summaryBand}>
      <SummaryMetric label="排班工时" styles={styles} value={`${formatAmount(labor?.planned_hours ?? row.planned_hours)}h`} />
      <SummaryMetric label="实际工时" styles={styles} value={`${formatAmount(labor?.actual_hours ?? row.actual_hours)}h`} />
      <SummaryMetric label="工时差" styles={styles} value={`${formatAmount(labor?.hours_gap ?? row.hours_gap)}h`} />
      <SummaryMetric label="人数" styles={styles} value={formatCount(labor?.headcount ?? row.headcount)} />
    </View>
    {labor?.employees.length ? <View style={styles.section}>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>员工工时</Text><Text style={styles.sectionCount}>{labor.employees.length} 人</Text></View>
      {labor.employees.map((employee) => <EmployeeRow employee={employee} key={employee.user_id} styles={styles} />)}
    </View> : detail ? <Text style={styles.empty}>当前筛选暂无员工工时</Text> : null}
  </>;
}

function EmployeeRow({ employee, styles }: { employee: LaborEmployeeDetail; styles: ReturnType<typeof createStyles> }) {
  const type = employee.support_type || employee.department || '本店';
  return <View style={styles.detailRow}>
    <View style={styles.rowCopy}>
      <Text style={styles.employeeName}>{employee.name}</Text>
      <Text style={styles.employeeType}>{type}</Text>
      <Text style={styles.employeeMeta}>{employee.segment_count} 个班段{employee.missing_count ? ` · 缺失 ${employee.missing_count}` : ''}</Text>
      {employee.anomaly_count ? <Text style={styles.anomaly}>异常 {employee.anomaly_count} 项</Text> : null}
    </View>
    <View style={styles.rowValue}>
      <Text style={styles.actualHours}>{formatAmount(employee.actual_hours)}h</Text>
      <Text style={styles.plannedHours}>排班 {formatAmount(employee.planned_hours)}h</Text>
      <Text style={styles.hoursGap}>差 {formatSigned(employee.hours_gap)}h</Text>
    </View>
  </View>;
}

function RevenueDetailContent({ detail, row, styles }: { detail: LaborDetailResult | null; row: LaborRow; styles: ReturnType<typeof createStyles> }) {
  const revenue = detail?.revenue;
  return <>
    <View style={styles.summaryBand}>
      <SummaryMetric label="净实收" styles={styles} value={`¥ ${formatAmount(revenue?.net_income ?? row.net_revenue)}`} />
      <SummaryMetric label="订单数" styles={styles} value={`${formatCount(revenue?.order_count ?? 0)} 单`} />
      <SummaryMetric label="收入" styles={styles} value={`¥ ${formatAmount(revenue?.income_amount ?? row.net_revenue)}`} />
      <SummaryMetric label="退款" styles={styles} value={`¥ ${formatAmount(revenue?.refund_amount ?? 0)}`} />
    </View>
    {revenue?.daily.length ? <View style={styles.section}>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>每日净实收</Text><Text style={styles.sectionCount}>{revenue.daily.length} 天</Text></View>
      {revenue.daily.map((day) => <RevenueDayRow day={day} key={day.business_date} styles={styles} />)}
    </View> : detail ? <Text style={styles.empty}>当前筛选暂无每日净实收</Text> : null}
  </>;
}

function RevenueDayRow({ day, styles }: { day: RevenueDay; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.detailRow}>
    <View style={styles.rowCopy}><Text style={styles.day}>{day.business_date}</Text><Text style={styles.dayOrders}>{formatCount(day.order_count)} 单</Text><Text style={styles.employeeMeta}>收入 ¥ {formatAmount(day.income_amount)}</Text></View>
    <View style={styles.rowValue}><Text style={styles.revenueValue}>¥ {formatAmount(day.net_income)}</Text>{day.refund_amount ? <Text style={styles.refund}>退款 ¥ {formatAmount(day.refund_amount)}</Text> : null}</View>
  </View>;
}

function SummaryMetric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={styles.summaryMetric}><Text style={styles.label}>{label}</Text><Text numberOfLines={1} style={styles.value}>{value}</Text></View>;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatAmount(value)}`;
}

function createStyles(theme: AppTheme) {
  const accent = theme.status.success;
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.background.canvas, flex: 1 },
    content: { padding: 16, paddingBottom: 36 },
    name: { color: theme.text.primary, fontSize: 20, fontWeight: '500', letterSpacing: 0, lineHeight: 29 },
    period: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 4 },
    tabs: { borderColor: theme.border.strong, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: 18, overflow: 'hidden' },
    tab: { alignItems: 'center', flex: 1, height: 42, justifyContent: 'center' },
    tabActive: { backgroundColor: theme.background.surface },
    tabText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    tabTextActive: { color: theme.text.primary, fontWeight: '600' },
    note: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 18 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0, marginTop: 18 },
    summaryBand: { backgroundColor: theme.background.surface, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', marginTop: 18, overflow: 'hidden' },
    summaryMetric: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, padding: 12, width: '50%' },
    label: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    value: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 15, letterSpacing: 0, marginTop: 4 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 24, paddingTop: 18 },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    sectionTitle: { color: theme.text.primary, fontSize: 18, fontWeight: '500', letterSpacing: 0 },
    sectionCount: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    detailRow: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, paddingVertical: 14 },
    rowCopy: { flex: 1, minWidth: 0 },
    employeeName: { color: theme.text.primary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    employeeType: { color: theme.text.secondary, fontSize: 10, fontWeight: '600', letterSpacing: 0, marginTop: 4 },
    employeeMeta: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, lineHeight: 16, marginTop: 4 },
    anomaly: { color: theme.status.warning, fontSize: 10, letterSpacing: 0, marginTop: 5 },
    rowValue: { alignItems: 'flex-end', flexShrink: 0 },
    actualHours: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 15, letterSpacing: 0 },
    plannedHours: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    hoursGap: { color: theme.text.muted, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    day: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 0 },
    dayOrders: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0, marginTop: 5 },
    revenueValue: { color: accent, fontFamily: 'monospace', fontSize: 15, letterSpacing: 0 },
    refund: { color: theme.status.warning, fontSize: 10, letterSpacing: 0, marginTop: 4 },
    empty: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, paddingVertical: 36, textAlign: 'center' },
  });
}
