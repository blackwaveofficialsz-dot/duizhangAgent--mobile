import { TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type DuplicateFileDialogProps = {
  duplicate: { existing_sources?: unknown[]; period?: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DuplicateFileDialog({ duplicate, onCancel, onConfirm }: DuplicateFileDialogProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const confirmedRef = useRef(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    confirmedRef.current = false;
    setIsConfirming(false);
  }, [duplicate?.period]);

  if (!duplicate) return null;

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    setIsConfirming(true);
    onConfirm();
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} presentationStyle="overFullScreen" transparent visible>
      <View style={styles.scrim}>
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.heading}>
              <TriangleAlert color={theme.status.warning} size={22} strokeWidth={2} />
              <View style={styles.headingCopy}>
                <Text style={styles.title}>检测到重复文件</Text>
                <Text style={styles.subtitle}>账期 {duplicate.period || '未识别'}</Text>
              </View>
            </View>
            <View style={styles.sources}>
              {(duplicate.existing_sources?.length ? duplicate.existing_sources : [null]).map((source, index) => (
                <Text key={index} style={styles.sourceText}>{formatSource(source, index)}</Text>
              ))}
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityLabel="取消" accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="替换并重新上传"
                accessibilityRole="button"
                accessibilityState={{ disabled: isConfirming }}
                disabled={isConfirming}
                onPress={confirm}
                style={({ pressed }) => [styles.confirmButton, isConfirming && styles.disabled, pressed && !isConfirming && styles.pressed]}
              >
                <Text style={styles.confirmText}>{isConfirming ? '正在提交' : '替换并重新上传'}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function formatSource(source: unknown, index: number): string {
  if (typeof source === 'string' && source) return source;
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>;
    for (const key of ['bill_platform', 'platform_name', 'source', 'filename']) {
      if (typeof record[key] === 'string' && record[key]) return record[key];
    }
  }
  return `已有来源 ${index + 1}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    scrim: { backgroundColor: theme.overlay.scrim, flex: 1, justifyContent: 'flex-end' },
    safeArea: { backgroundColor: theme.background.surface },
    sheet: { backgroundColor: theme.background.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18 },
    heading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    headingCopy: { flex: 1 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '700', letterSpacing: 0 },
    subtitle: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 5 },
    sources: { backgroundColor: theme.background.subtle, borderRadius: 8, gap: 4, marginTop: 16, padding: 10 },
    sourceText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
    cancelButton: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
    confirmButton: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
    cancelText: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    confirmText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    disabled: { opacity: 0.48 },
    pressed: { transform: [{ scale: 0.98 }] },
  });
}
