import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { ComparisonMode } from '@/services/api/operationsAnalytics';
import type { ComparisonDisplayMode } from './periodComparison';

type Props = {
  displayMode: ComparisonDisplayMode;
  mode: ComparisonMode;
  onDisplayModeChange: (mode: ComparisonDisplayMode) => void;
  onModeChange: (mode: ComparisonMode) => void;
};

const COMPARISON_MODES: Array<{ label: string; value: ComparisonMode }> = [
  { label: '与上期对比', value: 'previous' },
  { label: '不对比', value: 'none' },
];

const DISPLAY_MODES: Array<{ label: string; value: ComparisonDisplayMode }> = [
  { label: '百分比', value: 'percentage' },
  { label: '差值', value: 'difference' },
  { label: '上期', value: 'previous' },
  { label: '全部', value: 'all' },
];

export function PeriodComparisonControl({ displayMode, mode, onDisplayModeChange, onModeChange }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const displayDisabled = mode === 'none';

  return <View style={styles.container}>
    <ControlRow label="对比方式" styles={styles}>
      {COMPARISON_MODES.map((item) => <ControlButton
        key={item.value}
        label={item.label}
        onPress={() => onModeChange(item.value)}
        selected={mode === item.value}
        styles={styles}
      />)}
    </ControlRow>
    <ControlRow label="展示方式" styles={styles}>
      {DISPLAY_MODES.map((item) => <ControlButton
        disabled={displayDisabled}
        key={item.value}
        label={item.label}
        onPress={() => onDisplayModeChange(item.value)}
        selected={displayMode === item.value}
        styles={styles}
      />)}
    </ControlRow>
  </View>;
}

function ControlRow({ children, label, styles }: { children: React.ReactNode; label: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.options}>{children}</View>
  </View>;
}

function ControlButton({ disabled = false, label, onPress, selected, styles }: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ disabled, selected }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.button, selected && styles.buttonSelected, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed]}
  ><Text style={[styles.buttonText, selected && styles.buttonTextSelected, disabled && styles.buttonTextDisabled]}>{label}</Text></Pressable>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { gap: 8 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    label: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, width: 52 },
    options: { flex: 1, flexDirection: 'row', gap: 6 },
    button: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
    buttonSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    buttonDisabled: { opacity: 0.48 },
    buttonText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    buttonTextSelected: { color: theme.action.onPrimary, fontWeight: '600' },
    buttonTextDisabled: { color: theme.text.muted },
    pressed: { opacity: 0.66 },
  });
}
