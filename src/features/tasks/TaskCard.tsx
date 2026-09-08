import { CheckCircle2, CircleAlert, Clock3, Database, LoaderCircle } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { TASK_RUN_STATUS_LABELS, taskRunStatus, type TaskRecord } from '@/types/task';
import { formatBeijingDateTime } from '@/utils/time';
import { taskError, taskLabel, taskStage, useTaskStageElapsed } from './taskPresentation';

type TaskCardProps = {
  onPress?: () => void;
  task: TaskRecord;
};

export function TaskCard({ onPress, task }: TaskCardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const runStatus = taskRunStatus(task);
  const status = getStatusPresentation(runStatus, theme, task.task_type === 'research');
  const message = taskError(task);
  const cached = task.meta?.cached === true;
  const stage = taskStage(task);
  const elapsed = useTaskStageElapsed(stage?.started_at);
  const progress = stage?.current !== undefined && stage.total !== undefined
    ? { current: stage.current, total: stage.total, percent: (stage.current / stage.total) * 100 }
    : null;
  const content = (
    <>
      <View style={styles.topLine}>
        <View style={styles.statusLine}>
          <status.Icon color={status.color} size={18} strokeWidth={1.9} />
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
        </View>
        <Text style={styles.time}>{formatBeijingDateTime(task.updated_at)}</Text>
      </View>
      <Text numberOfLines={2} style={styles.title}>{taskLabel(task)}</Text>
      {stage ? <View style={styles.stage}>
        <View style={styles.stageTopLine}>
          <Text style={styles.stageLabel}>{stage.label}</Text>
          {progress ? <Text style={styles.stageProgressText}>{progress.current} / {progress.total}</Text> : null}
        </View>
        {stage.detail ? <Text numberOfLines={2} style={styles.stageDetail}>{stage.detail}</Text> : null}
        {progress ? <View
          accessible
          accessibilityLabel={`${stage.label}，进度 ${progress.current} / ${progress.total}`}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: progress.total, now: progress.current, text: `${progress.current} / ${progress.total}` }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressFill, { width: `${progress.percent}%` as `${number}%` }]} />
        </View> : null}
        {elapsed ? <Text style={styles.elapsed}>{elapsed}</Text> : null}
      </View> : null}
      <View style={styles.footer}>
        <Text style={styles.type}>{task.task_type}</Text>
        {cached ? (
          <View style={styles.cacheBadge}>
            <Database color={theme.text.secondary} size={13} />
            <Text style={styles.cacheText}>已缓存</Text>
          </View>
        ) : null}
      </View>
      {message ? <Text numberOfLines={2} style={styles.message}>{message}</Text> : null}
    </>
  );

  if (!onPress) return <View style={styles.card}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`查看任务：${taskLabel(task)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function getStatusPresentation(status: TaskRecord['status'], theme: AppTheme, research: boolean) {
  const researchLabel = research && status in TASK_RUN_STATUS_LABELS
    ? TASK_RUN_STATUS_LABELS[status as keyof typeof TASK_RUN_STATUS_LABELS]
    : null;
  if (status === 'completed') return { Icon: CheckCircle2, color: theme.status.success, label: researchLabel ?? '已完成' };
  if (status === 'failed') return { Icon: CircleAlert, color: theme.status.danger, label: researchLabel ?? '失败' };
  if (status === 'cancelled') return { Icon: CircleAlert, color: theme.text.secondary, label: researchLabel ?? '已取消' };
  if (status === 'running' || status === 'validating') return { Icon: LoaderCircle, color: theme.status.info, label: researchLabel ?? '进行中' };
  if (status === 'retrying') return { Icon: LoaderCircle, color: theme.status.info, label: '重试中' };
  return { Icon: Clock3, color: theme.text.secondary, label: researchLabel ?? '等待中' };
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.background.surface,
      borderColor: theme.border.default,
      borderRadius: 8,
      borderWidth: 1,
      gap: 8,
      padding: 14,
    },
    topLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minWidth: 0 },
    statusLine: { alignItems: 'center', flexDirection: 'row', gap: 6, minWidth: 0 },
    status: { fontSize: 13, fontWeight: '600', letterSpacing: 0 },
    time: { color: theme.text.muted, flexShrink: 1, fontSize: 12, letterSpacing: 0, marginLeft: 8 },
    title: { color: theme.text.primary, fontSize: 16, lineHeight: 22, letterSpacing: 0 },
    stage: { backgroundColor: theme.background.canvas, borderRadius: 8, gap: 6, padding: 10 },
    stageTopLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    stageLabel: { color: theme.text.primary, flex: 1, fontSize: 13, fontWeight: '600', letterSpacing: 0 },
    stageDetail: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 18 },
    stageProgressText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    progressTrack: { backgroundColor: theme.border.default, borderRadius: 999, height: 6, overflow: 'hidden' },
    progressFill: { backgroundColor: theme.status.info, borderRadius: 999, height: 6 },
    elapsed: { color: theme.text.muted, fontSize: 12, letterSpacing: 0 },
    footer: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    type: { color: theme.text.secondary, flex: 1, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    cacheBadge: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    cacheText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    message: { color: theme.text.secondary, fontSize: 13, lineHeight: 19, letterSpacing: 0 },
    pressed: { opacity: 0.68 },
  });
}
