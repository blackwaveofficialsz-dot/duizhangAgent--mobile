import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MetricListItem } from '@/components/data/MetricListItem';
import { ScreenState } from '@/components/states/ScreenState';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { getProductTrend, type ProductTrendResult } from '@/services/api/analytics';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, formatCount, formatPercent } from '@/utils/number';

export default function ProductTrendRoute() {
  const product = useInsightDetailStore((state) => state.product);
  const productScope = useInsightDetailStore((state) => state.productScope);
  const { filters } = useAnalyticsStore();
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [data, setData] = useState<ProductTrendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!product || deviceOffline) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProductTrend(product.product_key, filters, { ...productScope, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '商品趋势加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deviceOffline, filters, product, productScope]);

  return <SafeAreaView edges={['left', 'right']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content}>
      {product ? <>
        <Text style={styles.name}>{data?.product_name || product.product_name || product.product_key}</Text>
        <View style={styles.metrics}>
          <Metric label="销额" styles={styles} value={formatAmount(product.sales_amount)} />
          <Metric label="销量" styles={styles} value={formatCount(product.quantity)} />
          <Metric label="订单数" styles={styles} value={formatCount(product.order_count)} />
          <Metric label="占比" styles={styles} value={formatPercent(product.sales_share)} />
        </View>
        {loading ? <ScreenState state="loading" /> : null}
        {deviceOffline && !data ? <Text style={styles.note}>离线状态下仅显示已加载汇总</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {data?.points.length ? <View style={styles.section}>
          <Text style={styles.sectionTitle}>销量趋势</Text>
          {data.points.map((point) => <MetricListItem
            key={point.period}
            metrics={[
              { label: '销额', value: formatAmount(point.sales_amount) },
              { label: '销量', value: formatCount(point.quantity) },
              { label: '订单数', value: formatCount(point.order_count) },
              { label: '7日均量', value: point.ma7 == null ? '—' : formatAmount(point.ma7) },
            ]}
            title={point.period}
          />)}
        </View> : null}
      </> : <ScreenState state="empty" />}
    </ScrollView>
  </SafeAreaView>;
}

function Metric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={styles.metric}><Text style={styles.label}>{label}</Text><Text numberOfLines={1} style={styles.value}>{value}</Text></View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.background.canvas, flex: 1 },
    content: { gap: 18, padding: 16 },
    name: { color: theme.text.primary, fontSize: 20, fontWeight: '400', letterSpacing: 0, lineHeight: 29 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
    metric: { minWidth: '50%', paddingRight: 12 },
    label: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    value: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 15, letterSpacing: 0, marginTop: 3 },
    note: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
    sectionTitle: { color: theme.text.primary, fontSize: 18, fontWeight: '400', letterSpacing: 0 },
  });
}
