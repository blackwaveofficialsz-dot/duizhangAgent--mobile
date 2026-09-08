import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenState } from '@/components/states/ScreenState';
import { showToast } from '@/components/feedback/AppToast';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { getTask, retryTaskFiles } from '@/services/api/tasks';
import { downloadAndShareReport } from '@/services/files/downloadReport';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { TaskRecord } from '@/types/task';
import { TaskDetailContent } from './TaskDetailContent';
import { taskDownloadInfo } from './taskPresentation';
import { useTaskStore } from './taskStore';

type TaskDetailScreenProps = { onBack: () => void; onOpenRecords?: (runId: string) => void; taskId: string };

export function TaskDetailScreen({ onBack, onOpenRecords = () => {}, taskId }: TaskDetailScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const cacheOffline = useTaskStore((state) => state.isOffline);
  const networkStatus = useNetworkStore((state) => state.status);
  const deviceOffline = networkStatus === 'offline';
  const retryBlocked = networkStatus !== 'online';
  const usingCache = cacheOffline || deviceOffline;
  const cachedTask = useTaskStore((state) => state.tasks.find((item) => (item.task_id ?? item.id) === taskId) ?? null);
  const [task, setTask] = useState<TaskRecord | null>(() => usingCache ? cachedTask : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const loadRequest = useRef(0);
  const activeTaskId = useRef(taskId);
  const taskGeneration = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    const isCurrent = () => request === loadRequest.current;
    if (deviceOffline) {
      setTask(cachedTask);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const nextTask = await getTask(taskId);
      if (!isCurrent()) return;
      setTask(nextTask);
      useTaskStore.setState({ isOffline: false });
    } catch (reason) {
      if (!isCurrent()) return;
      if (reason instanceof Error && reason.message === NETWORK_ERROR_MESSAGE) {
        useTaskStore.setState({ isOffline: true });
        setTask(cachedTask);
        if (!cachedTask) setError(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : '任务加载失败，请稍后重试');
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [cachedTask, deviceOffline, taskId]);

  useLayoutEffect(() => {
    if (activeTaskId.current === taskId) return;
    activeTaskId.current = taskId;
    loadRequest.current += 1;
    taskGeneration.current += 1;
    setTask(usingCache ? cachedTask : null);
    setError(null);
    setLoading(true);
    setActioning(false);
  }, [cachedTask, taskId, usingCache]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => {
    loadRequest.current += 1;
    taskGeneration.current += 1;
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !deviceOffline) void load();
    });
    return () => subscription.remove();
  }, [deviceOffline, load]);

  const retry = async () => {
    if (!task || actioning || retryBlocked) return;
    const generation = taskGeneration.current;
    const isCurrent = () => generation === taskGeneration.current;
    setActioning(true);
    try {
      const result = await retryTaskFiles(task.task_id ?? task.id);
      if (!isCurrent()) return;
      showToast(`已重新提交 ${result.retry_files} 个文件`, 'success');
      await load();
    } catch (reason) {
      if (isCurrent()) showToast(reason instanceof Error ? reason.message : '重试失败，请稍后重试', 'error');
    } finally {
      if (isCurrent()) setActioning(false);
    }
  };

  const share = async () => {
    const path = task ? taskDownloadInfo(task)?.path ?? null : null;
    if (!path || actioning || deviceOffline) return;
    const generation = taskGeneration.current;
    const isCurrent = () => generation === taskGeneration.current;
    setActioning(true);
    try {
      await downloadAndShareReport(path);
    } catch (reason) {
      if (isCurrent()) showToast(reason instanceof Error ? reason.message : '报告下载失败，请稍后重试', 'error');
    } finally {
      if (isCurrent()) setActioning(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <AppHeader
        leadingAction={{ type: 'back', onPress: onBack }}
        trailingAction={{ type: 'refresh', onPress: () => void load(), disabled: deviceOffline }}
        title="任务详情"
      />
      {loading && !task ? <View style={styles.state}><ScreenState state="loading" /></View> : null}
      {!loading && !task && deviceOffline ? <View style={styles.state}><ScreenState state="offline" /></View> : null}
      {!loading && !task && !deviceOffline ? <View style={styles.state}><ScreenState actionLabel="重新加载" description={error ?? undefined} onAction={() => void load()} state="error" /></View> : null}
      {task ? <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {deviceOffline ? <Text style={styles.offline}>当前为离线状态，刷新、重试和分享暂不可用</Text> : null}
        {!deviceOffline && cacheOffline ? <Text style={styles.offline}>当前展示缓存状态，可刷新获取最新结果</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TaskDetailContent
          actioning={actioning}
          deviceOffline={deviceOffline}
          onDownload={() => void share()}
          onOpenRecords={onOpenRecords}
          onRetry={() => void retry()}
          retryBlocked={retryBlocked}
          task={task}
        />
      </ScrollView> : null}
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background.canvas, flex: 1 },
    state: { flex: 1 },
    content: { padding: 16 },
    offline: { color: theme.status.warning, fontSize: 13, letterSpacing: 0, lineHeight: 19, textAlign: 'center' },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0, textAlign: 'center' },
  });
}
