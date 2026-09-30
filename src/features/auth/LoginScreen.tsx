import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { showToast } from '@/components/feedback/AppToast';
import type { ApiHttpError } from '@/services/api/client';
import type { IdentifierType } from '@/services/api/auth';
import {
  AuthField,
  AuthScreen,
  ChoiceRow,
  InlineNotice,
  LinkButton,
  PasswordField,
  PrimaryButton,
} from './AuthForm';
import { useAuthCapabilities } from './useAuthCapabilities';
import { isAuthActionCancelledError, useAuthStore } from './authStore';
import { VerificationFields } from './VerificationFields';

type LoginMode = 'password' | 'code';

export function LoginScreen() {
  const router = useRouter();
  const capabilities = useAuthCapabilities();
  const { clearError, loginWithCode, loginWithPassword, status } = useAuthStore();
  const [mode, setMode] = useState<LoginMode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [target, setTarget] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unregistered, setUnregistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const codeLoginEnabled = capabilities.status === 'ready'
    && Boolean(capabilities.capabilities?.verificationEnabled)
    && Boolean(capabilities.capabilities?.codeLoginEnabled);
  const resetEnabled = capabilities.status === 'ready' && Boolean(capabilities.capabilities?.passwordResetEnabled);
  const interactionLocked = submitting || status === 'signingIn' || status === 'signingOut';
  const passwordDisabled = interactionLocked || !identifier.trim() || !password;

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    if (capabilities.status === 'error') showToast('验证码登录服务暂不可用', 'error');
  }, [capabilities.status]);

  const clearSecrets = () => {
    setIdentifier('');
    setPassword('');
    setPasswordVisible(false);
    setTarget('');
    setVerificationToken(null);
    setMessage(null);
    setUnregistered(false);
    clearError();
  };

  const navigate = (path: '/(auth)/register' | '/(auth)/reset-password') => {
    if (interactionLocked) return;
    clearSecrets();
    router.replace(path);
  };

  const switchMode = (next: LoginMode) => {
    if (next === mode) return;
    clearSecrets();
    setMode(next);
  };

  const submitPassword = async () => {
    if (passwordDisabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const account = inferPasswordIdentifier(identifier);
      await loginWithPassword(account.type, account.identifier, password);
      if (!mountedRef.current) return;
      clearSecrets();
      showToast('登录成功', 'success');
      router.replace('/(app)/(tabs)/analytics');
    } catch (error) {
      if (!mountedRef.current || isAuthActionCancelledError(error)) return;
      setMessage(error instanceof Error ? error.message : '登录失败，请稍后重试');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const submitCode = async (token: string) => {
    if (submittingRef.current) return;
    setVerificationToken(token);
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      await loginWithCode(token);
      if (!mountedRef.current) return;
      clearSecrets();
      showToast('登录成功', 'success');
      router.replace('/(app)/(tabs)/analytics');
    } catch (error) {
      if (!mountedRef.current || isAuthActionCancelledError(error)) return;
      setVerificationToken(null);
      setTarget('');
      setMessage(error instanceof Error ? error.message : '登录失败，请稍后重试');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const handleVerificationError = (error: ApiHttpError) => {
    if (error.code === 'contact_not_registered') {
      setMessage('该联系方式尚未注册');
      setUnregistered(true);
    }
  };

  return (
    <AuthScreen title="登录">
      {codeLoginEnabled ? (
        <ChoiceRow
          disabled={interactionLocked}
          label="登录方式"
          onChange={switchMode}
          options={[
            { label: '密码登录', value: 'password' },
            { label: '验证码登录', value: 'code' },
          ]}
          value={mode}
        />
      ) : null}

      {message ? <InlineNotice message={message} onClose={() => { setMessage(null); setUnregistered(false); clearError(); }} /> : null}

      {mode === 'password' ? (
        <>
          <AuthField
            autoCapitalize="none"
            autoComplete="username"
            keyboardType="default"
            label="账号"
            editable={!interactionLocked}
            onChangeText={setIdentifier}
            placeholder="请输入用户名/手机号/邮箱"
            returnKeyType="next"
            textContentType="username"
            value={identifier}
          />
          <PasswordField
            autoComplete="current-password"
            disabled={interactionLocked}
            label="密码"
            onChangeText={setPassword}
            onSubmitEditing={() => { void submitPassword(); }}
            onToggle={() => setPasswordVisible((visible) => !visible)}
            placeholder="请输入密码"
            returnKeyType="go"
            textContentType="password"
            value={password}
            visible={passwordVisible}
          />
          <PrimaryButton disabled={passwordDisabled} label="登录" loading={submitting} onPress={() => { void submitPassword(); }} />
          {resetEnabled ? <LinkButton disabled={interactionLocked} label="忘记密码" onPress={() => navigate('/(auth)/reset-password')} /> : null}
        </>
      ) : (
        <>
          <VerificationFields
            channel="auto"
            confirmButtonLabel="登录"
            confirmButtonVariant="primary"
            confirmLoading={submitting && Boolean(verificationToken)}
            disabled={interactionLocked}
            onError={handleVerificationError}
            onReset={() => setVerificationToken(null)}
            onTargetChange={(value) => { setTarget(value); setVerificationToken(null); setMessage(null); setUnregistered(false); }}
            onVerified={(token) => { void submitCode(token); }}
            purpose="login"
            target={target}
          />
          {unregistered ? <LinkButton disabled={interactionLocked} label="使用邀请码注册" onPress={() => navigate('/(auth)/register')} /> : null}
        </>
      )}

      {!unregistered ? <LinkButton disabled={interactionLocked} label="使用邀请码注册" onPress={() => navigate('/(auth)/register')} /> : null}
    </AuthScreen>
  );
}

function inferPasswordIdentifier(identifier: string): { type: IdentifierType; identifier: string } {
  const value = identifier.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { type: 'email', identifier: value };
  const phone = normalizeMainlandPhone(value);
  if (phone) return { type: 'phone', identifier: phone };
  return { type: 'username', identifier: value };
}

function normalizeMainlandPhone(value: string): string | null {
  let phone = value.replace(/[\s()\-]/g, '');
  if (phone.startsWith('0086')) phone = phone.slice(4);
  else if (phone.startsWith('+86')) phone = phone.slice(3);
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}
