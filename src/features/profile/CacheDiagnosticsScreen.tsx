import { Copy, Database, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { getOfflineCacheDiagnostics, type OfflineCacheDiagnostics } from '@/services/cache/offlineCache';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export function CacheDiagnosticsScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [diagnostics, setDiagnostics] = useState<OfflineCacheDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDiagnostics(await getOfflineCacheDiagnostics());
    } catch (nextError) {
      setDiagnostics(null);
      setError(nextError instanceof Error ? nextError.message : '本地缓存诊断读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shareDiagnostics = async () => {
    if (!diagnostics) return;
    try {
      await Share.share({ message: diagnosticsMessage(diagnostics) });
      showToast('诊断摘要已打开分享面板', 'success');
    } catch {
      showToast('诊断摘要复制失败，请重试', 'error');
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <View style={styles.statusIcon}>
            <Database color={theme.text.primary} size={22} strokeWidth={2} />
          </View>
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>
              {loading ? '读取中' : error ? '读取失败' : diagnostics?.available ? '缓存可用' : '暂无缓存身份'}
            </Text>
            <Text style={styles.statusText}>
              仅展示条目数量、分类和同步时间，不展示业务明细。
            </Text>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {diagnostics ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>身份</Text>
              <MetricRow label="tenant_id" value={diagnostics.identity?.tenantId ?? '未配置'} />
              <MetricRow label="user_id" value={diagnostics.identity?.userId ?? '未配置'} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>缓存统计</Text>
              <MetricRow label="总条目" value={String(diagnostics.totalEntries)} />
              <MetricRow label="sessions" value={String(diagnostics.categories.sessions)} />
              <MetricRow label="tasks" value={String(diagnostics.categories.tasks)} />
              <MetricRow label="analytics" value={String(diagnostics.categories.analytics)} />
              <MetricRow label="snapshot" value={String(diagnostics.analytics.snapshots)} />
              <MetricRow label="daily bucket" value={String(diagnostics.analytics.dailyBuckets)} />
              <MetricRow label="最后同步" value={formatTime(diagnostics.latestSyncedAt)} />
            </View>

            <View style={styles.actions}>
              <ActionButton icon={Copy} label="复制诊断摘要" onPress={shareDiagnostics} />
              <ActionButton icon={RefreshCw} label="重新读取" onPress={load} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type MetricRowProps = {
  label: string;
  value: string;
};

function MetricRow({ label, value }: MetricRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
    </View>
  );
}

type ActionButtonProps = {
  icon: typeof Copy;
  label: string;
  onPress: () => void;
};

function ActionButton({ icon: Icon, label, onPress }: ActionButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <Icon color={theme.text.primary} size={18} strokeWidth={2} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function diagnosticsMessage(diagnostics: OfflineCacheDiagnostics): string {
  return [
    'BlackWave cache diagnostics',
    `available: ${diagnostics.available}`,
    `tenantId: ${diagnostics.identity?.tenantId ?? 'none'}`,
    `userId: ${diagnostics.identity?.userId ?? 'none'}`,
    `totalEntries: ${diagnostics.totalEntries}`,
    `sessions: ${diagnostics.categories.sessions}`,
    `tasks: ${diagnostics.categories.tasks}`,
    `analytics: ${diagnostics.categories.analytics}`,
    `snapshots: ${diagnostics.analytics.snapshots}`,
    `dailyBuckets: ${diagnostics.analytics.dailyBuckets}`,
    `latestSyncedAt: ${formatTime(diagnostics.latestSyncedAt)}`,
  ].join('\n');
}

function formatTime(timestamp: number | null): string {
  if (timestamp === null) return '暂无同步记录';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).formatToParts(timestamp).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { gap: 22, paddingHorizontal: 20, paddingVertical: 24 },
    statusRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    statusIcon: { alignItems: 'center', backgroundColor: theme.background.subtle, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
    statusCopy: { flex: 1, minWidth: 0 },
    statusTitle: { color: theme.text.primary, fontSize: 19, fontWeight: '700', letterSpacing: 0 },
    statusText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 20, marginTop: 5 },
    errorText: { color: theme.status.danger, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
    sectionTitle: { color: theme.text.secondary, fontSize: 13, fontWeight: '600', letterSpacing: 0, marginBottom: 6 },
    metricRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 34 },
    metricLabel: { color: theme.text.secondary, flex: 1, fontSize: 14, letterSpacing: 0 },
    metricValue: { color: theme.text.primary, flex: 1.35, fontSize: 14, fontWeight: '600', letterSpacing: 0, textAlign: 'right' },
    actions: { gap: 10 },
    actionButton: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
    actionText: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    pressed: { opacity: 0.68 },
  });
}
