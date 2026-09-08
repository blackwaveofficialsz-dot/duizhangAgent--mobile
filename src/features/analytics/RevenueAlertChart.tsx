import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EChart } from '@/components/charts/EChart';
import type { RevenueAlert } from '@/services/api/analytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount } from '@/utils/number';

type Props = {
  alerts: RevenueAlert[];
  onSelect?: (alert: RevenueAlert) => void;
};

export function RevenueAlertChart({ alerts, onSelect }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const chartRows = useMemo(
    () => [...alerts]
      .sort((left, right) => Math.abs(right.deviation_pct) - Math.abs(left.deviation_pct))
      .slice(0, 10),
    [alerts],
  );
  const chartKey = chartRows.map((alert) => `${alert.business_date}:${alert.shop_key}`).join('|');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [chartKey]);

  const option = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    grid: {
      bottom: 38,
      left: 8,
      outerBoundsContain: 'axisLabel',
      outerBoundsMode: 'same',
      right: 42,
      top: 28,
    },
    tooltip: {
      confine: true,
      trigger: 'axis',
      valueFormatter: (value: unknown) => `${Number(value ?? 0).toFixed(1)}%`,
    },
    xAxis: {
      axisLabel: { color: theme.text.muted, fontSize: 11, formatter: (value: number) => `${value}%` },
      axisLine: { lineStyle: { color: theme.border.strong } },
      name: '偏离率（%）',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: theme.text.secondary, fontSize: 11 },
      splitLine: { lineStyle: { color: theme.border.default, type: 'dashed' } },
      type: 'value',
    },
    yAxis: {
      axisLabel: { color: theme.text.secondary, fontSize: 11, overflow: 'truncate', width: 80 },
      axisLine: { lineStyle: { color: theme.border.strong } },
      axisTick: { show: false },
      data: chartRows.map((alert) => alert.shop_label || alert.shop_key),
      inverse: true,
      name: '门店',
      nameTextStyle: { color: theme.text.secondary, fontSize: 11 },
      type: 'category',
    },
    series: [{
      barMaxWidth: 18,
      data: chartRows.map((alert) => ({
        itemStyle: {
          color: alert.direction === 'under' ? theme.status.danger : theme.status.success,
        },
        value: Number((alert.deviation_pct * 100).toFixed(1)),
      })),
      name: '偏离率',
      type: 'bar',
    }],
  }), [chartRows, theme]);

  const selected = chartRows[selectedIndex] ?? chartRows[0];

  return (
    <View style={styles.container}>
      <EChart
        gestureMode="tap"
        height={Math.max(220, Math.min(320, chartRows.length * 34 + 84))}
        onDataIndexSelect={(index) => {
          if (!chartRows[index]) return;
          setSelectedIndex(index);
          onSelect?.(chartRows[index]);
        }}
        option={option}
        testID="revenue-alert-echart"
      />
      {selected ? (
        <View style={styles.detail} testID="revenue-alert-chart-detail">
          <View style={styles.detailHeader}>
            <Text numberOfLines={1} style={styles.shop}>{selected.shop_label || selected.shop_key}</Text>
            <Text style={[styles.direction, selected.direction === 'under' ? styles.under : styles.over]}>
              {directionText(selected)}
            </Text>
          </View>
          <View style={styles.metrics}>
            <Text style={styles.metric}>实际净实收 {formatAmount(selected.actual_amount)}</Text>
            <Text style={styles.metric}>历史基线 {formatAmount(selected.baseline_amount)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function directionText(alert: RevenueAlert): string {
  const direction = alert.direction === 'under' ? '偏低' : '偏高';
  return `${direction} ${Math.abs(alert.deviation_pct * 100).toFixed(1)}%`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { gap: 10 },
    detail: {
      borderTopColor: theme.border.default,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingTop: 10,
    },
    detailHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    shop: { color: theme.text.primary, flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    direction: { fontFamily: 'monospace', fontSize: 13, letterSpacing: 0 },
    under: { color: theme.status.danger },
    over: { color: theme.status.success },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metric: { color: theme.text.secondary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
  });
}
