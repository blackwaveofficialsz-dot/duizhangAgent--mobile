import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatTableDetailScreen } from '@/features/chat/ChatTableDetailScreen';
import { tableFromMessage } from '@/features/chat/chatTables';
import { useChatStore } from '@/features/chat/chatStore';

export default function ChatTableRoute() {
  const { messageId, tableIndex = '0' } = useLocalSearchParams<{ messageId: string; tableIndex?: string }>();
  const router = useRouter();
  const message = useChatStore((state) => {
    const activeMessages = state.activeSessionId ? state.messagesBySessionId[state.activeSessionId] : [];
    return activeMessages?.find((item) => item.id === messageId);
  });
  const table = useMemo(() => {
    if (!message) return null;
    const index = Number.parseInt(tableIndex, 10);
    return Number.isInteger(index) && index >= 0 ? tableFromMessage(message, index) : null;
  }, [message, tableIndex]);

  return <ChatTableDetailScreen onClose={() => router.back()} table={table} />;
}
