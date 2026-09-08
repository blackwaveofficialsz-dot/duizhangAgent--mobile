import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, type AppTheme } from '@/theme/tokens';
import type { ToolCallData } from '@/types/chat';

type ToolCallBlockProps = {
  toolCall: ToolCallData;
};

const STATUS_LABELS = {
  running: '运行中',
  completed: '已完成',
  failed: '执行失败',
} as const;

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const Icon = toolCall.status === 'completed'
    ? CheckCircle2
    : toolCall.status === 'failed'
      ? XCircle
      : CircleDashed;
  const iconColor = toolCall.status === 'completed'
    ? theme.status.success
    : toolCall.status === 'failed'
      ? theme.status.danger
      : theme.status.info;

  return (
    <View accessibilityLabel={`工具调用：${toolCall.name}，${STATUS_LABELS[toolCall.status]}`} style={styles.block}>
      <Icon color={iconColor} size={18} strokeWidth={2} />
      <View style={styles.content}>
        <Text numberOfLines={1} style={styles.name}>{toolCall.name}</Text>
        {toolCall.description ? <Text style={styles.description}>{toolCall.description}</Text> : null}
      </View>
      <Text style={[styles.status, { color: iconColor }]}>{STATUS_LABELS[toolCall.status]}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: {
      alignItems: 'center',
      backgroundColor: theme.background.subtle,
      borderRadius: 8,
      borderLeftColor: palette.tide,
      borderLeftWidth: 3,
      flexDirection: 'row',
      gap: 10,
      minHeight: 52,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    content: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      color: theme.text.primary,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 0,
    },
    description: {
      color: theme.text.secondary,
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 19,
      marginTop: 2,
    },
    status: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0,
    },
  });
}
