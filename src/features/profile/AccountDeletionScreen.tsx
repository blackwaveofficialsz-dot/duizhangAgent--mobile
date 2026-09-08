import * as Linking from 'expo-linking';
import { Send } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showToast } from '@/components/feedback/AppToast';
import { useAuthStore } from '@/features/auth/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export function AccountDeletionScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [opening, setOpening] = useState(false);
  const tenantId = useAuthStore((state) => state.tenantId);
  const userId = useAuthStore((state) => state.userId);
  const username = useAuthStore((state) => state.username);

  const openRequestEmail = async () => {
    setOpening(true);
    try {
      await Linking.openURL(deletionRequestMailto({ tenantId, userId, username }));
    } catch {
      showToast('无法打开邮件应用，请联系所属租户管理员', 'error');
    } finally {
      setOpening(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.notice}>提交申请不会立即删除账户。</Text>
        <Text style={styles.body}>系统会先核验申请人身份、账号归属和需要保留的财务或审计数据，再由服务端管理员处理。客户端不会直接删除数据库账号。</Text>
        <Text style={styles.body}>点击下方按钮会打开系统邮件应用并预填当前账号信息。请补充所属租户管理员或客服收件地址后发送；邮件发出仅表示申请已提交，不代表删除已经完成。</Text>
        <Pressable
          accessibilityLabel="撰写删除申请邮件"
          accessibilityRole="button"
          accessibilityState={{ disabled: opening }}
          disabled={opening}
          onPress={openRequestEmail}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, opening && styles.disabled]}
        >
          <Send color={theme.action.onPrimary} size={19} strokeWidth={2} />
          <Text style={styles.buttonText}>{opening ? '正在打开邮件应用' : '撰写删除申请邮件'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function deletionRequestMailto(identity: {
  tenantId: string | null;
  userId: string | null;
  username: string | null;
}): string {
  const subject = encodeURIComponent('BlackWave 寰澜账户删除申请');
  const body = encodeURIComponent([
    '你好，我申请删除 BlackWave 寰澜账户。',
    '',
    `账号：${identity.username ?? '请填写'}`,
    `租户：${identity.tenantId ?? '请填写'}`,
    `用户 ID：${identity.userId ?? '请填写'}`,
    '',
    '请在核验身份后告知处理范围、需保留的数据和预计完成时间。',
  ].join('\n'));
  return `mailto:?subject=${subject}&body=${body}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { paddingBottom: 36, paddingHorizontal: 20, paddingTop: 24 },
    notice: { color: theme.status.warning, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    body: { color: theme.text.secondary, fontSize: 15, letterSpacing: 0, lineHeight: 23, marginTop: 14 },
    button: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 28, minHeight: 48, paddingHorizontal: 16 },
    buttonText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.5 },
  });
}
