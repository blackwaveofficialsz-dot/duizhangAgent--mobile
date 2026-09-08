import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OrderSecondaryDimension, OrderStoreMetrics, OrderStoreTableRow } from './orderStoreTable';
import type { ComparisonMode, MetricComparison, OperationsDimensionRow, OperationsOverview } from '@/services/api/operationsAnalytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, formatCount, formatPercent } from '@/utils/number';
import { comparisonDisplayItems, type ComparisonDisplayMode, type ComparisonValueFormat } from './periodComparison';

type MetricKey = keyof Pick<OrderStoreMetrics,
  'avgOrderValueCent' | 'incomeAmountCent' | 'netIncomeCent' | 'orderCount' | 'paidAmountCent' | 'refundAmountCent' | 'refundRate'>;

type MetricColumn = {
  comparisonFormat: ComparisonValueFormat;
  comparisonKey: string;
  key: MetricKey;
  label: string;
};

type Props = {
  comparison: OperationsOverview | null;
  comparisonMode: ComparisonMode;
  displayMode: ComparisonDisplayMode;
  onPressStore: (row: OrderStoreTableRow) => void;
  rows: OrderStoreTableRow[];
  secondaryDimension: OrderSecondaryDimension;
};

const METRICS: MetricColumn[] = [
  { comparisonFormat: 'integer', comparisonKey: 'order_count', key: 'orderCount', label: '订单数' },
  { comparisonFormat: 'money', comparisonKey: 'paid_amount', key: 'paidAmountCent', label: '营收' },
  { comparisonFormat: 'money', comparisonKey: 'income_amount', key: 'incomeAmountCent', label: '实收' },
  { comparisonFormat: 'money', comparisonKey: 'refund_amount', key: 'refundAmountCent', label: '退款' },
  { comparisonFormat: 'money', comparisonKey: 'net_income', key: 'netIncomeCent', label: '净实收' },
  { comparisonFormat: 'money', comparisonKey: 'avg_order_value', key: 'avgOrderValueCent', label: '客单价' },
  { comparisonFormat: 'percentagePoint', comparisonKey: 'refund_rate', key: 'refundRate', label: '退款率' },
];

const GROUP_HEADER_HEIGHT = 22;
const METRIC_CELL_WIDTH = 88;
const ROW_HEIGHT = 68;
const STORE_COLUMN_WIDTH = 82;

const EMPTY_METRICS: OrderStoreMetrics = {
  avgOrderValueCent: 0,
  incomeAmountCent: 0,
  netIncomeCent: 0,
  orderCount: 0,
  paidAmountCent: 0,
  refundAmountCent: 0,
  refundRate: 0,
};

export function OrderStoreTable({ comparison, comparisonMode, displayMode, onPressStore, rows, secondaryDimension }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const breakdowns = useMemo(() => collectBreakdowns(rows, secondaryDimension), [rows, secondaryDimension]);
  const totalRow = useMemo(() => buildTotalRow(rows, breakdowns), [breakdowns, rows]);
  const columns = useMemo(() => breakdowns.flatMap((breakdown) => METRICS.map((metric) => ({
    ...metric,
    breakdownKey: breakdown.key,
    breakdownLabel: breakdown.label,
  }))), [breakdowns]);

  return (
    <View style={styles.table}>
      <View style={styles.caption}>
        <Text style={styles.captionText}>门店明细</Text>
        <Text style={styles.hint}>左右滑动查看指标</Text>
      </View>
      <View style={styles.viewport}>
        <View style={styles.fixedColumn} testID="order-fixed-store-column">
          <View style={styles.headerCell}><Text style={styles.headerText}>门店</Text></View>
          {rows.map((row) => <Pressable
            accessibilityLabel={row.storeLabel}
            accessibilityRole="button"
            key={row.storeKey}
            onPress={() => onPressStore(row)}
            style={({ pressed }) => [styles.storeCell, pressed && styles.pressed]}
          >
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.storeName}>{row.storeLabel}</Text>
            <ChevronRight color={theme.text.muted} size={14} strokeWidth={2} />
          </Pressable>)}
          <View style={[styles.storeCell, styles.totalCell]} testID="order-total-store-row">
            <Text numberOfLines={1} style={[styles.storeName, styles.totalText]}>总计</Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.metricsScroller}
          testID="order-scrollable-metrics"
        >
          <View>
            <View style={styles.breakdownHeaderRow}>
              {breakdowns.map((breakdown) => <View key={breakdown.key} style={styles.breakdownHeaderCell}>
                <Text numberOfLines={1} style={styles.breakdownHeaderText}>{breakdown.label}</Text>
              </View>)}
            </View>
            <View style={styles.metricHeaderRow}>
              {columns.map((column) => <View key={column.breakdownKey + ':' + column.key} style={styles.metricHeaderCell}>
                <Text numberOfLines={1} style={styles.metricHeaderLabel}>{column.label}</Text>
              </View>)}
            </View>
            {rows.map((row) => <View key={row.storeKey} style={styles.metricRow}>
              {columns.map((column) => <MetricCell
                key={column.breakdownKey + ':' + column.key}
                comparison={comparisonForCell(comparison, row, column.breakdownKey, column.comparisonKey, secondaryDimension, false)}
                comparisonFormat={column.comparisonFormat}
                comparisonMode={comparisonMode}
                displayMode={displayMode}
                metric={column.key}
                values={column.breakdownKey === 'total'
                  ? row.totals
                  : row.breakdown[column.breakdownKey] ?? EMPTY_METRICS}
                styles={styles}
              />)}
            </View>)}
            <View style={styles.metricRow} testID="order-total-metric-row">
              {columns.map((column) => <MetricCell
                key={'total:' + column.breakdownKey + ':' + column.key}
                comparison={comparisonForCell(comparison, totalRow, column.breakdownKey, column.comparisonKey, secondaryDimension, true)}
                comparisonFormat={column.comparisonFormat}
                comparisonMode={comparisonMode}
                displayMode={displayMode}
                metric={column.key}
                values={column.breakdownKey === 'total'
                  ? totalRow.totals
                  : totalRow.breakdown[column.breakdownKey] ?? EMPTY_METRICS}
                styles={styles}
                total
              />)}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function MetricCell({ comparison, comparisonFormat, comparisonMode, displayMode, metric, styles, total = false, values }: {
  comparison: MetricComparison | undefined;
  comparisonFormat: ComparisonValueFormat;
  comparisonMode: ComparisonMode;
  displayMode: ComparisonDisplayMode;
  metric: MetricKey;
  styles: ReturnType<typeof createStyles>;
  total?: boolean;
  values: OrderStoreMetrics;
}) {
  const items = comparisonMode === 'previous' && comparison
    ? comparisonDisplayItems(comparison, displayMode, comparisonFormat)
    : [];
  return <View style={[styles.metricCell, total && styles.totalCell]}>
    <Text numberOfLines={1} style={[styles.metricValue, total && styles.totalText]}>{formatMetric(values, metric)}</Text>
    {items.length ? <View style={styles.metricComparison}>
      {items.map((item) => <Text key={item.key} numberOfLines={1} style={[
        styles.metricComparisonText,
        item.tone === 'positive' && styles.metricComparisonPositive,
        item.tone === 'negative' && styles.metricComparisonNegative,
        item.tone === 'unavailable' && styles.metricComparisonUnavailable,
      ]}>{item.label} {item.value}</Text>)}
    </View> : null}
  </View>;
}

function comparisonForCell(
  comparison: OperationsOverview | null,
  row: OrderStoreTableRow,
  breakdownKey: string,
  metricKey: string,
  secondaryDimension: OrderSecondaryDimension,
  total: boolean,
): MetricComparison | undefined {
  if (!comparison) return undefined;
  if (total) {
    if (breakdownKey === 'total') return comparison.metrics[metricKey];
    const candidates = secondaryDimension === 'channel' ? comparison.channels : comparison.platforms ?? [];
    return matchingComparisonRow(candidates, breakdownKey, '')?.metrics[metricKey];
  }
  const lookupKey = breakdownKey === 'total' ? row.storeKey : `${row.storeKey}|${breakdownKey}`;
  const candidates = breakdownKey === 'total'
    ? comparison.stores
    : secondaryDimension === 'channel'
      ? comparison.store_channels
      : comparison.store_platforms ?? [];
  return matchingComparisonRow(candidates, lookupKey, row.storeLabel)?.metrics[metricKey];
}

function matchingComparisonRow(
  rows: OperationsDimensionRow[],
  lookupKey: string,
  storeLabel: string,
): OperationsDimensionRow | undefined {
  return rows.find((item) => String(item.store_key ?? item.dim_key ?? '') === lookupKey)
    ?? (lookupKey.includes('|')
      ? undefined
      : rows.find((item) => String(item.store_label ?? item.dim_label ?? '') === storeLabel));
}

function collectBreakdowns(rows: OrderStoreTableRow[], secondaryDimension: OrderSecondaryDimension): Array<{ key: string; label: string }> {
  if (secondaryDimension === 'total') return [{ key: 'total', label: '总计' }];
  if (secondaryDimension === 'channel') return [
    { key: 'shop', label: '堂食' },
    { key: 'takeout', label: '外卖' },
  ];
  const labels = new Map<string, string>();
  for (const row of rows) {
    for (const [key, label] of Object.entries(row.breakdownLabels)) labels.set(key, label || key);
  }
  return [...labels.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

function buildTotalRow(
  rows: OrderStoreTableRow[],
  breakdowns: Array<{ key: string; label: string }>,
): OrderStoreTableRow {
  const total: OrderStoreTableRow = {
    breakdown: {},
    breakdownLabels: Object.fromEntries(breakdowns.map((item) => [item.key, item.label])),
    storeKey: '__total__',
    storeLabel: '总计',
    totals: EMPTY_METRICS,
  };
  for (const row of rows) {
    total.totals = addMetrics(total.totals, row.totals);
    for (const breakdown of breakdowns) {
      const values = row.breakdown[breakdown.key];
      if (!values) continue;
      total.breakdown[breakdown.key] = addMetrics(total.breakdown[breakdown.key] ?? EMPTY_METRICS, values);
    }
  }
  return total;
}

function addMetrics(left: OrderStoreMetrics, right: OrderStoreMetrics): OrderStoreMetrics {
  const orderCount = left.orderCount + right.orderCount;
  const paidAmountCent = left.paidAmountCent + right.paidAmountCent;
  const refundAmountCent = left.refundAmountCent + right.refundAmountCent;
  const netIncomeCent = left.netIncomeCent + right.netIncomeCent;
  return {
    avgOrderValueCent: orderCount > 0 ? Math.round(netIncomeCent / orderCount) : 0,
    incomeAmountCent: left.incomeAmountCent + right.incomeAmountCent,
    netIncomeCent,
    orderCount,
    paidAmountCent,
    refundAmountCent,
    refundRate: paidAmountCent > 0 ? refundAmountCent / paidAmountCent : 0,
  };
}

function formatMetric(values: OrderStoreMetrics, metric: MetricKey): string {
  if (metric === 'orderCount') return formatCount(values.orderCount);
  if (metric === 'refundRate') return formatPercent(values.refundRate);
  return formatAmount(values[metric] / 100);
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    breakdownHeaderCell: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, height: GROUP_HEADER_HEIGHT, justifyContent: 'center', paddingLeft: 10, width: METRIC_CELL_WIDTH * METRICS.length },
    breakdownHeaderRow: { flexDirection: 'row', height: GROUP_HEADER_HEIGHT },
    breakdownHeaderText: { color: theme.text.muted, fontSize: 10, letterSpacing: 0 },
    caption: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 5 },
    captionText: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    fixedColumn: { backgroundColor: theme.background.canvas, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, width: STORE_COLUMN_WIDTH, zIndex: 1 },
    headerCell: { alignItems: 'flex-start', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, height: 52, justifyContent: 'center', paddingHorizontal: 10 },
    headerText: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    hint: { color: theme.text.muted, fontSize: 11, letterSpacing: 0 },
    metricCell: { alignItems: 'flex-end', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, height: ROW_HEIGHT, justifyContent: 'center', paddingHorizontal: 8, width: METRIC_CELL_WIDTH },
    metricComparison: { alignItems: 'flex-end', marginTop: 3 },
    metricComparisonNegative: { color: theme.status.danger },
    metricComparisonPositive: { color: theme.status.success },
    metricComparisonText: { color: theme.text.secondary, fontSize: 10, letterSpacing: 0, lineHeight: 12, textAlign: 'right' },
    metricComparisonUnavailable: { color: theme.text.muted },
    metricHeaderCell: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border.default, borderRightWidth: StyleSheet.hairlineWidth, height: 30, justifyContent: 'center', paddingHorizontal: 4, width: METRIC_CELL_WIDTH },
    metricHeaderLabel: { color: theme.text.secondary, fontSize: 11, letterSpacing: 0 },
    metricHeaderRow: { alignItems: 'center', flexDirection: 'row', height: 30 },
    metricRow: { flexDirection: 'row', height: ROW_HEIGHT },
    metricsScroller: { flex: 1, minWidth: 0 },
    metricValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    pressed: { backgroundColor: theme.background.subtle },
    storeCell: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', height: ROW_HEIGHT, justifyContent: 'space-between', paddingLeft: 10, paddingRight: 5 },
    storeName: { color: theme.text.primary, flex: 1, fontSize: 13, letterSpacing: 0, lineHeight: 16, paddingRight: 3 },
    table: { marginTop: 2 },
    totalCell: { backgroundColor: theme.background.subtle },
    totalText: { fontWeight: '700' },
    viewport: { backgroundColor: theme.background.canvas, borderColor: theme.border.default, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', overflow: 'hidden' },
  });
}
