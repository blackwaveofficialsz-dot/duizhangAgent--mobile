import type { AgentRunStatus } from './agentRun';

export type TaskStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed' | string;

const AGENT_RUN_STATUSES = new Set<AgentRunStatus>([
  'queued', 'running', 'validating', 'waiting_for_data', 'waiting_for_approval',
  'needs_review', 'completed', 'failed', 'cancelled',
]);

export const TASK_RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: '研究任务排队中',
  running: '正在研究',
  validating: '正在校验结果',
  waiting_for_data: '等待补充资料',
  waiting_for_approval: '等待审批',
  needs_review: '待人工复核',
  completed: '研究完成',
  failed: '研究失败',
  cancelled: '研究已取消',
};

export type TaskStage = {
  code: string;
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  started_at?: string;
};

export type TaskRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
  task_type: string;
  status: TaskStatus;
  task_id: string | null;
  celery_task_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type TaskFilters = {
  status?: string;
  taskType?: string;
  limit?: number;
};

export type RetryFilesResult = {
  ok: boolean;
  task_id: string;
  retry_files: number;
};

export function taskRunStatus(task: TaskRecord): AgentRunStatus | TaskStatus {
  const runStatus = task.meta?.run_status;
  return isAgentRunStatus(runStatus)
    ? runStatus as AgentRunStatus
    : task.status;
}

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && AGENT_RUN_STATUSES.has(value as AgentRunStatus);
}
