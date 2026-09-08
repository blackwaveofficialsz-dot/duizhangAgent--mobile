import * as ScreenOrientation from 'expo-screen-orientation';
import { Filter, X } from 'lucide-react-native';
import { type ReactNode, type RefObject, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatAmount, sumAmounts } from '@/utils/number';
import type { DashboardChartPoint, DashboardTrendSeries } from './dashboardChartModels';
import { RevenueTrendChart, type RevenueTrendComparison } from './RevenueTrendChart';

type Props = {
  chart?: ReactNode;
  captureTarget?: RefObject<View | null>;
  comparison?: RevenueTrendComparison;
  filterPanel?: ReactNode | ((onClose: () => void) => ReactNode);
  filterSummary?: string;
  headerAction?: ReactNode;
  meta?: string;
  metricLabel?: string;
  onClose: () => void;
  onOpenFilters?: () => void;
  onSelectPeriod?: (period: string) => void;
  onToggleSeries?: (seriesId: string) => void;
  points: DashboardChartPoint[];
  hiddenSeriesIds?: string[];
  selectedPeriod?: string;
  series?: DashboardTrendSeries[];
  title: string;
  valueMode?: 'currency' | 'turnover';
};

export function FullscreenChartScreen({ captureTarget, chart, comparison, filterPanel, filterSummary, headerAction, hiddenSeriesIds, meta, metricLabel, onClose, onOpenFilters, onSelectPeriod, onToggleSeries, points, selectedPeriod, series, title, valueMode = 'currency' }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [filterOpen, setFilterOpen] = useState(false);
  const total = sumAmounts(points.map((point) => (point.missing ? 0 : point.net_income)));
  const canFilter = Boolean(filterPanel || onOpenFilters);

  useEffect(() => {
    let active = true;
    let previousLock: ScreenOrientation.OrientationLock | null = null;
    void ScreenOrientation.getOrientationLockAsync()
      .then(async (lock) => {
        previousLock = lock;
        if (active) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      })
      .catch(() => showToast('无法锁定横屏，图表仍可继续查看', 'info'));
    return () => {
      active = false;
      if (previousLock !== null) {
        void ScreenOrientation.lockAsync(previousLock).catch(() => showToast('屏幕方向恢复失败，请旋转设备', 'info'));
      }
    };
  }, []);

  return <SafeAreaView collapsable={false} edges={['top', 'right', 'bottom', 'left']} ref={captureTarget} style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{meta ?? `区间净实收 ${formatAmount(total)} · ${points.length} 天`}</Text>
        {filterSummary ? <Text numberOfLines={1} style={styles.filterSummary}>{filterSummary}</Text> : null}
      </View>
      {headerAction}
      {canFilter ? <Pressable accessibilityLabel="修改图表筛选" accessibilityRole="button" accessibilityState={{ expanded: filterOpen }} onPress={() => { setFilterOpen((open) => !open); onOpenFilters?.(); }} style={styles.closeButton}>
        <Filter color={theme.text.primary} size={19} strokeWidth={1.8} />
      </Pressable> : null}
      <Pressable accessibilityLabel="关闭全屏趋势" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
        <X color={theme.text.primary} size={20} strokeWidth={1.8} />
      </Pressable>
    </View>
    <View style={styles.content} testID="fullscreen-chart-content">
      {chart ?? <RevenueTrendChart comparison={comparison} detailPlacement="right" expanded hiddenSeriesIds={hiddenSeriesIds} metricLabel={metricLabel} onSelectPeriod={onSelectPeriod} onToggleSeries={onToggleSeries} points={points} selectedPeriod={selectedPeriod} series={series} showHeader={false} title={title} valueMode={valueMode} />}
    </View>
    {filterOpen && filterPanel ? <View accessibilityViewIsModal style={styles.filterPanel} testID="fullscreen-filter-panel">
      <View style={styles.filterHeader}><Text style={styles.filterTitle}>筛选</Text><Pressable accessibilityLabel="关闭图表筛选" accessibilityRole="button" onPress={() => setFilterOpen(false)} style={styles.closeButton}><X color={theme.text.primary} size={18} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.filterContent} keyboardShouldPersistTaps="handled" style={styles.filterScroll}>{typeof filterPanel === 'function' ? filterPanel(() => setFilterOpen(false)) : filterPanel}</ScrollView>
    </View> : null}
  </SafeAreaView>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background.canvas, flex: 1 },
    header: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 52, paddingLeft: 16, paddingRight: 6 },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { color: theme.text.primary, fontSize: 17, fontWeight: '600', letterSpacing: 0 },
    meta: { color: theme.text.secondary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0, marginTop: 3 },
    filterSummary: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginTop: 2 },
    closeButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    content: { alignSelf: 'stretch', flex: 1, paddingHorizontal: 18, paddingVertical: 12, width: '100%' },
    filterPanel: { backgroundColor: theme.background.surface, borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, bottom: 8, position: 'absolute', right: 8, shadowColor: '#000000', shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.18, shadowRadius: 12, top: 56, width: 280, zIndex: 20 },
    filterHeader: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', height: 44, justifyContent: 'space-between', paddingLeft: 14 },
    filterTitle: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    filterScroll: { flex: 1 },
    filterContent: { gap: 10, padding: 14 },
  });
}
