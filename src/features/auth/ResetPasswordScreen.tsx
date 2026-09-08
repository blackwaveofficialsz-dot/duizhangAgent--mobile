import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { showToast } from '@/components/feedback/AppToast';
import type { ApiHttpError } from '@/services/api/client';
import {
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

export function ResetPasswordScreen() {
  const router = useRouter();
  const { resetPassword, status } = useAuthStore();
  const [channel, setChannel] = useState<VerificationChannel>('email');
  const [target, setTarget] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unregistered, setUnregistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const interactionLocked = submitting || status === 'signingIn' || status === 'signingOut';
  const passwordValid = isPasswordLengthValid(password) && password === confirmPassword;
  const disabled = interactionLocked || !verificationToken || !passwordValid;

  useEffect(() => () => { mountedRef.current = false; }, []);

  const clearVerification = () => {
    setVerificationToken(null);
    setPassword('');
    setConfirmPassword('');
    setPasswordVisible(false);
    setConfirmVisible(false);
    setMessage(null);
    setUnregistered(false);
  };

  const clearAll = () => {
    setChannel('email');
    setTarget('');
    clearVerification();
  };

  const navigate = (path: '/(auth)/login' | '/(auth)/register') => {
    if (interactionLocked) return;
    clearAll();
    router.replace(path);
  };

  const handleVerificationError = (error: ApiHttpError) => {
    if (error.code === 'contact_not_registered') {
      setMessage('该联系方式尚未注册');
      setUnregistered(true);
    }
  };

  const submit = async () => {
    if (disabled || submittingRef.current || !verificationToken) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await resetPassword(verificationToken, password);
      if (!mountedRef.current) return;
      clearAll();
      if (result.cleanupWarning) {
        showToast(`密码重置成功，请重新登录；但本地缓存清理未完成：${result.cleanupWarning}`, 'error');
      } else {
        showToast('密码重置成功，请重新登录', 'success');
      }
      router.replace('/(auth)/login');
    } catch (error) {
      if (!mountedRef.current || isAuthActionCancelledError(error)) return;
      setMessage(error instanceof Error ? error.message : '密码重置失败，请稍后重试');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <AuthScreen title="重置密码">
      {message ? <InlineNotice message={message} onClose={() => { setMessage(null); setUnregistered(false); }} /> : null}
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
        onError={handleVerificationError}
        onReset={clearVerification}
        onTargetChange={(value) => { setTarget(value); clearVerification(); }}
        onVerified={(token) => { setVerificationToken(token); setMessage(null); setUnregistered(false); }}
        purpose="reset_password"
        target={target}
      />
      {verificationToken ? (
        <>
          <VerifiedHint />
          <PasswordField
            disabled={interactionLocked}
            label="新密码"
            onChangeText={setPassword}
            onToggle={() => setPasswordVisible((visible) => !visible)}
            placeholder="请输入 7 至 16 个字符"
            toggleLabel="新密码"
            value={password}
            visible={passwordVisible}
          />
          <PasswordStrengthHint password={password} />
          <PasswordField
            disabled={interactionLocked}
            label="确认新密码"
            onChangeText={setConfirmPassword}
            onToggle={() => setConfirmVisible((visible) => !visible)}
            placeholder="请再次输入新密码"
            toggleLabel="确认新密码"
            value={confirmPassword}
            visible={confirmVisible}
          />
          <PrimaryButton disabled={disabled} label="重置密码" loading={submitting} onPress={() => { void submit(); }} />
        </>
      ) : null}
      {unregistered ? <LinkButton disabled={interactionLocked} label="使用邀请码注册" onPress={() => navigate('/(auth)/register')} /> : null}
      <LinkButton disabled={interactionLocked} label="返回登录" onPress={() => navigate('/(auth)/login')} />
    </AuthScreen>
  );
}
