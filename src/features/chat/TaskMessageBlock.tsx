import { ListChecks } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type TaskMessageBlockProps = { taskId: string; onOpen: (taskId: string) => void };

export function TaskMessageBlock({ taskId, onOpen }: TaskMessageBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityLabel="查看关联任务"
      accessibilityRole="button"
      onPress={() => onOpen(taskId)}
      style={({ pressed }) => [styles.block, pressed && styles.pressed]}
    >
      <ListChecks color={theme.status.info} size={18} strokeWidth={2} />
      <Text style={styles.text}>查看关联任务</Text>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 8 },
    text: { color: theme.action.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    pressed: { opacity: 0.68 },
  });
}
