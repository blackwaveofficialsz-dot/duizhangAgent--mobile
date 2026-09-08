import { Paperclip, RefreshCw, X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { UploadDocument } from '@/services/api/uploads';

export type UploadQueueItem = {
  document: UploadDocument;
  id: string;
  status: 'ready' | 'uploading' | 'failed';
};

type UploadQueueProps = {
  items: UploadQueueItem[];
  onRemove: (id: string) => void;
  onRetry: () => void;
};

export function UploadQueue({ items, onRemove, onRetry }: UploadQueueProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!items.length) return null;

  return (
    <View style={styles.queue} testID="upload-queue">
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <Paperclip color={theme.status.info} size={18} strokeWidth={2} />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.name}>{item.document.name}</Text>
            <Text style={[styles.meta, item.status === 'failed' && styles.failed]}>{statusLabel(item.status, item.document.size)}</Text>
          </View>
          {item.status === 'failed' && (
            <Pressable accessibilityLabel="重试上传" accessibilityRole="button" hitSlop={6} onPress={onRetry} style={styles.iconButton}>
              <RefreshCw color={theme.action.primary} size={17} strokeWidth={2} />
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={`移除 ${item.document.name}`}
            accessibilityRole="button"
            disabled={item.status === 'uploading'}
            hitSlop={6}
            onPress={() => onRemove(item.id)}
            style={[styles.iconButton, item.status === 'uploading' && styles.disabled]}
          >
            <X color={theme.text.muted} size={18} strokeWidth={2} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function statusLabel(status: UploadQueueItem['status'], size: number | null): string {
  const sizeText = size === null ? '' : ` · ${formatSize(size)}`;
  if (status === 'uploading') return `上传中${sizeText}`;
  if (status === 'failed') return `上传失败${sizeText}`;
  return `待上传${sizeText}`;
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    queue: { backgroundColor: theme.background.surface, borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, gap: 6, marginBottom: 8, padding: 8 },
    item: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 36 },
    copy: { flex: 1, minWidth: 0 },
    name: { color: theme.text.primary, fontSize: 13, letterSpacing: 0, lineHeight: 18 },
    meta: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, lineHeight: 16 },
    failed: { color: theme.status.danger },
    iconButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    disabled: { opacity: 0.42 },
  });
}
