import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from 'react-native';
import { Eye, EyeOff, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/brand/BrandMark';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { describePasswordStrength, PASSWORD_LENGTH_HINT } from './passwordPolicy';

export function AuthScreen({ children, title }: PropsWithChildren<{ title: string }>) {
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const contentTop = Math.round(height * 0.15);
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: contentTop }]}
          keyboardShouldPersistTaps="handled"
          testID="auth-screen-scroll"
        >
          <View style={styles.brandBlock}>
            <BrandMark size={52} />
            <View>
              <Text style={styles.brandName}>寰澜</Text>
              <Text style={styles.brandEnglish}>BLACKWAVE</Text>
            </View>
          </View>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <View style={styles.form}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthField({ label, ...props }: TextInputProps & { label: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: props.editable === false || props.accessibilityState?.disabled,
        }}
        placeholderTextColor={theme.text.muted}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

export function AuthHelperText({ message }: { message: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.helperText}>{message}</Text>;
}

export function AuthErrorText({ message }: { message: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text accessibilityRole="alert" style={styles.errorText}>{message}</Text>;
}

export function PasswordStrengthHint({ password }: { password: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const strength = describePasswordStrength(password);
  const activeColor = theme.status[strength.color];
  return (
    <View style={styles.passwordStrength}>
      <View style={styles.strengthHeader}>
        <Text style={styles.strengthLabel}>密码强度：{strength.label}</Text>
        <Text style={styles.strengthHint}>{PASSWORD_LENGTH_HINT}</Text>
      </View>
      <View accessibilityLabel={`密码强度 ${strength.label}`} style={styles.strengthBars}>
        {[1, 2, 3, 4].map((index) => (
          <View
            key={index}
            style={[
              styles.strengthBar,
              { backgroundColor: index <= strength.score ? activeColor : theme.border.default },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

type PasswordFieldProps = {
  autoComplete?: TextInputProps['autoComplete'];
  disabled?: boolean;
  label: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  onToggle: () => void;
  placeholder: string;
  returnKeyType?: TextInputProps['returnKeyType'];
  textContentType?: TextInputProps['textContentType'];
  toggleLabel?: string;
  value: string;
  visible: boolean;
};

export function PasswordField({ autoComplete = 'new-password', disabled = false, label, onChangeText, onSubmitEditing, onToggle, placeholder, returnKeyType, textContentType, toggleLabel, value, visible }: PasswordFieldProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const actionLabel = visible ? `隐藏${toggleLabel ?? label}` : `显示${toggleLabel ?? label}`;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordField}>
        <TextInput
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          autoCapitalize="none"
          autoComplete={autoComplete}
          editable={!disabled}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={theme.text.muted}
          returnKeyType={returnKeyType}
          secureTextEntry={!visible}
          style={styles.passwordInput}
          textContentType={textContentType}
          value={value}
        />
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled, expanded: visible }}
          disabled={disabled}
          onPress={onToggle}
          style={styles.iconButton}
        >
          {visible ? <EyeOff color={theme.text.secondary} size={20} /> : <Eye color={theme.text.secondary} size={20} />}
        </Pressable>
      </View>
    </View>
  );
}

export function ChoiceRow<T extends string>({
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ accessibilityLabel?: string; label: string; value: T }>;
  value: T;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityLabel={label} style={styles.choiceRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PrimaryButton({ disabled, label, loading, onPress }: {
  disabled: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(loading), disabled }}
      disabled={disabled}
      onPress={onPress}
      testID="auth-primary-button"
      style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
    >
      {loading ? <ActivityIndicator color={theme.action.onPrimary} /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function LinkButton({ disabled = false, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.link, disabled && styles.disabled]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

export function InlineNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <Text style={styles.noticeText}>{message}</Text>
      {onClose ? (
        <Pressable accessibilityLabel="关闭提示" accessibilityRole="button" onPress={onClose} style={styles.noticeClose}>
          <X color={theme.status.danger} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function VerifiedHint() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text accessibilityRole="alert" style={styles.verified}>联系方式已验证</Text>;
}

export const identifierOptions = [
  { accessibilityLabel: '选择用户名', label: '用户名', value: 'username' },
  { accessibilityLabel: '选择邮箱', label: '邮箱', value: 'email' },
  { accessibilityLabel: '选择手机号', label: '手机号', value: 'phone' },
] as const;

export const channelOptions = [
  { label: '邮箱', value: 'email' },
  { label: '手机号', value: 'sms' },
] as const;

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.background.canvas },
    fill: { flex: 1 },
    scrollContent: { flexGrow: 1, width: '100%', maxWidth: 460, alignSelf: 'center', justifyContent: 'flex-start', paddingBottom: 24, paddingHorizontal: 24, gap: 24 },
    brandBlock: { alignItems: 'center',  flexDirection: 'row', gap: 12 },
    brandName: { color: theme.text.primary, fontSize: 24 },
    brandEnglish: { color: theme.chart.series01, fontSize: 12, fontWeight: '600' },
    title: { color: theme.text.primary, fontSize: 24, fontWeight: '700'},
    form: { gap: 20 },
    field: { gap: 8 },
    label: { color: theme.text.primary, fontSize: 16, fontWeight: '600' },
    helperText: { color: theme.text.muted, fontSize: 13, lineHeight: 20 },
    errorText: { color: theme.status.danger, fontSize: 13, lineHeight: 20 },
    passwordStrength: { gap: 7, marginTop: -10 },
    strengthHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    strengthLabel: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    strengthHint: { color: theme.text.muted, fontSize: 12, letterSpacing: 0 },
    strengthBars: { flexDirection: 'row', gap: 5 },
    strengthBar: { borderRadius: 999, flex: 1, height: 4 },
    input: { height: 52, borderWidth: 1, borderColor: theme.border.default, borderRadius: 12, backgroundColor: theme.background.surface, color: theme.text.primary, fontSize: 16, paddingHorizontal: 16 },
    passwordField: { height: 52, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border.default, borderRadius: 12, backgroundColor: theme.background.surface },
    passwordInput: { flex: 1, height: '100%', color: theme.text.primary, fontSize: 16, paddingLeft: 16, paddingRight: 8 },
    iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    choiceRow: { flexDirection: 'row', gap: 8 },
    choice: { minWidth: 72, minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border.default, borderRadius: 12, backgroundColor: theme.background.surface },
    choiceSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    choiceText: { color: theme.text.primary, fontSize: 16, fontWeight: '600' },
    choiceTextSelected: { color: theme.action.onPrimary },
    primary: { alignSelf: 'stretch', height: 52, borderRadius: 12, backgroundColor: theme.action.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    primaryText: { color: theme.action.onPrimary, fontSize: 16, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    pressed: { transform: [{ scale: 0.98 }] },
    link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    linkText: { color: theme.status.info, fontSize: 16, fontWeight: '600' },
    notice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.status.danger, borderRadius: 8, backgroundColor: theme.background.surface, paddingLeft: 14, paddingRight: 4 },
    noticeText: { flex: 1, color: theme.status.danger, fontSize: 16 },
    noticeClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    verified: { color: theme.status.success, fontSize: 16 },
  });
}
