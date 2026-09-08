import { ArrowLeft, Clock3, Menu, RefreshCw } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export type AppHeaderAction = {
  type: 'back' | 'history' | 'menu' | 'refresh';
  onPress: () => void;
  disabled?: boolean;
};

export const APP_HEADER_HEIGHT = 56;

type AppHeaderProps = {
  leadingAction?: AppHeaderAction;
  trailingAction?: AppHeaderAction;
  title: string;
};

const actionLabels = {
  back: '返回',
  history: '打开历史记录',
  menu: '打开侧边栏',
  refresh: '刷新',
} as const;

export function AppHeader({ leadingAction, trailingAction, title }: AppHeaderProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const renderAction = (action: AppHeaderAction) => (
    <Pressable
      accessibilityLabel={actionLabels[action.type]}
      accessibilityRole="button"
      accessibilityState={{ disabled: action.disabled }}
      disabled={action.disabled}
      onPress={action.onPress}
      style={({ pressed }) => [styles.iconButton, pressed && !action.disabled && styles.pressed]}
    >
      {action.type === 'back' && <ArrowLeft color={theme.text.primary} size={22} strokeWidth={2} />}
      {action.type === 'history' && <Clock3 color={theme.text.primary} size={22} strokeWidth={2} />}
      {action.type === 'menu' && <Menu color={theme.text.primary} size={22} strokeWidth={2} />}
      {action.type === 'refresh' && <RefreshCw color={theme.text.primary} size={22} strokeWidth={2} />}
    </Pressable>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        {leadingAction
          ? renderAction(leadingAction)
          : <View importantForAccessibility="no" style={styles.trailingSpace} />}
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {trailingAction
          ? renderAction(trailingAction)
          : <View importantForAccessibility="no" style={styles.trailingSpace} />}
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: {
      backgroundColor: theme.background.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.default,
    },
    header: {
      height: APP_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: theme.text.primary,
      fontSize: 18,
      fontWeight: '400',
      letterSpacing: 0,
      textAlign: 'center',
    },
    trailingSpace: {
      width: 44,
      height: 44,
    },
    pressed: {
      opacity: 0.62,
    },
  });
}
