import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, APP_HEADER_HEIGHT } from '@/components/layout/AppHeader';
import type { UploadDocument, UploadResult } from '@/services/api/uploads';
import { uploadFiles } from '@/services/api/uploads';
import { isDeviceOnline, useNetworkStore } from '@/services/network/networkStore';
import type { MessageItem } from '@/types/chat';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { beijingIsoNow } from '@/utils/time';
import { ChatComposer } from './ChatComposer';
import { ApprovalSheet } from './ApprovalSheet';
import { ChatMessageList } from './ChatMessageList';
import { ConversationHistory } from './ConversationHistory';
import { useChatStore } from './chatStore';
import { useChatStream } from './useChatStream';

const EMPTY_MESSAGES: MessageItem[] = [];
let uploadMessageCount = 0;

export function ChatHomeScreen() {
  return <ChatHomeContent />;
}

function ChatHomeContent() {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [historyOpen, setHistoryOpen] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const networkWriteBlocked = useNetworkStore((state) => state.status !== 'online');
  const messages = useChatStore((state) => (
    activeSessionId ? state.messagesBySessionId[activeSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  ));
  const {
    isPendingBlocked,
    isStreaming,
    pendingApproval,
    approvePending,
    cancelPending,
    retryInterruptedMessage,
    sendMessage,
    stopGeneration,
  } = useChatStream();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(app)/(tabs)/analytics' as never);
  };

  const sendComposerMessage = async (
    text: string,
    files: UploadDocument[] = [],
    replace = false,
    signal?: AbortSignal,
  ): Promise<UploadResult | void> => {
    if (!isDeviceOnline()) return;
    if (!files.length) {
      await sendMessage(text);
      return;
    }

    const store = useChatStore.getState();
    const localSessionId = store.activeSessionId ?? store.newSession();
    const isPending = store.sessions.some((session) => session.session_id === localSessionId && session.pending);
    const request = {
      files,
      message: text,
      signal,
      sessionId: isPending ? '' : localSessionId,
      taskType: 'file_parsing' as const,
    };
    const result = await uploadFiles(replace ? { ...request, replace: true } : request);
    if (result.duplicate) return result;

    const resolvedSessionId = result.session_id ?? localSessionId;
    if (isPending && result.session_id) store.replacePendingSessionId(localSessionId, resolvedSessionId);
    const createdAt = beijingIsoNow();
    const userContent = `${text}${files.map((file) => `\n📎 ${file.name}`).join('')}` || '上传文件';
    store.addMessage(resolvedSessionId, {
      content: userContent,
      created_at: createdAt,
      id: createUploadMessageId('user'),
      role: 'user',
    });
    store.addMessage(resolvedSessionId, {
      content: '文件已上传，正在后台解析...',
      created_at: createdAt,
      id: createUploadMessageId('assistant'),
      role: 'assistant',
      task_id: result.task_id ?? null,
    });
    return result;
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.safeArea}>
      <AppHeader
        leadingAction={{ type: 'back', onPress: goBack }}
        title="对话"
        trailingAction={{ type: 'history', onPress: () => setHistoryOpen(true) }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + APP_HEADER_HEIGHT : 0}
        style={styles.keyboardArea}
        testID="chat-keyboard-area"
      >
        <ChatMessageList
          isRetryDisabled={networkWriteBlocked}
          messages={messages}
          onOpenAlerts={() => router.push('/analytics/alerts' as never)}
          onOpenOrders={() => router.push('/analytics/orders' as never)}
          onOpenTask={(taskId) => router.push({ pathname: '/tasks/[taskId]', params: { taskId } })}
          onOpenTable={(messageId, tableIndex) => router.push({ pathname: '/tables/[messageId]', params: { messageId, tableIndex: String(tableIndex) } })}
          onPrompt={sendMessage}
          onRetry={() => void retryInterruptedMessage()}
          promptDisabled={isStreaming || isPendingBlocked || networkWriteBlocked}
        />
        <ChatComposer
          bottomInset={Platform.OS === 'ios' ? insets.bottom : 0}
          isBlocked={isPendingBlocked || networkWriteBlocked}
          isStreaming={isStreaming}
          onSend={sendComposerMessage}
          onStop={stopGeneration}
        />
        <ApprovalSheet
          approval={pendingApproval}
          isDisabled={networkWriteBlocked}
          isStreaming={isStreaming}
          onApprove={() => void approvePending()}
          onCancel={cancelPending}
        />
      </KeyboardAvoidingView>
      <Modal animationType="fade" onRequestClose={() => setHistoryOpen(false)} transparent visible={historyOpen}>
        <View style={styles.historyOverlay}>
          <Pressable accessibilityLabel="关闭历史记录" onPress={() => setHistoryOpen(false)} style={styles.historyBackdrop} />
          <View style={[styles.historyPanel, { paddingTop: insets.top }]}>
            <ConversationHistory onSessionOpened={() => setHistoryOpen(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createUploadMessageId(role: 'assistant' | 'user'): string {
  return `${role}-upload-${Date.now()}-${++uploadMessageCount}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background.canvas,
    },
    historyBackdrop: {
      backgroundColor: theme.overlay.scrim,
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    historyOverlay: {
      flex: 1,
      flexDirection: 'row',
    },
    historyPanel: {
      backgroundColor: theme.background.surface,
      borderRightColor: theme.border.default,
      borderRightWidth: StyleSheet.hairlineWidth,
      maxWidth: 360,
      width: '86%',
    },
    keyboardArea: {
      flex: 1,
    },
  });
}
