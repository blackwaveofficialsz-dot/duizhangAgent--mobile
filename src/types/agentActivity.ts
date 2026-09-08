export type AgentActivityStepStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type AgentActivityStatus = AgentActivityStepStatus | 'partial' | 'empty' | 'unavailable';

export interface AgentActivityStep {
  step_id: string;
  label: string;
  detail?: string;
  status: AgentActivityStepStatus;
  elapsed_ms: number;
  sequence: number;
}

export interface AgentActivity {
  version: 'v1';
  status: AgentActivityStatus;
  label: string;
  elapsed_ms: number;
  total_duration_ms?: number;
  steps: AgentActivityStep[];
  scope: string[];
  sources: string[];
}

const ACTIVITY_STATUSES = new Set<AgentActivityStatus>([
  'running', 'completed', 'partial', 'empty', 'unavailable', 'failed', 'cancelled', 'interrupted',
]);

const STEP_ACTIVITY_STATUSES = new Set<AgentActivityStepStatus>([
  'running', 'completed', 'failed', 'cancelled', 'interrupted',
]);

const TERMINAL_LABELS: Record<Exclude<AgentActivityStatus, 'running'>, string> = {
  completed: '分析活动已完成',
  partial: '分析结果不完整',
  empty: '暂无匹配数据',
  unavailable: '数据暂不可用',
  failed: '分析活动失败',
  cancelled: '分析活动已停止',
  interrupted: '分析活动已中断',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === '') return undefined;
  return boundedString(value, maxLength);
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function activityStatus(value: unknown): AgentActivityStatus | null {
  return typeof value === 'string' && ACTIVITY_STATUSES.has(value as AgentActivityStatus)
    ? value as AgentActivityStatus
    : null;
}

function activityStepStatus(value: unknown): AgentActivityStepStatus | null {
  return typeof value === 'string' && STEP_ACTIVITY_STATUSES.has(value as AgentActivityStepStatus)
    ? value as AgentActivityStepStatus
    : null;
}

function parseLabels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const labels = value.map((item) => boundedString(item, 60));
  return labels.every((item): item is string => item !== null) ? labels : null;
}

export function parsePublicAgentActivityStep(value: unknown): AgentActivityStep | null {
  if (!isRecord(value) || value.visibility !== 'public') return null;
  const stepId = boundedString(value.step_id, 64);
  const label = boundedString(value.label, 24);
  const detail = optionalBoundedString(value.detail, 60);
  const status = activityStepStatus(value.status);
  if (
    !stepId
    || !label
    || detail === null
    || !status
    || !safeNonNegativeInteger(value.elapsed_ms)
    || !safeNonNegativeInteger(value.sequence)
  ) return null;
  return {
    step_id: stepId,
    label,
    ...(detail ? { detail } : {}),
    status,
    elapsed_ms: value.elapsed_ms,
    sequence: value.sequence,
  };
}

export function parseAgentActivity(value: unknown): AgentActivity | null {
  if (!isRecord(value) || value.version !== 'v1') return null;
  const status = activityStatus(value.status);
  const label = boundedString(value.label, 80);
  const scope = parseLabels(value.scope);
  const sources = parseLabels(value.sources);
  const totalDurationMs = value.total_duration_ms === undefined
    ? undefined
    : safeNonNegativeInteger(value.total_duration_ms) ? value.total_duration_ms : null;
  if (
    !status
    || !label
    || !safeNonNegativeInteger(value.elapsed_ms)
    || totalDurationMs === null
    || !Array.isArray(value.steps)
    || value.steps.length > 6
    || !scope
    || !sources
  ) return null;

  const steps: AgentActivityStep[] = [];
  for (const [index, rawStep] of value.steps.entries()) {
    if (!isRecord(rawStep)) return null;
    const stepId = boundedString(rawStep.step_id, 64);
    const stepLabel = boundedString(rawStep.label, 24);
    const stepStatus = activityStepStatus(rawStep.status);
    if (!stepId || !stepLabel || !stepStatus || !safeNonNegativeInteger(rawStep.elapsed_ms)) return null;
    steps.push({
      step_id: stepId,
      label: stepLabel,
      status: stepStatus,
      elapsed_ms: rawStep.elapsed_ms,
      sequence: index + 1,
    });
  }

  return {
    version: 'v1',
    status,
    label,
    elapsed_ms: value.elapsed_ms,
    ...(totalDurationMs === undefined ? {} : { total_duration_ms: totalDurationMs }),
    steps,
    scope,
    sources,
  };
}

function totalElapsed(steps: AgentActivityStep[]): number {
  return steps.reduce((total, step) => Math.min(Number.MAX_SAFE_INTEGER, total + step.elapsed_ms), 0);
}

export function mergeAgentActivityStep(
  activity: AgentActivity | null | undefined,
  step: AgentActivityStep,
): AgentActivity {
  if (!activity) {
    return {
      version: 'v1',
      status: 'running',
      label: step.label,
      elapsed_ms: step.elapsed_ms,
      steps: [step],
      scope: [],
      sources: [],
    };
  }

  if (activity.status !== 'running') return activity;

  const existingIndex = activity.steps.findIndex((item) => item.step_id === step.step_id);
  if (existingIndex < 0 && activity.steps.length >= 6) return activity;
  const steps = activity.steps.slice();
  if (existingIndex >= 0) {
    const previous = steps[existingIndex];
    steps[existingIndex] = {
      ...previous,
      ...(step.detail === undefined ? {} : { detail: step.detail }),
      status: step.status,
      elapsed_ms: step.elapsed_ms,
    };
  } else {
    steps.push(step);
  }
  steps.sort((left, right) => left.sequence - right.sequence || left.step_id.localeCompare(right.step_id));
  const currentStep = existingIndex >= 0 ? steps.find((item) => item.step_id === step.step_id)! : step;
  return {
    ...activity,
    status: 'running',
    label: currentStep.label,
    elapsed_ms: totalElapsed(steps),
    steps,
  };
}

export function finishAgentActivity(
  activity: AgentActivity | null | undefined,
  status: Exclude<AgentActivityStatus, 'running'>,
  force = false,
): AgentActivity | null | undefined {
  if (!activity || (!force && activity.status !== 'running')) return activity;
  return {
    ...activity,
    status,
    label: TERMINAL_LABELS[status],
    steps: activity.steps.map((step) => step.status === 'running'
      ? { ...step, status: status === 'failed' || status === 'cancelled' || status === 'interrupted' ? status : 'completed' }
      : step),
  };
}
