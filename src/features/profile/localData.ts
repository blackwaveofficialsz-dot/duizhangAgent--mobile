import { Paths } from 'expo-file-system';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { useChatStore } from '@/features/chat/chatStore';
import { useTaskStore } from '@/features/tasks/taskStore';

export function clearLocalAppData(): void {
  useChatStore.getState().reset();
  useAnalyticsStore.getState().reset();
  useInsightDetailStore.getState().reset();
  useTaskStore.getState().reset();
  if (Paths.cache.exists) Paths.cache.delete();
}
