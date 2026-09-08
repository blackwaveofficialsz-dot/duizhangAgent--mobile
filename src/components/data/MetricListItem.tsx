import { ChevronRight } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type Metric = { label: string; value: string };

type Props = {
  title: string;
  metrics: Metric[];
  onPress?: () => void;
};

export function MetricListItem({ title, metrics, onPress }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && onPress && styles.pressed]}
    >
      <View style={styles.heading}>
        <Text numberOfLines={2} style={styles.title}>{title}</Text>
        {onPress ? <ChevronRight color={theme.text.secondary} size={18} /> : null}
      </View>
      <View style={styles.metrics}>
        {metrics.slice(0, 6).map((metric) => (
          <View key={metric.label} style={styles.metric}>
            <Text style={styles.label}>{metric.label}</Text>
            <Text numberOfLines={1} style={styles.value}>{metric.value}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    item: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, paddingVertical: 14 },
    pressed: { opacity: 0.65 },
    heading: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    title: { color: theme.text.primary, flex: 1, fontSize: 16, letterSpacing: 0, lineHeight: 22 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
    metric: { minWidth: '50%', paddingRight: 12 },
    label: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    value: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 15, letterSpacing: 0, marginTop: 3 },
  });
}
