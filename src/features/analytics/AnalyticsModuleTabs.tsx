import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export type AnalyticsModuleKey = 'dashboard' | 'orders' | 'products' | 'labor' | 'alerts';

const MODULES: Array<{ key: AnalyticsModuleKey; label: string; route: string }> = [
  { key: 'orders', label: '订单统计', route: '/analytics/orders' },
  { key: 'dashboard', label: '看板', route: '/analytics/dashboard' },
  { key: 'products', label: '产品', route: '/analytics/products' },
  { key: 'labor', label: '人效', route: '/analytics/labor' },
  { key: 'alerts', label: '营收报警', route: '/analytics/alerts' },
];

export function AnalyticsModuleTabs({ activeModule }: { activeModule: AnalyticsModuleKey }) {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.tabs}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {MODULES.map((module) => {
          const selected = module.key === activeModule;
          return (
            <Pressable
              accessibilityLabel={module.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={module.key}
              onPress={() => {
                if (!selected) router.replace(module.route as never);
              }}
              style={({ pressed }) => [styles.tab, selected && styles.tabActive, pressed && styles.pressed]}
            >
              <Text style={[styles.label, selected && styles.labelActive]}>{module.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.background.surface,
      borderBottomColor: theme.border.default,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tabs: {
      paddingHorizontal: 12,
    },
    tab: {
      alignItems: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 13,
    },
    tabActive: {
      borderBottomColor: theme.text.primary,
    },
    label: {
      color: theme.text.secondary,
      fontSize: 14,
      fontWeight: '400',
      letterSpacing: 0,
    },
    labelActive: {
      color: theme.text.primary,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.62,
    },
  });
}
