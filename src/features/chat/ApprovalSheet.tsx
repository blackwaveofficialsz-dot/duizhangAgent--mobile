import { TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { ApprovalRequest } from '@/types/chat';

type ApprovalSheetProps = {
  approval: ApprovalRequest | null;
  isDisabled?: boolean;
  isStreaming: boolean;
  onApprove: () => void;
  onCancel: () => void;
};

export function ApprovalSheet({ approval, isDisabled = false, isStreaming, onApprove, onCancel }: ApprovalSheetProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height: viewportHeight } = useWindowDimensions();
  const approvedRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    approvedRef.current = false;
    setIsSubmitting(false);
  }, [approval?.turnId]);

  if (!approval) return null;

  const approve = () => {
    if (isDisabled || isStreaming || approvedRef.current) return;
    approvedRef.current = true;
    setIsSubmitting(true);
    onApprove();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View style={styles.scrim}>
        <SafeAreaView edges={['bottom']} style={styles.safeArea} testID="approval-sheet-safe-area">
          <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: viewportHeight * 0.82 }]} testID="approval-sheet">
            <View style={styles.handle} testID="approval-sheet-handle" />
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              style={styles.contentScroll}
              testID="approval-content-scroll"
            >
              <View style={styles.heading}>
                <View style={styles.headingCopy}>
                  <Text style={styles.title}>{approval.action}</Text>
                  <Text style={styles.subtitle}>此操作需要你确认</Text>
                </View>
                <TriangleAlert color={theme.status.warning} size={22} strokeWidth={2} />
              </View>
              <View style={styles.impact} testID="approval-impact">
                <TriangleAlert color={theme.status.warning} size={18} strokeWidth={2} />
                <Text style={styles.description}>{approval.description}</Text>
              </View>
            </ScrollView>
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel="取消"
                accessibilityRole="button"
                onPress={onCancel}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="同意执行"
                accessibilityRole="button"
                accessibilityState={{ disabled: isDisabled || isStreaming || isSubmitting }}
                disabled={isDisabled || isStreaming || isSubmitting}
                onPress={approve}
                style={({ pressed }) => [
                  styles.approveButton,
                  (isDisabled || isStreaming || isSubmitting) && styles.disabled,
                  pressed && !isDisabled && !isStreaming && !isSubmitting && styles.pressed,
                ]}
              >
                <Text style={styles.approveText}>{isSubmitting ? '正在提交' : '同意执行'}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    scrim: {
      backgroundColor: theme.overlay.scrim,
      flex: 1,
      justifyContent: 'flex-end',
    },
    safeArea: { backgroundColor: theme.background.surface },
    sheet: {
      backgroundColor: theme.background.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 24,
      paddingHorizontal: 18,
      paddingTop: 12,
    },
    handle: { alignSelf: 'center', backgroundColor: theme.border.strong, borderRadius: 8, height: 4, marginBottom: 16, width: 38 },
    content: { paddingBottom: 1 },
    contentScroll: { flexGrow: 0, flexShrink: 1 },
    heading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    headingCopy: { flex: 1, minWidth: 0 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '700', letterSpacing: 0 },
    subtitle: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 19, marginTop: 6 },
    impact: { alignItems: 'flex-start', backgroundColor: theme.background.subtle, borderRadius: 8, flexDirection: 'row', gap: 9, marginTop: 16, padding: 10 },
    description: { color: theme.text.secondary, flex: 1, fontSize: 13, letterSpacing: 0, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
    cancelButton: {
      alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1,
      flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12,
    },
    approveButton: {
      alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8,
      flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12,
    },
    cancelText: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    approveText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    disabled: { opacity: 0.48 },
    pressed: { transform: [{ scale: 0.98 }] },
  });
}
