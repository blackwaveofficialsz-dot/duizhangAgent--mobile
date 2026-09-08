import { CheckCircle2 } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { ThemeMode } from '@/theme/themeStore';

const appearanceOptions = [
  { description: '自动匹配设备当前设置', label: '跟随系统', value: 'system' },
  { description: '使用明亮界面', label: '浅色模式', value: 'light' },
  { description: '使用深色界面', label: '深色模式', value: 'dark' },
] as const;

export function AppearanceScreen() {
  const { mode, setMode, theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const chooseMode = (nextMode: ThemeMode) => {
    void setMode(nextMode);
    showToast(`已切换为${appearanceOptions.find((option) => option.value === nextMode)?.label}`, 'success');
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.description}>切换后立即生效，并保留为下次启动时的偏好。</Text>
        <View style={styles.options}>
          {appearanceOptions.map(({ description, label, value }) => {
            const selected = mode === value;
            return (
              <Pressable
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={value}
                onPress={() => chooseMode(value)}
                style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
              >
                <View style={styles.optionCopy}>
                  <Text style={styles.optionLabel}>{label}</Text>
                  <Text style={styles.optionDescription}>{description}</Text>
                </View>
                {selected ? <CheckCircle2 color={theme.text.primary} size={20} strokeWidth={2.5} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { paddingHorizontal: 20, paddingVertical: 24 },
    description: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    options: { borderColor: theme.border.default, marginTop: 24 },
    option: { alignItems: 'center', borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: 2 },
    optionSelected: { backgroundColor: theme.background.subtle },
    optionCopy: { flex: 1, minWidth: 0 },
    optionLabel: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    optionDescription: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 3 },
    pressed: { opacity: 0.68 },
  });
}
