import { useEffect, useState } from 'react';
import { TASK_RUN_STATUS_LABELS, taskRunStatus, type TaskRecord, type TaskStage } from '@/types/task';

const ACTIVE_TASK_STATUSES = new Set(['pending', 'queued', 'running', 'retrying', 'validating']);

const TASK_LABELS: Record<string, string> = {
  connector_sync: '连接器同步',
  file_parsing: '文件解析',
  finance_report: '财务报表',
  hr_sync: '人事同步',
  reconciliation: '对账',
  salary_report: '工资表',
  research: 'Research Agent',
};

export function taskLabel(task: TaskRecord): string {
  const customName = task.meta?.task_name;
  return typeof customName === 'string' && customName.trim()
    ? customName
    : TASK_LABELS[task.task_type] ?? task.task_type;
}

export function taskError(task: TaskRecord): string | null {
  const value = taskRunStatus(task) === 'failed'
    ? task.meta?.error ?? task.meta?.detail ?? task.meta?.agent_message
    : task.meta?.agent_message ?? task.meta?.error ?? task.meta?.detail;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function taskStage(task: TaskRecord): TaskStage | null {
  const value = task.meta?.stage;
  if (!ACTIVE_TASK_STATUSES.has(taskRunStatus(task)) || !isRecord(value)) return null;

  const { code, label, detail, current, total, started_at: startedAt } = value;
  if (!isNonEmptyString(code) || !isNonEmptyString(label)) return null;
  if (detail !== undefined && !isNonEmptyString(detail)) return null;

  const hasProgress = current !== undefined || total !== undefined;
  if (hasProgress && (
    !Number.isInteger(current)
    || !Number.isInteger(total)
    || (current as number) < 0
    || (total as number) <= 0
    || (current as number) > (total as number)
  )) return null;

  if (startedAt !== undefined && (
    !isNonEmptyString(startedAt)
    || !Number.isFinite(Date.parse(startedAt))
  )) return null;

  const stage: TaskStage = { code: code.trim(), label: label.trim() };
  if (detail !== undefined) stage.detail = detail.trim();
  if (hasProgress) {
    stage.current = current as number;
    stage.total = total as number;
  }
  if (startedAt !== undefined) stage.started_at = startedAt;
  return stage;
}

export function useTaskStageElapsed(startedAt: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return `已耗时 ${hours} 小时 ${minutes} 分 ${seconds} 秒`;
  if (minutes > 0) return `已耗时 ${minutes} 分 ${seconds} 秒`;
  return `已耗时 ${seconds} 秒`;
}

export function isRetryableTask(task: TaskRecord): boolean {
  return task.status === 'failed'
    && task.task_type === 'file_parsing'
    && Array.isArray(task.meta?.retryable_files)
    && task.meta.retryable_files.length > 0;
}

export function taskDownloadPath(task: TaskRecord): string | null {
  const downloadUrl = task.meta?.download_url;
  if (
    (task.task_type === 'finance_report' || task.task_type === 'salary_report')
    && typeof downloadUrl === 'string'
    && downloadUrl.trim()
  ) return downloadUrl;

  const period = task.meta?.period;
  if (
    task.task_type === 'reconciliation'
    && task.status === 'completed'
    && typeof period === 'string'
    && period
  ) {
    return `/api/v1/reconcile/export/${encodeURIComponent(period)}`;
  }
  return null;
}

export function taskOutputText(task: TaskRecord): string {
  const status = taskRunStatus(task);
  if (ACTIVE_TASK_STATUSES.has(status)) {
    return '任务正在处理中，完成后这里会展示输出数据。';
  }
  if (status === 'failed') {
    return taskError(task) ?? '任务执行失败，请查看任务数据中的错误信息。';
  }
  if (
    status === 'waiting_for_data'
    || status === 'waiting_for_approval'
    || status === 'needs_review'
    || status === 'cancelled'
  ) return TASK_RUN_STATUS_LABELS[status];
  if (typeof task.meta?.summary === 'string' && task.meta.summary.trim()) return task.meta.summary;
  if (task.task_type === 'reconciliation') return '对账任务已完成。匹配数量、待复核数量和导出状态见任务数据。';
  return '任务已完成。';
}

export function taskDownloadInfo(task: TaskRecord): { filename: string; path: string } | null {
  const path = taskDownloadPath(task);
  if (!path) return null;
  const filename = typeof task.meta?.filename === 'string'
    ? task.meta.filename
    : task.task_type === 'salary_report'
      ? '工资表.xlsx'
      : task.task_type === 'reconciliation' && typeof task.meta?.period === 'string'
        ? `reconcile_${task.meta.period.replace('-', '_')}.xlsx`
        : '财务报表.xlsx';
  return { filename, path };
}

export function visibleTaskMetaEntries(task: TaskRecord): Array<[string, unknown]> {
  const hidden = new Set(['download_url', 'artifact_id']);
  return Object.entries(task.meta ?? {}).filter(([key]) => !hidden.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
