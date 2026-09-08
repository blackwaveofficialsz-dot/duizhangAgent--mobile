import { CircleDashed } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export function NotificationSettingsScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.status}>
          <CircleDashed color={theme.text.secondary} size={22} strokeWidth={2} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>通知服务尚未启用</Text>
            <Text style={styles.statusDescription}>JPush 尚未接入。任务状态会继续通过应用内刷新显示，不会伪造系统通知开关。</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { paddingHorizontal: 20, paddingVertical: 24 },
    status: { alignItems: 'flex-start', backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
    statusCopy: { flex: 1, minWidth: 0 },
    statusTitle: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    statusDescription: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 21, marginTop: 5 },
  });
}
