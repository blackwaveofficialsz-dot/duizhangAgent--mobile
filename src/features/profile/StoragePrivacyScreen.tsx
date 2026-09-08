import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ChevronRight, Database, ShieldCheck, XCircle } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { readRuntimeConfig } from '@/config/env';
import { ApprovalSheet } from '@/features/chat/ApprovalSheet';
import { useAuthStore } from '@/features/auth/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { clearOfflineCache, getOfflineCacheLastSyncedAt } from '@/services/cache/offlineCache';
import { clearLocalAppData } from './localData';

export function StoragePrivacyScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const role = useAuthStore((state) => state.role);
  const { appEnv, enableCacheDiagnostics } = readRuntimeConfig();
  const canShowCacheDiagnostics = role === 'admin' && (appEnv !== 'production' || enableCacheDiagnostics);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>();

  useEffect(() => {
    let mounted = true;
    void getOfflineCacheLastSyncedAt()
      .then((timestamp) => { if (mounted) setLastSyncedAt(timestamp); })
      .catch(() => { if (mounted) setLastSyncedAt(null); });
    return () => { mounted = false; };
  }, []);

  const clearCache = async () => {
    setConfirmingClear(false);
    clearLocalAppData();
    try {
      await clearOfflineCache();
      setLastSyncedAt(null);
      showToast('本地缓存已清理', 'success');
    } catch {
      showToast('离线缓存清理失败，请重试', 'error');
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>本地存储</Text>
          <View style={styles.detailRow}>
            <Database color={theme.text.secondary} size={20} strokeWidth={2} />
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>可清理范围</Text>
              <Text style={styles.detailText}>只保存当前账号已查看的会话、任务和经营分析结果；不同门店、日期和筛选条件分别保存。</Text>
              <Text style={styles.syncTime}>{lastSyncLabel(lastSyncedAt)}</Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="清理本地缓存"
            accessibilityRole="button"
            onPress={() => setConfirmingClear(true)}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <XCircle color={theme.status.danger} size={19} strokeWidth={2} />
            <Text style={styles.clearText}>清理本地缓存</Text>
          </Pressable>
          {canShowCacheDiagnostics ? (
            <InfoEntry icon={Database} label="本地缓存诊断" onPress={() => router.push('/profile/cache-diagnostics' as never)} />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>隐私与关于</Text>
          <InfoEntry icon={ShieldCheck} label="隐私政策" onPress={() => router.push('/profile/privacy-policy')} />
          <InfoEntry icon={ShieldCheck} label="用户协议" onPress={() => router.push('/profile/user-agreement')} />
          <InfoEntry icon={ShieldCheck} label="第三方 SDK 清单" onPress={() => router.push('/profile/third-party-sdks')} />
          <InfoEntry icon={ShieldCheck} label="账户删除申请" onPress={() => router.push('/profile/account-deletion')} />
          <Text style={styles.accountDeletionNotice}>账户删除需提交申请并核验身份，客户端不会直接删除服务器账户。</Text>
          <Text style={styles.version}>BlackWave 寰澜 {Constants.expoConfig?.version ?? '开发构建'}</Text>
        </View>
      </ScrollView>

      <ApprovalSheet
        approval={confirmingClear ? {
          action: '清理本地缓存',
          description: '将删除本机业务缓存和临时文件，不影响服务器中的任务、对话和账户数据。',
          sourceSessionId: 'profile',
          turnId: 'profile-clear-cache',
        } : null}
        isStreaming={false}
        onApprove={clearCache}
        onCancel={() => setConfirmingClear(false)}
      />
    </SafeAreaView>
  );
}

type InfoEntryProps = {
  icon: typeof ShieldCheck;
  label: string;
  onPress: () => void;
};

function InfoEntry({ icon: Icon, label, onPress }: InfoEntryProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.infoEntry, pressed && styles.pressed]}
    >
      <Icon color={theme.text.secondary} size={20} strokeWidth={2} />
      <Text style={styles.infoLabel}>{label}</Text>
      <ChevronRight color={theme.text.muted} size={18} strokeWidth={2} />
    </Pressable>
  );
}

function lastSyncLabel(timestamp: number | null | undefined): string {
  if (timestamp === undefined) return '最后同步：读取中';
  if (timestamp === null) return '最后同步：暂无同步记录';
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
  return `最后同步：${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { gap: 28, paddingHorizontal: 20, paddingVertical: 24 },
    section: { borderColor: theme.border.default,  },
    sectionTitle: { color: theme.text.secondary, fontSize: 13, fontWeight: '600', letterSpacing: 0, paddingBottom: 9, paddingTop: 14 },
    detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, paddingVertical: 8 },
    detailCopy: { flex: 1, minWidth: 0 },
    detailLabel: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    detailText: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 21, marginTop: 4 },
    syncTime: { color: theme.text.muted, fontSize: 13, letterSpacing: 0, marginTop: 7 },
    clearButton: { alignItems: 'center', borderColor: theme.status.danger, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 16, minHeight: 48, paddingHorizontal: 16 },
    clearText: { color: theme.status.danger, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    infoEntry: { alignItems: 'center', borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 56, paddingHorizontal: 2 },
    infoLabel: { color: theme.text.primary, flex: 1, fontSize: 16, letterSpacing: 0 },
    accountDeletionNotice: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 20, paddingBottom: 16, paddingTop: 10 },
    version: { color: theme.text.muted, fontSize: 13, letterSpacing: 0, paddingVertical: 16 },
    pressed: { opacity: 0.68 },
  });
}
