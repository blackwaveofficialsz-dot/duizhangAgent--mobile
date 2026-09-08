import { Download, RefreshCw } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { TASK_RUN_STATUS_LABELS, taskRunStatus, type TaskRecord } from '@/types/task';
import { formatBeijingDateTime } from '@/utils/time';
import { isRetryableTask, taskDownloadInfo, taskLabel, taskOutputText, taskStage, useTaskStageElapsed, visibleTaskMetaEntries } from './taskPresentation';

type TaskDetailContentProps = {
  actioning: boolean;
  deviceOffline: boolean;
  onDownload: () => void;
  onOpenRecords: (runId: string) => void;
  onRetry: () => void;
  retryBlocked: boolean;
  task: TaskRecord;
};

const statusLabels: Record<string, string> = {
  completed: '已完成',
  failed: '失败',
  pending: '等待中',
  retrying: '重试中',
  running: '执行中',
};

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function isLongValue(value: string): boolean {
  return value.length > 240 || value.split('\n').length > 8;
}

export function TaskDetailContent({
  actioning,
  deviceOffline,
  onDownload,
  onOpenRecords,
  onRetry,
  retryBlocked,
  task,
}: TaskDetailContentProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const file = taskDownloadInfo(task);
  const status = taskRunStatus(task);
  const stage = taskStage(task);
  const elapsed = useTaskStageElapsed(stage?.started_at);
  const progress = stage?.current !== undefined && stage.total !== undefined
    ? { current: stage.current, total: stage.total, percent: (stage.current / stage.total) * 100 }
    : null;
  const statusColor = status === 'completed'
    ? theme.status.success
    : status === 'failed'
      ? theme.status.danger
      : status === 'running' || status === 'retrying' || status === 'validating'
        ? theme.status.info
        : theme.status.warning;
  const runId = task.task_type === 'connector_sync' && task.status === 'completed' && typeof task.meta?.connector_sync_run_id === 'string'
    ? task.meta.connector_sync_run_id
    : null;

  return <>
    <View style={styles.summary}>
      <View style={styles.summaryTop}>
        <Text selectable style={styles.title}>{taskLabel(task)}</Text>
        <Text style={[styles.status, { color: statusColor }]}>{
          task.task_type === 'research' && status in TASK_RUN_STATUS_LABELS
            ? TASK_RUN_STATUS_LABELS[status as keyof typeof TASK_RUN_STATUS_LABELS]
            : statusLabels[status] ?? status
        }</Text>
      </View>
      <Text selectable style={styles.summaryText}>创建于 {formatBeijingDateTime(task.created_at)}，最后更新 {formatBeijingDateTime(task.updated_at)}</Text>
    </View>

    {stage ? <Section title="当前阶段">
      <View style={styles.stage}>
        <View style={styles.stageTopLine}>
          <Text selectable style={styles.stageLabel}>{stage.label}</Text>
          {progress ? <Text style={styles.stageProgressText}>{progress.current} / {progress.total}</Text> : null}
        </View>
        {stage.detail ? <Text selectable style={styles.stageDetail}>{stage.detail}</Text> : null}
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
      </View>
    </Section> : null}

    <Section title="输出结果">
      <Text selectable style={status === 'failed' ? styles.errorOutput : styles.output}>{taskOutputText(task)}</Text>
    </Section>

    {file ? <Section title="文件">
      <Text selectable style={styles.fileName}>{file.filename}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: actioning || deviceOffline }}
        disabled={actioning || deviceOffline}
        onPress={onDownload}
        style={[styles.primaryAction, (actioning || deviceOffline) && styles.disabled]}
      >
        <Download color={theme.action.onPrimary} size={19} strokeWidth={1.8} />
        <Text style={styles.primaryActionText}>下载并分享报告</Text>
      </Pressable>
    </Section> : null}

    {runId ? <Section title="连接器同步结果">
      <Pressable accessibilityRole="button" onPress={() => onOpenRecords(runId)} style={styles.secondaryAction}>
        <Text style={styles.secondaryActionText}>查看同步结果</Text>
      </Pressable>
    </Section> : null}

    <Section title="基础信息">
      <InfoRow label="任务 ID" value={task.task_id || '—'} />
      <InfoRow label="Celery ID" value={task.celery_task_id || '—'} />
      <InfoRow label="会话/来源" value={task.session_id || '—'} />
    </Section>

    <Section title="任务数据">
      {visibleTaskMetaEntries(task).length === 0 ? <Text style={styles.empty}>暂无额外数据</Text> : visibleTaskMetaEntries(task).map(([key, rawValue]) => {
        const value = displayValue(rawValue);
        const collapsible = isLongValue(value);
        const open = expanded[key] === true;
        return <View key={key} style={styles.metaEntry}>
          <Text selectable style={styles.metaKey}>{key}</Text>
          <Text selectable numberOfLines={collapsible && !open ? 8 : undefined} style={styles.metaValue}>{value}</Text>
          {collapsible ? <Pressable
            accessibilityLabel={`${open ? '收起' : '展开'} ${key}`}
            accessibilityRole="button"
            onPress={() => setExpanded((current) => ({ ...current, [key]: !open }))}
            style={styles.expandAction}
          >
            <Text style={styles.expandActionText}>{open ? `收起 ${key}` : `展开 ${key}`}</Text>
          </Pressable> : null}
        </View>;
      })}
    </Section>

    {isRetryableTask(task) ? <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: actioning || retryBlocked }}
      disabled={actioning || retryBlocked}
      onPress={onRetry}
      style={[styles.secondaryAction, (actioning || retryBlocked) && styles.disabled]}
    >
      <RefreshCw color={theme.text.primary} size={18} strokeWidth={1.8} />
      <Text style={styles.secondaryActionText}>重试失败文件</Text>
    </Pressable> : null}
  </>;
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text selectable style={styles.infoValue}>{value}</Text></View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    summary: { gap: 6, paddingBottom: 16 },
    summaryTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    title: { color: theme.text.primary, flex: 1, fontSize: 20, fontWeight: '400', letterSpacing: 0, lineHeight: 29 },
    status: { fontSize: 13, fontWeight: '600', letterSpacing: 0 },
    summaryText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 12, paddingVertical: 16 },
    sectionTitle: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    stage: { backgroundColor: theme.background.canvas, borderRadius: 8, gap: 8, padding: 12 },
    stageTopLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    stageLabel: { color: theme.text.primary, flex: 1, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    stageDetail: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
    stageProgressText: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    progressTrack: { backgroundColor: theme.border.default, borderRadius: 999, height: 7, overflow: 'hidden' },
    progressFill: { backgroundColor: theme.status.info, borderRadius: 999, height: 7 },
    elapsed: { color: theme.text.muted, fontSize: 12, letterSpacing: 0 },
    output: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    errorOutput: { color: theme.status.danger, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    fileName: { color: theme.text.primary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    primaryAction: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
    primaryActionText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    secondaryAction: { alignItems: 'center', borderColor: theme.border.strong, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
    secondaryActionText: { color: theme.text.primary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
    infoRow: { gap: 4 },
    infoLabel: { color: theme.text.muted, fontSize: 12, letterSpacing: 0 },
    infoValue: { color: theme.text.primary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    metaEntry: { backgroundColor: theme.background.canvas, borderRadius: 8, gap: 5, padding: 10 },
    metaKey: { color: theme.text.muted, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    metaValue: { color: theme.text.secondary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0, lineHeight: 18 },
    expandAction: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
    expandActionText: { color: theme.action.primary, fontSize: 13, letterSpacing: 0 },
    empty: { color: theme.text.muted, fontSize: 14, letterSpacing: 0 },
    disabled: { opacity: 0.48 },
  });
}
