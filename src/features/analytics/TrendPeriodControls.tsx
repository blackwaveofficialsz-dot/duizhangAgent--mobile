import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { AnalyticsFilters } from './analyticsFilters';
import { defaultTrendRange, toggleCurrentPeriod, type TrendGranularity } from './trendPeriod';

type Props = {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  today: string;
};

const GRANULARITIES: Array<{ key: TrendGranularity; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

export function TrendPeriodControls({ filters, onChange, today }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const granularity = filters.granularity ?? 'day';
  const setGranularity = (next: TrendGranularity) => {
    onChange({ ...filters, ...defaultTrendRange(next, today), granularity: next });
  };
  const currentLabel = granularity === 'week' ? '周' : '月';

  return <>
    <Text style={styles.label}>统计周期</Text>
    <View accessibilityRole="tablist" style={styles.segmented}>
      {GRANULARITIES.map((item) => {
        const selected = item.key === granularity;
        return <Pressable
          accessibilityLabel={`按${item.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          key={item.key}
          onPress={() => setGranularity(item.key)}
          style={[styles.segment, selected && styles.active]}
        ><Text style={[styles.text, selected && styles.activeText]}>{item.label}</Text></Pressable>;
      })}
    </View>
    {granularity !== 'day' ? <Pressable
      accessibilityLabel={`包含当前${currentLabel}`}
      accessibilityRole="button"
      accessibilityState={{ checked: Boolean(filters.includeCurrent) }}
      onPress={() => onChange({
        ...filters,
        ...toggleCurrentPeriod(granularity, filters, !filters.includeCurrent, today),
      })}
      style={styles.currentPeriod}
    >
      <View style={[styles.checkbox, filters.includeCurrent && styles.checkboxActive]}><Text style={styles.checkText}>{filters.includeCurrent ? '✓' : ''}</Text></View>
      <View style={styles.currentCopy}><Text style={styles.currentTitle}>包含当前{currentLabel}</Text><Text style={styles.currentHint}>当前{currentLabel}数据统计至昨日</Text></View>
    </Pressable> : null}
  </>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    label: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 2 },
    segmented: { borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flexDirection: 'row', height: 42, overflow: 'hidden' },
    segment: { alignItems: 'center', flex: 1, justifyContent: 'center' },
    active: { backgroundColor: theme.action.primary },
    text: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0 },
    activeText: { color: theme.action.onPrimary, fontWeight: '600' },
    currentPeriod: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 48 },
    checkbox: { alignItems: 'center', borderColor: theme.border.strong, borderRadius: 4, borderWidth: 1, height: 22, justifyContent: 'center', width: 22 },
    checkboxActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    checkText: { color: theme.action.onPrimary, fontSize: 14, letterSpacing: 0 },
    currentCopy: { flex: 1 },
    currentTitle: { color: theme.text.primary, fontSize: 14, letterSpacing: 0 },
    currentHint: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginTop: 2 },
  });
}
