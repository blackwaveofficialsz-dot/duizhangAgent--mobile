import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, formatCount, formatPercent } from '@/utils/number';
import type { OrderPeriodRow, OrderStoreMetrics } from './orderStoreTable';

type MetricKey = keyof Pick<OrderStoreMetrics,
  'avgOrderValueCent' | 'incomeAmountCent' | 'netIncomeCent' | 'orderCount' | 'paidAmountCent' | 'refundAmountCent' | 'refundRate'>;

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: 'orderCount', label: '订单数' },
  { key: 'paidAmountCent', label: '营收' },
  { key: 'incomeAmountCent', label: '实收' },
  { key: 'refundAmountCent', label: '退款' },
  { key: 'netIncomeCent', label: '净实收' },
  { key: 'avgOrderValueCent', label: '客单价' },
  { key: 'refundRate', label: '退款率' },
];

export function OrderPeriodTableView({ rows }: { rows: OrderPeriodRow[] }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return <View style={styles.table}>
    <View style={styles.caption}>
      <Text style={styles.captionText}>周期明细</Text>
      <Text style={styles.hint}>左右滑动查看指标</Text>
    </View>
    <View style={styles.viewport}>
      <View style={styles.fixedColumn} testID="order-period-fixed-column">
        <View style={styles.headerCell}><Text style={styles.headerText}>周期</Text></View>
        {rows.map((row) => <View key={row.key} style={styles.periodCell}>
          <Text numberOfLines={1} style={styles.periodLabel}>{row.label}</Text>
        </View>)}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricsScroller} testID="order-period-scrollable-metrics">
        <View>
          <View style={styles.metricHeaderRow}>{METRICS.map((metric) => <View key={metric.key} style={styles.metricCell}>
            <Text numberOfLines={1} style={styles.metricHeaderLabel}>{metric.label}</Text>
          </View>)}</View>
          {rows.map((row) => <View key={row.key} style={styles.metricRow}>{METRICS.map((metric) => <View key={metric.key} style={styles.metricCell}>
            <Text numberOfLines={1} style={styles.metricValue}>{formatMetric(row.metrics, metric.key)}</Text>
          </View>)}</View>)}
        </View>
      </ScrollView>
    </View>
  </View>;
}

function formatMetric(values: OrderStoreMetrics, metric: MetricKey): string {
  if (metric === 'orderCount') return formatCount(values.orderCount);
  if (metric === 'refundRate') return formatPercent(values.refundRate);
  return formatAmount(values[metric] / 100);
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    caption: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 5 },
    captionText: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    fixedColumn: { backgroundColor: theme.background.canvas, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, width: 112, zIndex: 1 },
    headerCell: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, height: 38, justifyContent: 'center', paddingHorizontal: 10 },
    headerText: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    hint: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    metricCell: { alignItems: 'flex-end', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, height: 48, justifyContent: 'center', paddingHorizontal: 8, width: 84 },
    metricHeaderLabel: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    metricHeaderRow: { alignItems: 'center', flexDirection: 'row', height: 38 },
    metricRow: { flexDirection: 'row', height: 48 },
    metricsScroller: { flex: 1, minWidth: 0 },
    metricValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    periodCell: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, height: 48, justifyContent: 'center', paddingHorizontal: 10 },
    periodLabel: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    table: { marginTop: 2 },
    viewport: { flexDirection: 'row' },
  });
}
