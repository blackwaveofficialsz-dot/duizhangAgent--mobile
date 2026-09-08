import { Database, Globe2, ListChecks, LogOut, ShieldCheck } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { ApprovalSheet } from '@/features/chat/ApprovalSheet';
import { useAuthStore } from '@/features/auth/authStore';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type ProfileEntryProps = {
  description: string;
  icon: typeof Globe2;
  label: string;
  onPress: () => void;
};

export function ProfileScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const username = useAuthStore((state) => state.username);
  const tenantId = useAuthStore((state) => state.tenantId);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const confirmLogout = async () => {
    setConfirmingLogout(false);
    try {
      await logout();
      showToast('已退出登录', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '退出清理失败，请重新启动应用', 'error');
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={styles.avatar}><ShieldCheck color={theme.text.primary} size={25} strokeWidth={2} /></View>
          <View style={styles.identityCopy}>
            <Text numberOfLines={1} style={styles.username}>{username ?? '当前用户'}</Text>
            <Text numberOfLines={1} style={styles.role}>{roleLabel(role)}</Text>
            <Text numberOfLines={1} style={styles.tenant}>{tenantId ?? '未关联租户'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>账户</Text>
          <ProfileEntry
            description="邮箱、手机号与登录方式"
            icon={ShieldCheck}
            label="账号与安全"
            onPress={() => router.push('/profile/account-security')}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>偏好设置</Text>
          <ProfileEntry
            description="跟随系统、浅色或深色"
            icon={Globe2}
            label="外观设置"
            onPress={() => router.push('/profile/appearance')}
          />
          <ProfileEntry
            description="任务状态提醒"
            icon={ListChecks}
            label="通知设置"
            onPress={() => router.push('/profile/notifications')}
          />
          <ProfileEntry
            description="缓存、隐私与账户说明"
            icon={Database}
            label="存储、隐私与关于"
            onPress={() => router.push('/profile/storage-privacy')}
          />
        </View>

        <Pressable
          accessibilityLabel="退出登录"
          accessibilityRole="button"
          onPress={() => setConfirmingLogout(true)}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        >
          <LogOut color={theme.status.danger} size={20} strokeWidth={2} />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </ScrollView>

      <ApprovalSheet
        approval={confirmingLogout ? {
          action: '退出登录',
          description: '退出后将清除登录凭证、本地业务缓存和临时文件，需要重新登录后才能继续使用。',
          sourceSessionId: tenantId ?? 'profile',
          turnId: 'profile-logout',
        } : null}
        isStreaming={false}
        onApprove={confirmLogout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </SafeAreaView>
  );
}

function ProfileEntry({ description, icon: Icon, label, onPress }: ProfileEntryProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <Icon color={theme.text.secondary} size={20} strokeWidth={2} />
      <View style={styles.entryCopy}>
        <Text style={styles.entryLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.entryDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

function roleLabel(role: string | null): string {
  if (role === 'admin') return '管理员';
  if (role === 'member') return '成员';
  return role || '未分配角色';
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { gap: 28, paddingHorizontal: 20, paddingVertical: 24 },
    identity: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    avatar: { alignItems: 'center', backgroundColor: theme.background.subtle, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
    identityCopy: { flex: 1, minWidth: 0 },
    username: { color: theme.text.primary, fontSize: 20, fontWeight: '700', letterSpacing: 0 },
    role: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, marginTop: 3 },
    tenant: { color: theme.text.muted, fontSize: 13, letterSpacing: 0, marginTop: 4 },
    section: { borderBottomColor: theme.border.default},
    sectionTitle: { color: theme.text.secondary, fontSize: 13, fontWeight: '600', letterSpacing: 0, paddingBottom: 9, paddingTop: 14 },
    entry: { alignItems: 'center', borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 68, paddingHorizontal: 2 },
    entryCopy: { flex: 1, minWidth: 0 },
    entryLabel: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    entryDescription: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 3 },
    logout: { alignItems: 'center', borderColor: theme.status.danger, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 16 },
    logoutText: { color: theme.status.danger, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    pressed: { opacity: 0.68 },
  });
}
