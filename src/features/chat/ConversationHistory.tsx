import { SquarePen, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { showToast } from '@/components/feedback/AppToast';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatBeijingDateTime } from '@/utils/time';
import { useChatStore } from './chatStore';
import { groupSessions } from './groupSessions';

type ConversationHistoryProps = {
  onSessionOpened: () => void;
};

export function ConversationHistory({ onSessionOpened }: ConversationHistoryProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const deletingSessionId = useChatStore((state) => state.deletingSessionId);
  const cacheOffline = useChatStore((state) => state.isOffline);
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const networkWriteBlocked = networkStatus !== 'online';
  const usingCache = cacheOffline || deviceOffline;
  const lastSyncedAt = useChatStore((state) => state.lastSyncedAt);
  const loadSessions = useChatStore((state) => state.loadSessions);
  const openSession = useChatStore((state) => state.openSession);
  const newSession = useChatStore((state) => state.newSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const deleting = deletingSessionId !== null;
  const deleteDisabled = deleting || networkWriteBlocked;
  const groups = useMemo(
    () => groupSessions(sessions.filter((session) => !session.pending && session.session_id !== deletingSessionId)),
    [deletingSessionId, sessions],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(controller.signal).catch(() => {
      if (!controller.signal.aborted) showToast('对话历史加载失败，请稍后重试', 'error');
    });
    return () => controller.abort();
  }, [loadSessions]);

  const selectSession = async (sessionId: string) => {
    if (deleting) return;
    try {
      if (await openSession(sessionId)) onSessionOpened();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '对话加载失败，请稍后重试', 'error');
    }
  };

  const confirmDelete = (sessionId: string) => {
    if (deleteDisabled) return;
    Alert.alert('删除对话', '删除后无法恢复，确认删除？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteSession(sessionId)
            .then((result) => {
              if (result === 'deleted' || result === 'deleted-active') {
                showToast('对话已删除', 'success');
                if (result === 'deleted-active') onSessionOpened();
              } else if (result === 'busy') {
                showToast('正在删除对话，请稍候', 'info');
              } else if (result === 'not-found') {
                showToast('对话不存在或已删除', 'info');
              }
            })
            .catch((error) => showToast(error instanceof Error ? error.message : '删除失败，请稍后重试', 'error'));
        },
      },
    ]);
  };

  const startNewSession = () => {
    if (networkWriteBlocked) return;
    newSession();
    onSessionOpened();
  };

  return (
    <View style={styles.history}>
      <View style={styles.historyHeader}>
        <View style={styles.historyHeaderCopy}>
          <Text style={styles.historyTitle}>对话历史</Text>
          {usingCache ? <Text style={styles.offlineStatus}>离线查看 · 上次同步 {formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}</Text> : null}
        </View>
        <Pressable
          accessibilityLabel="新建对话"
          accessibilityRole="button"
          accessibilityState={{ disabled: networkWriteBlocked }}
          disabled={networkWriteBlocked}
          hitSlop={8}
          onPress={startNewSession}
          style={styles.newSessionButton}
        >
          <SquarePen color={theme.text.secondary} size={20} />
        </Pressable>
      </View>
      {groups.length ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {groups.map((group) => (
            <View key={group.label}>
              <Text style={styles.groupTitle}>{group.label}</Text>
              {group.sessions.map((session) => (
                <Swipeable
                  enabled={!deleteDisabled}
                  key={session.session_id}
                  renderRightActions={() => (
                    <Pressable
                      accessibilityLabel={`删除${session.title}`}
                      accessibilityRole="button"
                      disabled={deleteDisabled}
                      onPress={() => confirmDelete(session.session_id)}
                      style={styles.deleteAction}
                    >
                      <Trash2 color={theme.background.surface} size={20} />
                    </Pressable>
                  )}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: deleting, selected: activeSessionId === session.session_id }}
                    disabled={deleting}
                    onPress={() => void selectSession(session.session_id)}
                    style={[styles.session, activeSessionId === session.session_id && styles.sessionActive]}
                  >
                    <Text numberOfLines={1} style={styles.sessionTitle}>{session.title}</Text>
                    <Text numberOfLines={1} style={styles.sessionTime}>{formatBeijingDateTime(session.updated_at)}</Text>
                  </Pressable>
                </Swipeable>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>暂无对话记录</Text>
          <Text style={styles.emptyDescription}>完成首次对话后，历史记录会显示在这里</Text>
        </View>
      )}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    history: { flex: 1 },
    historyHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingLeft: 20, paddingRight: 8 },
    historyHeaderCopy: { flex: 1, minWidth: 0 },
    historyTitle: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    offlineStatus: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, marginTop: 2 },
    newSessionButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    list: { padding: 12, gap: 16 },
    groupTitle: { color: theme.text.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0, marginBottom: 6 },
    session: { backgroundColor: theme.background.surface, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 },
    sessionActive: { backgroundColor: theme.background.subtle },
    sessionTitle: { color: theme.text.primary, fontSize: 15, fontWeight: '500', letterSpacing: 0 },
    sessionTime: { color: theme.text.muted, fontSize: 12, letterSpacing: 0, marginTop: 3 },
    deleteAction: { alignItems: 'center', backgroundColor: theme.status.danger, justifyContent: 'center', width: 64 },
    empty: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 48, paddingHorizontal: 24 },
    emptyTitle: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0, textAlign: 'center' },
    emptyDescription: { color: theme.text.muted, fontSize: 13, letterSpacing: 0, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  });
}
