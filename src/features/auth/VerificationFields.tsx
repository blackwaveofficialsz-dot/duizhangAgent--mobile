import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { ApiHttpError } from '@/services/api/client';
import type { AppTheme } from '@/theme/tokens';
import { useVerificationFlow } from './useVerificationFlow';
import type { VerificationChannel, VerificationPurpose } from './useVerificationFlow';

type VerificationFieldsProps = {
  channel: VerificationInputChannel;
  confirmButtonLabel?: string;
  confirmButtonVariant?: 'inline' | 'primary';
  confirmLoading?: boolean;
  disabled?: boolean;
  inviteToken?: string;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: ApiHttpError) => void;
  onReset?: () => void;
  onTargetChange: (target: string) => void;
  onVerified: (token: string) => void;
  purpose: VerificationPurpose;
  target: string;
};

type VerificationInputChannel = VerificationChannel | 'auto';

function isContactEligibilityError(error: unknown): error is ApiHttpError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error.code === 'contact_not_registered' || error.code === 'contact_already_registered'),
  );
}

export function VerificationFields({
  channel,
  confirmButtonLabel = '验证验证码',
  confirmButtonVariant = 'inline',
  confirmLoading = false,
  disabled = false,
  inviteToken,
  onBusyChange,
  onError,
  onReset,
  onTargetChange,
  onVerified,
  purpose,
  target,
}: VerificationFieldsProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const resolvedChannel = resolveVerificationChannel(channel, target);
  const flow = useVerificationFlow({ channel: resolvedChannel, inviteToken, purpose, target });
  const verificationInput = `${channel}\u0000${resolvedChannel}\u0000${purpose}\u0000${target}\u0000${inviteToken ?? ''}`;
  const inputRef = useRef(verificationInput);
  const verificationGenerationRef = useRef(0);
  const onBusyChangeRef = useRef(onBusyChange);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  onBusyChangeRef.current = onBusyChange;
  if (inputRef.current !== verificationInput) {
    inputRef.current = verificationInput;
    verificationGenerationRef.current += 1;
  }
  useEffect(() => () => { verificationGenerationRef.current += 1; }, []);
  useEffect(() => {
    setTargetError(null);
    setCodeError(null);
  }, [verificationInput]);
  const busy = flow.phase === 'sending' || flow.phase === 'confirming';
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChangeRef.current?.(false); }, []);
  const inputDisabled = disabled || busy;
  const sendDisabled = disabled || busy || !target.trim() || flow.resendAfter > 0;
  const confirmDisabled = disabled || busy || flow.retryAfter > 0 || !flow.challengeId || !flow.code || flow.phase === 'verified';
  const sendLabel = flow.resendAfter > 0 ? `${flow.resendAfter} 秒后可重发` : '发送验证码';

  const send = async () => {
    const validationError = validateTarget(channel, target);
    if (validationError) {
      setTargetError(validationError);
      return;
    }
    setTargetError(null);
    setCodeError(null);
    onReset?.();
    try {
      await flow.send();
    } catch (error) {
      if (isContactEligibilityError(error)) onError?.(error);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(flow.code)) {
      setCodeError('请输入 6 位数字验证码');
      return;
    }
    setCodeError(null);
    const generation = verificationGenerationRef.current;
    try {
      const token = await flow.confirm(flow.code);
      if (token && verificationGenerationRef.current === generation) onVerified(token);
    } catch (error) {
      if (isContactEligibilityError(error)) onError?.(error);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.label}>邮箱/手机号</Text>
        <View style={styles.inputActionRow} testID="verification-target-row">
          <TextInput
            accessibilityLabel="邮箱/手机号"
            accessibilityState={{ disabled: inputDisabled }}
            autoCapitalize="none"
            autoComplete={getTargetAutoComplete(channel, resolvedChannel)}
            editable={!inputDisabled}
            keyboardType={getTargetKeyboardType(channel, resolvedChannel)}
            onChangeText={(value) => { setTargetError(null); onTargetChange(value); }}
            placeholder={channel === 'auto' ? '请输入手机号/邮箱' : channel === 'email' ? '请输入邮箱' : '请输入手机号'}
            placeholderTextColor={theme.text.muted}
            style={styles.input}
            value={target}
          />
          <Pressable
            accessibilityLabel={sendLabel}
            accessibilityRole="button"
            accessibilityState={{ busy: flow.phase === 'sending', disabled: sendDisabled }}
            disabled={sendDisabled}
            onPress={() => { void send(); }}
            style={({ pressed }) => [styles.button, sendDisabled && styles.disabled, pressed && !sendDisabled && styles.pressed]}
          >
            {flow.phase === 'sending' ? <ActivityIndicator color={theme.action.onPrimary} /> : <Text numberOfLines={1} style={styles.buttonText}>{sendLabel}</Text>}
          </Pressable>
        </View>
        {targetError ? <Text accessibilityRole="alert" style={styles.error}>{targetError}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>验证码</Text>
        <View style={styles.inputActionRow} testID="verification-code-row">
          <TextInput
            accessibilityLabel="验证码"
            accessibilityState={{ disabled: inputDisabled }}
            autoCapitalize="none"
            autoComplete="one-time-code"
            editable={!inputDisabled}
            keyboardType="number-pad"
            onChangeText={(value) => { setCodeError(null); flow.setCode(value); }}
            placeholder="请输入验证码"
            placeholderTextColor={theme.text.muted}
            style={styles.input}
            value={flow.code}
          />
          {confirmButtonVariant === 'inline' ? (
            <Pressable
              accessibilityLabel={confirmButtonLabel}
              accessibilityRole="button"
              accessibilityState={{ busy: flow.phase === 'confirming', disabled: confirmDisabled }}
              disabled={confirmDisabled}
              onPress={() => { void confirm(); }}
              style={({ pressed }) => [styles.button, confirmDisabled && styles.disabled, pressed && !confirmDisabled && styles.pressed]}
            >
              {flow.phase === 'confirming' ? <ActivityIndicator color={theme.action.onPrimary} /> : <Text numberOfLines={1} style={styles.buttonText}>{confirmButtonLabel}</Text>}
            </Pressable>
          ) : null}
        </View>
        {codeError ? <Text accessibilityRole="alert" style={styles.error}>{codeError}</Text> : null}
        {flow.error && !isContactEligibilityError(flow.error)
          ? <Text accessibilityRole="alert" style={styles.error}>{flow.error.message}</Text>
          : null}
      </View>
      {confirmButtonVariant === 'primary' ? (
        <Pressable
          accessibilityLabel={confirmButtonLabel}
          accessibilityRole="button"
          accessibilityState={{ busy: flow.phase === 'confirming' || confirmLoading, disabled: confirmDisabled }}
          disabled={confirmDisabled}
          onPress={() => { void confirm(); }}
          style={({ pressed }) => [styles.primaryButton, confirmDisabled && styles.disabled, pressed && !confirmDisabled && styles.pressed]}
        >
          {flow.phase === 'confirming' || confirmLoading ? <ActivityIndicator color={theme.action.onPrimary} /> : <Text style={styles.primaryButtonText}>{confirmButtonLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

function validateTarget(channel: VerificationInputChannel, target: string): string | null {
  if (channel === 'auto') {
    const value = target.trim();
    return isEmail(value) || normalizeMainlandPhone(value) ? null : '请输入有效的手机号或邮箱';
  }
  if (channel === 'email') {
    return isEmail(target.trim()) ? null : '请输入有效的邮箱地址';
  }
  return normalizeMainlandPhone(target) ? null : '请输入有效的中国大陆手机号';
}

function resolveVerificationChannel(channel: VerificationInputChannel, target: string): VerificationChannel {
  if (channel !== 'auto') return channel;
  return normalizeMainlandPhone(target) ? 'sms' : 'email';
}

function getTargetAutoComplete(channel: VerificationInputChannel, resolvedChannel: VerificationChannel) {
  if (channel === 'auto') return 'off' as const;
  return resolvedChannel === 'email' ? 'email' as const : 'tel' as const;
}

function getTargetKeyboardType(channel: VerificationInputChannel, resolvedChannel: VerificationChannel) {
  if (channel === 'auto') return 'default' as const;
  return resolvedChannel === 'email' ? 'email-address' as const : 'phone-pad' as const;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeMainlandPhone(target: string): string | null {
  let phone = target.trim().replace(/[\s()\-]/g, '');
  if (phone.startsWith('0086')) phone = phone.slice(4);
  else if (phone.startsWith('+86')) phone = phone.slice(3);
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    form: { gap: 16 },
    field: { gap: 8 },
    label: { color: theme.text.primary, fontSize: 16, fontWeight: '600' },
    inputActionRow: { flexDirection: 'row', gap: 8 },
    input: {
      flex: 1,
      height: 52,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 8,
      backgroundColor: theme.background.surface,
      color: theme.text.primary,
      fontSize: 16,
      paddingHorizontal: 16,
    },
    button: {
      height: 52,
      width: 104,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.action.primary,
      paddingHorizontal: 10,
    },
    buttonText: { color: theme.action.onPrimary, fontSize: 13, fontWeight: '700' },
    primaryButton: {
      alignSelf: 'stretch',
      height: 52,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.action.primary,
      paddingHorizontal: 16,
    },
    primaryButtonText: { color: theme.action.onPrimary, fontSize: 16, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    pressed: { transform: [{ scale: 0.98 }] },
    error: { color: theme.status.danger, fontSize: 16 },
  });
}
