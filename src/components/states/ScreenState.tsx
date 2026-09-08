import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type ScreenStateType = 'loading' | 'empty' | 'error' | 'offline';

type ScreenStateProps = {
  state: ScreenStateType;
  actionLabel?: string;
  description?: string;
  onAction?: () => void;
};

const stateContent = {
  loading: { title: '正在加载', description: '请稍候' },
  empty: { title: '暂无内容', description: '当前没有可展示的数据' },
  error: { title: '加载失败', description: '请稍后重试' },
  offline: { title: '当前处于离线状态', description: '请检查网络连接' },
} as const;

export function ScreenState({ state, actionLabel, description, onAction }: ScreenStateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const content = stateContent[state];
  const iconColor = state === 'error' ? theme.status.danger : theme.text.muted;

  return (
    <View style={styles.container}>
      {state === 'loading' ? (
        <ActivityIndicator color={theme.status.info} size="large" />
      ) : (
        <View style={[styles.stateIndicator, { borderColor: iconColor }]} />
      )}
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.description}>{description ?? content.description}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      minHeight: 240,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    stateIndicator: {
      width: 32,
      height: 32,
      borderWidth: 3,
      borderRadius: 16,
    },
    title: {
      marginTop: 14,
      color: theme.text.primary,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
      letterSpacing: 0,
    },
    description: {
      marginTop: 6,
      color: theme.text.secondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      letterSpacing: 0,
    },
    action: {
      minHeight: 44,
      minWidth: 96,
      marginTop: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: theme.action.primary,
      paddingHorizontal: 18,
    },
    actionPressed: {
      transform: [{ scale: 0.98 }],
    },
    actionText: {
      color: theme.action.onPrimary,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0,
    },
  });
}
