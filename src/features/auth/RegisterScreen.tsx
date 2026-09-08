import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { showToast } from '@/components/feedback/AppToast';
import type { ApiHttpError } from '@/services/api/client';
import {
  AuthErrorText,
  AuthField,
  AuthHelperText,
  AuthScreen,
  ChoiceRow,
  InlineNotice,
  LinkButton,
  PasswordField,
  PasswordStrengthHint,
  PrimaryButton,
  VerifiedHint,
  channelOptions,
} from './AuthForm';
import { isAuthActionCancelledError, useAuthStore } from './authStore';
import { isPasswordLengthValid } from './passwordPolicy';
import { VerificationFields } from './VerificationFields';
import type { VerificationChannel } from './useVerificationFlow';

export function RegisterScreen() {
  const router = useRouter();
  const { register, status } = useAuthStore();
  const [inviteToken, setInviteToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [channel, setChannel] = useState<VerificationChannel>('email');
  const [target, setTarget] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const normalizedInviteToken = inviteToken.trim();
  const normalizedUsername = username.trim();
  const interactionLocked = submitting || status === 'signingIn' || status === 'signingOut';
  const passwordValidationMessage = getPasswordValidationMessage(password, confirmPassword, normalizedUsername);
  const passwordValid = !passwordValidationMessage && Boolean(password);
  const disabled = interactionLocked
    || !normalizedInviteToken
    || !normalizedUsername
    || !passwordValid
    || !verificationToken;

  useEffect(() => () => { mountedRef.current = false; }, []);

  const clearVerification = () => {
    setVerificationToken(null);
    setMessage(null);
    setAlreadyRegistered(false);
  };

  const clearAll = () => {
    setInviteToken('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmVisible(false);
    setChannel('email');
    setTarget('');
    clearVerification();
  };

  const goToLogin = () => {
    if (interactionLocked) return;
    clearAll();
    router.replace('/(auth)/login');
  };

  const handleVerificationError = (error: ApiHttpError) => {
    if (error.code === 'contact_already_registered') {
      setMessage('该联系方式已注册，请登录');
      setAlreadyRegistered(true);
    }
  };

  const submit = async () => {
    if (disabled || submittingRef.current || !verificationToken) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      await register(normalizedUsername, password, normalizedInviteToken, verificationToken);
      if (!mountedRef.current) return;
      clearAll();
      showToast('注册成功', 'success');
      router.replace('/(app)/(tabs)/analytics');
    } catch (error) {
      if (!mountedRef.current || isAuthActionCancelledError(error)) return;
      const errorMessage = error instanceof Error ? error.message : '注册失败，请稍后重试';
      if (isApiError(error, 'contact_already_registered')) {
        setMessage('该联系方式已注册，请登录');
        setAlreadyRegistered(true);
      } else {
        setAlreadyRegistered(false);
        showToast(errorMessage, 'error');
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <AuthScreen title="邀请注册">
      {message ? <InlineNotice message={message} onClose={() => { setMessage(null); setAlreadyRegistered(false); }} /> : null}
      <AuthHelperText message="请输入管理员在用户管理中生成的注册邀请码。租户加入码不能用于注册。" />
      <AuthField
        autoCapitalize="none"
        editable={!interactionLocked}
        label="注册邀请码"
        onChangeText={(value) => {
          setInviteToken(value);
          if (value.trim() !== normalizedInviteToken) clearVerification();
        }}
        placeholder="请输入注册邀请码"
        value={inviteToken}
      />
      <AuthField
        autoCapitalize="none"
        autoComplete="username"
        editable={!interactionLocked}
        label="用户名"
        onChangeText={setUsername}
        placeholder="请输入用户名"
        value={username}
      />
      <PasswordField
        disabled={interactionLocked}
        label="密码"
        onChangeText={setPassword}
        onToggle={() => setPasswordVisible((visible) => !visible)}
        placeholder="请输入 7 至 16 个字符"
        value={password}
        visible={passwordVisible}
      />
      <PasswordStrengthHint password={password} />
      <PasswordField
        disabled={interactionLocked}
        label="确认密码"
        onChangeText={setConfirmPassword}
        onToggle={() => setConfirmVisible((visible) => !visible)}
        placeholder="请再次输入密码"
        value={confirmPassword}
        visible={confirmVisible}
      />
      {passwordValidationMessage ? <AuthErrorText message={passwordValidationMessage} /> : null}
      <ChoiceRow
        disabled={interactionLocked}
        label="验证渠道"
        onChange={(next) => { setChannel(next); setTarget(''); clearVerification(); }}
        options={channelOptions}
        value={channel}
      />
      <VerificationFields
        channel={channel}
        disabled={interactionLocked}
        inviteToken={normalizedInviteToken}
        onError={handleVerificationError}
        onReset={clearVerification}
        onTargetChange={(value) => { setTarget(value); clearVerification(); }}
        onVerified={(token) => { setVerificationToken(token); setMessage(null); setAlreadyRegistered(false); }}
        purpose="register"
        target={target}
      />
      {verificationToken ? <VerifiedHint /> : null}
      <PrimaryButton disabled={disabled} label="注册" loading={submitting} onPress={() => { void submit(); }} />
      <LinkButton disabled={interactionLocked} label={alreadyRegistered ? '返回登录' : '已有账号？返回登录'} onPress={goToLogin} />
    </AuthScreen>
  );
}

function isApiError(error: unknown, code: string): error is ApiHttpError {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function getPasswordValidationMessage(password: string, confirmPassword: string, username: string): string | null {
  if (!password && !confirmPassword) return null;
  if (!isPasswordLengthValid(password)) return '密码长度必须为 7 至 16 个字符';
  if (username && password === username) return '密码不能与用户名相同';
  if (confirmPassword && password !== confirmPassword) return '两次输入的密码不一致';
  return null;
}
