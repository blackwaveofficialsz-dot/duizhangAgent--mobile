import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { showToast } from '@/components/feedback/AppToast';
import {
  InlineNotice,
  PasswordField,
  PasswordStrengthHint,
  PrimaryButton,
} from '@/features/auth/AuthForm';
import { isPasswordLengthValid } from '@/features/auth/passwordPolicy';
import { useAuthStore } from '@/features/auth/authStore';
import { changePassword } from '@/services/api/auth';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export function ChangePasswordScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const authStatus = useAuthStore((state) => state.status);
  const logout = useAuthStore((state) => state.logout);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentVisible, setCurrentVisible] = useState(false);
  const [newVisible, setNewVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const interactionLocked = submitting || authStatus === 'signingIn' || authStatus === 'signingOut';
  const newPasswordLengthValid = isPasswordLengthValid(newPassword);
  const disabled = interactionLocked
    || !currentPassword
    || !newPasswordLengthValid
    || !confirmPassword;

  const submit = async () => {
    if (disabled || submittingRef.current) return;
    if (newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await logout({ remote: false });
      showToast('密码修改成功，请重新登录', 'success');
      router.replace('/(auth)/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码修改失败，请稍后重试');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.description}>修改登录密码后，当前设备需要重新登录。</Text>
        <View style={styles.form}>
          {message ? <InlineNotice message={message} onClose={() => setMessage(null)} /> : null}
          <PasswordField
            autoComplete="current-password"
            disabled={interactionLocked}
            label="当前密码"
            onChangeText={setCurrentPassword}
            onToggle={() => setCurrentVisible((visible) => !visible)}
            placeholder="请输入当前密码"
            value={currentPassword}
            visible={currentVisible}
          />
          <PasswordField
            autoComplete="new-password"
            disabled={interactionLocked}
            label="新密码"
            onChangeText={setNewPassword}
            onToggle={() => setNewVisible((visible) => !visible)}
            placeholder="7 至 16 个字符"
            value={newPassword}
            visible={newVisible}
          />
          <PasswordStrengthHint password={newPassword} />
          <PasswordField
            autoComplete="new-password"
            disabled={interactionLocked}
            label="确认新密码"
            onChangeText={setConfirmPassword}
            onToggle={() => setConfirmVisible((visible) => !visible)}
            placeholder="再次输入新密码"
            value={confirmPassword}
            visible={confirmVisible}
          />
          <PrimaryButton
            disabled={disabled}
            label="修改密码"
            loading={submitting}
            onPress={() => { void submit(); }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { gap: 24, paddingHorizontal: 20, paddingVertical: 24 },
    description: { color: theme.text.secondary, fontSize: 16, lineHeight: 24 },
    form: { gap: 20 },
  });
}
