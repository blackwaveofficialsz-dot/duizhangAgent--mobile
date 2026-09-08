import { X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type ExcludedStore = { reason: string; store_key: string; store_label: string };

type Props = {
  excludedStores: ExcludedStore[];
  onClose: () => void;
  visible: boolean;
};

export function TurnoverExclusionSheet({ excludedStores, onClose, visible }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible={visible}>
    <View style={styles.scrim}>
      <Pressable accessibilityLabel="关闭已排除门店" onPress={onClose} style={styles.backdrop} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea} testID="turnover-exclusion-sheet-safe-area">
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>已排除门店</Text>
            <Pressable accessibilityLabel="关闭已排除门店" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <X color={theme.text.primary} size={20} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {excludedStores.map((store) => <View key={store.store_key} style={styles.row}>
              <Text style={styles.storeLabel}>{store.store_label || store.store_key}</Text>
              <Text style={styles.reason}>{store.reason}</Text>
            </View>)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    scrim: { backgroundColor: theme.overlay.scrim, flex: 1, justifyContent: 'flex-end' },
    backdrop: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    safeArea: { backgroundColor: theme.background.surface },
    sheet: { backgroundColor: theme.background.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '72%', paddingBottom: 12 },
    header: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 16 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '600', letterSpacing: 0 },
    closeButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    content: { paddingHorizontal: 16 },
    row: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4, paddingVertical: 14 },
    storeLabel: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    reason: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
  });
}
