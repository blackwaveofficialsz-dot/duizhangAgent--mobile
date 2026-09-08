import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { showToast } from '@/components/feedback/AppToast';
import {
  InlineNotice,
  PasswordField,
  PrimaryButton,
  VerifiedHint,
} from '@/features/auth/AuthForm';
import { VerificationFields } from '@/features/auth/VerificationFields';
import { useAuthCapabilities } from '@/features/auth/useAuthCapabilities';
import { useAuthStore } from '@/features/auth/authStore';
import {
  getContactStatus,
  updateContact,
  type ContactStatus,
} from '@/services/api/auth';
import type { ApiHttpError } from '@/services/api/client';
import { getAccessTokenSnapshot } from '@/services/auth/accessToken';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type Channel = 'email' | 'sms';
type Operation = { channel: Channel; mode: 'bind' | 'change' };
type ContactLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; contacts: ContactStatus };

export function AccountSecurityScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const capabilities = useAuthCapabilities();
  const authStatus = useAuthStore((state) => state.status);
  const [contactState, setContactState] = useState<ContactLoadState>({ status: 'loading' });
  const [operation, setOperation] = useState<Operation | null>(null);
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const contactGenerationRef = useRef(0);
  const submittingRef = useRef(false);
  const enabled = capabilities.status === 'ready'
    && Boolean(capabilities.capabilities?.contactManagementEnabled);
  const interactionLocked = verificationBusy
    || submitting
    || authStatus === 'signingIn'
    || authStatus === 'signingOut';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      contactGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const generation = ++contactGenerationRef.current;
    setContactState({ status: 'loading' });
    void getContactStatus().then(
      (nextContacts) => {
        if (mountedRef.current && generation === contactGenerationRef.current) {
          setContactState({ status: 'ready', contacts: nextContacts });
        }
      },
      (error) => {
        if (
          mountedRef.current
          && generation === contactGenerationRef.current
          && !isUnauthorized(error)
        ) {
          setContactState({
            status: 'error',
            message: error instanceof Error ? error.message : '联系方式状态加载失败',
          });
        }
      },
    );
    return () => {
      if (generation === contactGenerationRef.current) contactGenerationRef.current += 1;
    };
  }, [enabled]);

  const clearForm = () => {
    setOperation(null);
    setTarget('');
    setPassword('');
    setPasswordVisible(false);
    setVerificationToken(null);
    setVerificationBusy(false);
    setMessage(null);
  };

  const begin = (channel: Channel, mode: Operation['mode']) => {
    if (interactionLocked) return;
    setOperation({ channel, mode });
    setTarget('');
    setPassword('');
    setPasswordVisible(false);
    setVerificationToken(null);
    setMessage(null);
  };

  const handleVerificationBusy = useCallback((busy: boolean) => {
    if (mountedRef.current) setVerificationBusy(busy);
  }, []);

  const handleVerificationError = (error: ApiHttpError) => {
    if (error.code === 'contact_already_registered') setMessage('该联系方式已注册');
  };

  const submit = async () => {
    if (!operation || !verificationToken || !password || interactionLocked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const accessTokenSnapshot = getAccessTokenSnapshot();
      const result = await updateContact(operation.mode, password, verificationToken);
      if (!useAuthStore.getState().refreshSession(result, accessTokenSnapshot)) return;
      if (!mountedRef.current) return;
      contactGenerationRef.current += 1;
      setContactState({ status: 'ready', contacts: result.contact });
      clearForm();
      showToast(result.message, 'success');
    } catch (error) {
      if (!mountedRef.current || isUnauthorized(error)) return;
      setMessage(error instanceof Error ? error.message : '联系方式更新失败，请稍后重试');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (capabilities.status === 'loading') {
    return (
      <Page styles={styles}>
        <View style={styles.loading}>
          <ActivityIndicator
            accessibilityLabel="正在读取账号安全设置"
            accessibilityRole="progressbar"
            color={theme.text.secondary}
          />
          <Text style={styles.secondary}>正在读取账号安全设置…</Text>
        </View>
      </Page>
    );
  }

  if (!enabled) {
    return <Page styles={styles}><Text style={styles.secondary}>联系方式管理暂未开放</Text></Page>;
  }

  if (contactState.status === 'loading') {
    return (
      <Page styles={styles}>
        <Text style={styles.description}>管理用于登录和验证身份的邮箱与手机号。</Text>
        <View style={styles.loading}>
          <ActivityIndicator
            accessibilityLabel="正在读取联系方式"
            accessibilityRole="progressbar"
            color={theme.text.secondary}
          />
          <Text style={styles.secondary}>正在读取联系方式…</Text>
        </View>
      </Page>
    );
  }

  if (contactState.status === 'error') {
    return (
      <Page styles={styles}>
        <Text style={styles.description}>管理用于登录和验证身份的邮箱与手机号。</Text>
        <InlineNotice message={contactState.message} />
      </Page>
    );
  }

  const contacts = contactState.contacts;

  const emailMode = contacts.email.bound ? 'change' : 'bind';
  const phoneMode = contacts.phone.bound ? 'change' : 'bind';

  return (
    <Page styles={styles}>
      <Text style={styles.description}>管理用于登录和验证身份的邮箱与手机号。</Text>
      <View style={styles.contacts}>
        <ContactRow
          actionLabel={`${emailMode === 'bind' ? '绑定' : '更换'}邮箱`}
          disabled={interactionLocked}
          label="邮箱"
          onPress={() => begin('email', emailMode)}
          status={contacts.email.bound ? contacts.email.masked : '未绑定'}
          styles={styles}
          verified={contacts.email.bound ? contacts.email.verified : null}
        />
        <ContactRow
          actionLabel={`${phoneMode === 'bind' ? '绑定' : '更换'}手机号`}
          disabled={interactionLocked}
          label="手机号"
          onPress={() => begin('sms', phoneMode)}
          status={contacts.phone.bound ? contacts.phone.masked : '未绑定'}
          styles={styles}
          verified={contacts.phone.bound ? contacts.phone.verified : null}
        />
        <ContactRow
          actionLabel="修改密码"
          disabled={interactionLocked}
          label="密码"
          onPress={() => router.push('/profile/change-password' as never)}
          status="用于保护账号登录"
          styles={styles}
          verified={null}
        />
      </View>

      {operation ? (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.formTitle}>
            {operation.mode === 'bind' ? '绑定' : '更换'}{operation.channel === 'email' ? '邮箱' : '手机号'}
          </Text>
          {message ? <InlineNotice message={message} onClose={() => setMessage(null)} /> : null}
          <VerificationFields
            channel={operation.channel}
            disabled={submitting}
            onBusyChange={handleVerificationBusy}
            onError={handleVerificationError}
            onReset={() => { setVerificationToken(null); setMessage(null); }}
            onTargetChange={(value) => {
              setTarget(value);
              setVerificationToken(null);
              setMessage(null);
            }}
            onVerified={(token) => {
              setVerificationToken(token);
              setMessage(null);
            }}
            purpose={operation.mode === 'bind' ? 'bind_contact' : 'change_contact'}
            target={target}
          />
          {verificationToken ? <VerifiedHint /> : null}
          <PasswordField
            autoComplete="current-password"
            disabled={interactionLocked}
            label="当前密码"
            onChangeText={setPassword}
            onToggle={() => setPasswordVisible((visible) => !visible)}
            placeholder="请输入当前密码"
            value={password}
            visible={passwordVisible}
          />
          <PrimaryButton
            disabled={interactionLocked || !verificationToken || !password}
            label={operation.mode === 'bind' ? '确认绑定' : '确认更换'}
            loading={submitting}
            onPress={() => { void submit(); }}
          />
        </View>
      ) : message ? <InlineNotice message={message} onClose={() => setMessage(null)} /> : null}
    </Page>
  );
}

function Page({ children, styles }: { children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function ContactRow({ actionLabel, disabled, label, onPress, status, styles, verified }: {
  actionLabel: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
  status: string;
  styles: ReturnType<typeof createStyles>;
  verified: boolean | null;
}) {
  return (
    <View style={styles.contactRow}>
      <View style={styles.contactCopy}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.secondary}>{status}</Text>
        {verified === null ? null : (
          <Text style={verified ? styles.verified : styles.secondary}>
            {verified ? '已验证' : '未验证'}
          </Text>
        )}
      </View>
      <PrimaryButton disabled={disabled} label={actionLabel} onPress={onPress} />
    </View>
  );
}

function isUnauthorized(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401);
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { gap: 24, paddingHorizontal: 20, paddingVertical: 24 },
    description: { color: theme.text.secondary, fontSize: 16, lineHeight: 24 },
    loading: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 44 },
    secondary: { color: theme.text.secondary, fontSize: 16, lineHeight: 24 },
    contacts: { borderBottomColor: theme.border.default },
    contactRow: { alignItems: 'center', borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 16, minHeight: 76, paddingVertical: 12 },
    contactCopy: { flex: 1, gap: 4, minWidth: 0 },
    contactLabel: { color: theme.text.primary, fontSize: 16, fontWeight: '600' },
    verified: { color: theme.status.success, fontSize: 16, lineHeight: 24 },
    form: { gap: 20 },
    formTitle: { color: theme.text.primary, fontSize: 20, fontWeight: '700' },
  });
}
