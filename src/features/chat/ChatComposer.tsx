import { Paperclip, Send, Square } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { UploadDocument, UploadResult } from '@/services/api/uploads';
import { cleanupPickedDocuments, pickDocuments } from '@/services/files/pickDocuments';
import { DuplicateFileDialog } from './DuplicateFileDialog';
import { UploadQueue, type UploadQueueItem } from './UploadQueue';

type ChatComposerProps = {
  bottomInset?: number;
  isBlocked?: boolean;
  isStreaming: boolean;
  onSend: (text: string, files?: UploadDocument[], replace?: boolean, signal?: AbortSignal) => Promise<UploadResult | void> | void;
  onStop: () => void;
};

const INPUT_MIN_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 116;
const INPUT_LINE_HEIGHT = 20;

export function ChatComposer({ bottomInset = 0, isBlocked = false, isStreaming, onSend, onStop }: ChatComposerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme, Math.max(0, bottomInset)), [theme, bottomInset]);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [isPicking, setIsPicking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [duplicate, setDuplicate] = useState<{ existing_sources?: unknown[]; period?: string } | null>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const queueRef = useRef(queue);
  const mountedRef = useRef(true);
  const pickerGenerationRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadGenerationRef = useRef(0);
  const uploadLockRef = useRef(false);
  const isActionBlocked = isBlocked || isStreaming || isPicking || isUploading;
  const canSend = Boolean(text.trim() || queue.length) && !isActionBlocked;
  const sendIconColor = canSend ? theme.action.onPrimary : theme.text.muted;

  const updateText = (value: string) => {
    setText(value);
    setInputHeight(explicitLineHeight(value));
  };

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pickerGenerationRef.current += 1;
      uploadGenerationRef.current += 1;
      uploadAbortRef.current?.abort();
      if (!uploadLockRef.current) {
        cleanupPickedDocuments(queueRef.current.map((item) => item.document));
        queueRef.current = [];
      }
    };
  }, []);

  const submit = async (replace = false) => {
    const message = text.trim();
    const documents = queue.map((item) => item.document);
    if ((!message && !documents.length) || isBlocked || isStreaming) return;
    if (!documents.length) {
      setText('');
      setInputHeight(INPUT_MIN_HEIGHT);
      await onSend(message);
      return;
    }

    if (uploadLockRef.current) return;
    uploadLockRef.current = true;
    const uploadGeneration = ++uploadGenerationRef.current;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setIsUploading(true);
    setQueue((items) => items.map((item) => ({ ...item, status: 'uploading' })));
    try {
      const result = await onSend(message, documents, replace, controller.signal);
      if (!mountedRef.current || uploadGeneration !== uploadGenerationRef.current) {
        cleanupPickedDocuments(documents);
        queueRef.current = [];
        return;
      }
      if (!replace && isDuplicate(result)) {
        setQueue((items) => items.map((item) => ({ ...item, status: 'ready' })));
        setDuplicate(result);
        return;
      }
      cleanupPickedDocuments(documents);
      queueRef.current = [];
      setQueue([]);
      setText('');
      setInputHeight(INPUT_MIN_HEIGHT);
    } catch (error) {
      if (!mountedRef.current || uploadGeneration !== uploadGenerationRef.current) {
        cleanupPickedDocuments(documents);
        queueRef.current = [];
        return;
      }
      setQueue((items) => items.map((item) => ({ ...item, status: 'failed' })));
      showToast(error instanceof Error ? error.message : '上传失败，请重试', 'error');
    } finally {
      uploadLockRef.current = false;
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (mountedRef.current && uploadGeneration === uploadGenerationRef.current) setIsUploading(false);
    }
  };

  const addDocuments = async () => {
    if (isActionBlocked) return;
    const pickerGeneration = ++pickerGenerationRef.current;
    setIsPicking(true);
    try {
      const documents = await pickDocuments();
      if (!mountedRef.current || pickerGeneration !== pickerGenerationRef.current) {
        cleanupPickedDocuments(documents);
        return;
      }
      const existingUris = new Set(queueRef.current.map((item) => item.document.uri));
      const existingKeys = new Set(queueRef.current.map((item) => documentKey(item.document)));
      const accepted: UploadDocument[] = [];
      const rejected: UploadDocument[] = [];
      for (const document of documents) {
        const key = documentKey(document);
        if (existingUris.has(document.uri) || existingKeys.has(key)) {
          rejected.push(document);
          continue;
        }
        existingUris.add(document.uri);
        existingKeys.add(key);
        accepted.push(document);
      }
      if (rejected.length) cleanupPickedDocuments(rejected);
      const nextItems = [
        ...queueRef.current,
        ...accepted.map((document) => ({
          document,
          id: document.uri,
          status: 'ready' as const,
        })),
      ];
      queueRef.current = nextItems;
      setQueue(nextItems);
    } catch (error) {
      if (mountedRef.current && pickerGeneration === pickerGenerationRef.current) {
        showToast(error instanceof Error ? error.message : '无法选择文件', 'error');
      }
    } finally {
      if (mountedRef.current && pickerGeneration === pickerGenerationRef.current) setIsPicking(false);
    }
  };

  const removeDocument = (id: string) => {
    setQueue((items) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) cleanupPickedDocuments([item.document]);
      const remaining = items.filter((candidate) => candidate.id !== id);
      queueRef.current = remaining;
      return remaining;
    });
  };

  return (
    <View style={styles.footer}>
      <UploadQueue items={queue} onRemove={removeDocument} onRetry={() => void submit()} />
      <View style={styles.composer} testID="chat-composer">
        <Pressable
          accessibilityLabel="添加附件"
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionBlocked }}
          disabled={isActionBlocked}
          onPress={() => void addDocuments()}
          style={[styles.iconButton, isActionBlocked && styles.actionDisabled]}
        >
          <Paperclip color={theme.text.muted} size={21} />
        </Pressable>
        <TextInput
          accessibilityLabel="消息内容"
          editable={!isStreaming}
          maxLength={4000}
          multiline
          numberOfLines={1}
          onChangeText={updateText}
          onContentSizeChange={(event) => {
            setInputHeight(Math.max(explicitLineHeight(text), clampInputHeight(event.nativeEvent.contentSize.height)));
          }}
          placeholder="输入消息"
          placeholderTextColor={theme.text.muted}
          scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
          style={[styles.input, { height: inputHeight }]}
          textAlignVertical="center"
          value={text}
        />
        {isStreaming ? (
          <Pressable
            accessibilityLabel="停止生成"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onStop}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            <Square color={theme.action.onPrimary} fill={theme.action.onPrimary} size={16} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            hitSlop={6}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.actionButton,
              !canSend && styles.sendButtonDisabled,
              pressed && canSend && styles.pressed,
            ]}
          >
            <Send color={sendIconColor} size={19} />
          </Pressable>
        )}
      </View>
      <DuplicateFileDialog
        duplicate={duplicate}
        onCancel={() => {
          const documents = queueRef.current.map((item) => item.document);
          cleanupPickedDocuments(documents);
          queueRef.current = [];
          setDuplicate(null);
          setQueue([]);
        }}
        onConfirm={() => {
          setDuplicate(null);
          void submit(true);
        }}
      />
    </View>
  );
}

function isDuplicate(result: UploadResult | void): result is UploadResult & { duplicate: true } {
  return Boolean(result?.duplicate);
}

function documentKey(document: UploadDocument): string {
  return `${document.name}\u0000${document.size ?? ''}`;
}

function explicitLineHeight(value: string): number {
  return clampInputHeight(INPUT_MIN_HEIGHT + Math.max(0, value.split('\n').length - 1) * INPUT_LINE_HEIGHT);
}

function clampInputHeight(height: number): number {
  return Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, height));
}

function createStyles(theme: AppTheme, bottomInset: number) {
  return StyleSheet.create({
    footer: {
      backgroundColor: theme.background.canvas,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 10 + bottomInset,
    },
    composer: {
      alignItems: 'flex-end',
      backgroundColor: theme.background.surface,
      borderColor: theme.border.default,
      borderRadius: 22,
      borderWidth: 1,
      flexDirection: 'row',
      padding: 4,
    },
    iconButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      opacity: 0.55,
      width: 44,
    },
    input: {
      color: theme.text.primary,
      flex: 1,
      fontSize: 16,
      letterSpacing: 0,
      lineHeight: 20,
      maxHeight: INPUT_MAX_HEIGHT,
      minHeight: INPUT_MIN_HEIGHT,
      paddingHorizontal: 4,
      paddingVertical: 12,
    },
    actionButton: {
      alignItems: 'center',
      backgroundColor: theme.action.primary,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    actionDisabled: {
      opacity: 0.42,
    },
    sendButtonDisabled: {
      backgroundColor: theme.background.subtle,
      opacity: 1,
    },
    pressed: {
      transform: [{ scale: 0.96 }],
    },
  });
}
