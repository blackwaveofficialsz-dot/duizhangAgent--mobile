import { X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type ToastType = 'success' | 'error' | 'info';
type ToastMessage = { id: number; message: string; type: ToastType };
type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();
let nextToastId = 0;

export function showToast(message: string, type: ToastType = 'info') {
  const toast = { id: ++nextToastId, message, type };
  listeners.forEach((listener) => listener(toast));
}

export function AppToast() {
  const { theme } = useTheme();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    const listener: ToastListener = setToast;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  const color = toast.type === 'success'
    ? theme.status.success
    : toast.type === 'error'
      ? theme.status.danger
      : theme.status.info;

  return (
    <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.safeArea}>
      <View style={[styles.toast, { borderColor: color }]}>
        <View style={[styles.indicator, { backgroundColor: color }]} />
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.message}
        >
          {toast.message}
        </Text>
        <Pressable
          accessibilityLabel="关闭提示"
          accessibilityRole="button"
          onPress={() => setToast(null)}
          style={styles.close}
        >
          <X color={theme.text.secondary} size={18} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: {
      position: 'absolute',
      zIndex: 1000,
      top: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    toast: {
      width: '100%',
      maxWidth: 520,
      marginTop: 12,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderRadius: 8,
      backgroundColor: theme.background.surface,
      paddingLeft: 14,
      paddingRight: 4,
    },
    indicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    message: {
      flex: 1,
      color: theme.text.primary,
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0,
    },
    close: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
