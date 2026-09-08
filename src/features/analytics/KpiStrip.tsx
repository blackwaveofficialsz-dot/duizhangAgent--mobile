import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type Kpi = { label: string; value: string; wide?: boolean };

export function KpiStrip({ items }: { items: Kpi[] }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (items.length === 3 && items[0].wide) {
    return <View style={styles.splitGrid} testID="dashboard-kpi-layout">
      <KpiItem item={items[0]} style={styles.primaryItem} styles={styles} />
      <View style={styles.sideColumn}>
        <KpiItem item={items[1]} style={styles.sideItemTop} styles={styles} />
        <KpiItem item={items[2]} style={styles.sideItem} styles={styles} />
      </View>
    </View>;
  }
  return (
    <View style={styles.grid} testID="dashboard-kpi-layout">
      {items.map((item) => (
        <KpiItem item={item} key={item.label} style={[styles.item, item.wide && styles.wide]} styles={styles} />
      ))}
    </View>
  );
}

function KpiItem({ item, style, styles }: { item: Kpi; style: object; styles: ReturnType<typeof createStyles> }) {
  return <View style={style}>
    <Text style={styles.label}>{item.label}</Text>
    <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.value}>{item.value}</Text>
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    item: { backgroundColor: theme.background.subtle, borderRadius: 8, flexGrow: 1, flexBasis: '46%', minHeight: 84, padding: 12 },
    wide: { flexBasis: '100%' },
    splitGrid: { backgroundColor: theme.background.subtle, borderRadius: 8, flexDirection: 'row', minHeight: 112, overflow: 'hidden' },
    primaryItem: { flex: 1.25, justifyContent: 'center', padding: 12 },
    sideColumn: { borderLeftColor: theme.border.default, borderLeftWidth: StyleSheet.hairlineWidth, flex: 1 },
    sideItem: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
    sideItemTop: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
    label: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    value: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 22, fontWeight: '500', letterSpacing: 0, marginTop: 8 },
  });
}
