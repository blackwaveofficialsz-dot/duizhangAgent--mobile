import type { MessageItem } from './chat';

export type AgentResponseMetric = {
  key: string;
  value: string;
  label?: string;
  unit?: string;
};

export type AgentResponseColumn = {
  key: string;
  label: string;
  data_type?: string;
  format?: string;
  unit?: string;
};

export type AgentResponseInsight = {
  statement_type: 'fact' | 'hypothesis' | 'recommendation';
  text: string;
  evidence_refs: string[];
};

export type AgentResponsePart = {
  kind: string;
  title?: string;
  message?: string;
  metrics?: AgentResponseMetric[];
  table_id?: string;
  row_count?: number;
  columns?: AgentResponseColumn[];
  preview_rows?: Array<Record<string, unknown>>;
  items?: AgentResponseInsight[];
  severity?: 'info' | 'warning' | 'error';
  code?: string;
};

export type AgentResponseAction = {
  action_id: string;
  kind: string;
  label: string;
  result_id?: string;
  source_turn_id?: string;
  params?: Record<string, unknown>;
};

export type ClarificationAction = AgentResponseAction & {
  kind: 'clarify';
  source_turn_id: string;
  params: {
    candidate_id: string;
    message: string;
  };
};

export type ChatInteraction = {
  kind: 'clarification_choice';
  source_turn_id: string;
  candidate_id: string;
};

export type AgentResponseLimitation = {
  code: string;
  text: string;
};

export type AgentResponsePayload = {
  version: 1;
  domain: string;
  task: string;
  result_status: 'ok' | 'partial' | 'empty' | 'unavailable' | 'failed';
  result_id: string;
  source_turn_id: string;
  content: string;
  parts: AgentResponsePart[];
  limitations: AgentResponseLimitation[];
  actions: AgentResponseAction[];
};

const RESULT_STATUSES = new Set<AgentResponsePayload['result_status']>([
  'ok', 'partial', 'empty', 'unavailable', 'failed',
]);
const STATEMENT_TYPES = new Set<AgentResponseInsight['statement_type']>([
  'fact', 'hypothesis', 'recommendation',
]);
const NOTICE_SEVERITIES = new Set<NonNullable<AgentResponsePart['severity']>>([
  'info', 'warning', 'error',
]);
const MAX_AGENT_RESPONSE_BYTES = 256 * 1024;

export function parseAgentResponsePayload(value: unknown): AgentResponsePayload | null {
  const source = record(value);
  if (!source || serializedPayloadBytes(value) > MAX_AGENT_RESPONSE_BYTES || source.version !== 1 || typeof source.content !== 'string') return null;
  const domain = boundedText(source.domain, 64);
  const task = boundedText(source.task, 64);
  const resultId = boundedText(source.result_id, 160);
  const sourceTurnId = boundedText(source.source_turn_id, 160);
  const resultStatus = parseResultStatus(source.result_status);
  const parts = parseParts(source.parts);
  const actions = parseActions(source.actions, sourceTurnId);
  const limitations = parseLimitations(source.limitations);
  if (!domain || !task || !resultId || !sourceTurnId || !resultStatus || !parts || !actions || !limitations) return null;
  return {
    version: 1,
    domain,
    task,
    result_status: resultStatus,
    result_id: resultId,
    source_turn_id: sourceTurnId,
    content: source.content,
    parts,
    limitations,
    actions,
  };
}

export function agentResponseFromMetadata(value: unknown): AgentResponsePayload | null {
  return parseAgentResponsePayload(record(value)?.agent_response);
}

export function normalizeMessageAgentResponse(message: MessageItem): MessageItem {
  const response = parseAgentResponsePayload(message.agentResponse)
    ?? agentResponseFromMetadata(message.metadata);
  const { agentResponse: _agentResponse, ...withoutAgentResponse } = message;
  return response ? { ...withoutAgentResponse, agentResponse: response } : withoutAgentResponse;
}

function parseResultStatus(value: unknown): AgentResponsePayload['result_status'] | null {
  return typeof value === 'string' && RESULT_STATUSES.has(value as AgentResponsePayload['result_status'])
    ? value as AgentResponsePayload['result_status']
    : null;
}

function parseParts(value: unknown): AgentResponsePart[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value.map(parsePart);
  return parts.every((part): part is AgentResponsePart => part !== null) ? parts : null;
}

function parsePart(value: unknown): AgentResponsePart | null {
  const source = record(value);
  const kind = boundedText(source?.kind, 64);
  if (!source || !kind) return null;
  const part: AgentResponsePart = { kind };
  if (!copyOptionalText(source, part, 'title', 160) || !copyOptionalText(source, part, 'message', 500) || !copyOptionalText(source, part, 'table_id', 160)) return null;
  if (source.row_count !== undefined) {
    if (typeof source.row_count !== 'number' || !Number.isInteger(source.row_count) || source.row_count < 0) return null;
    part.row_count = source.row_count;
  }
  if (source.metrics !== undefined) {
    const metrics = parseMetrics(source.metrics);
    if (!metrics) return null;
    part.metrics = metrics;
  }
  if (source.columns !== undefined) {
    const columns = parseColumns(source.columns);
    if (!columns) return null;
    part.columns = columns;
  }
  if (source.preview_rows !== undefined) {
    if (!Array.isArray(source.preview_rows) || source.preview_rows.length > 50 || !source.preview_rows.every(record)) return null;
    part.preview_rows = source.preview_rows.map((row) => ({ ...row }));
  }
  if (kind === 'summary' && part.metrics && part.metrics.length > 6) return null;
  if (kind === 'insights') {
    const items = parseInsights(source.items);
    if (!items) return null;
    part.items = items;
  }
  if (kind === 'notice') {
    const severity = source.severity;
    const code = boundedText(source.code, 160);
    const message = boundedText(source.message, 500);
    const parsedSeverity = severity as NonNullable<AgentResponsePart['severity']>;
    if (!message || typeof severity !== 'string' || !NOTICE_SEVERITIES.has(parsedSeverity) || !code) return null;
    part.message = message;
    part.severity = parsedSeverity;
    part.code = code;
  }
  return part;
}

function parseMetrics(value: unknown): AgentResponseMetric[] | null {
  if (!Array.isArray(value)) return null;
  const metrics = value.map((item) => {
    const source = record(item);
    const key = boundedText(source?.key, 160);
    if (!source || !key || typeof source.value !== 'string') return null;
    const metric: AgentResponseMetric = { key, value: source.value };
    if (!copyOptionalText(source, metric, 'label', 160) || !copyOptionalText(source, metric, 'unit', 64)) return null;
    return metric;
  });
  return metrics.every((metric): metric is AgentResponseMetric => metric !== null) ? metrics : null;
}

function parseColumns(value: unknown): AgentResponseColumn[] | null {
  if (!Array.isArray(value)) return null;
  const columns = value.map((item) => {
    const source = record(item);
    const key = boundedText(source?.key, 160);
    const label = boundedText(source?.label, 160);
    if (!source || !key || !label) return null;
    const column: AgentResponseColumn = { key, label };
    if (!copyOptionalText(source, column, 'data_type', 64) || !copyOptionalText(source, column, 'format', 64) || !copyOptionalText(source, column, 'unit', 64)) return null;
    return column;
  });
  return columns.every((column): column is AgentResponseColumn => column !== null) ? columns : null;
}

function parseInsights(value: unknown): AgentResponseInsight[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  const items = value.map((item) => {
    const source = record(item);
    const text = boundedText(source?.text, 500);
    if (!source || !text || typeof source.statement_type !== 'string' || !STATEMENT_TYPES.has(source.statement_type as AgentResponseInsight['statement_type']) || !Array.isArray(source.evidence_refs)) return null;
    const evidenceRefs = source.evidence_refs.map((reference) => boundedText(reference, 160));
    if (!evidenceRefs.every((reference): reference is string => Boolean(reference)) || (source.statement_type === 'recommendation' && !evidenceRefs.length)) return null;
    return { statement_type: source.statement_type as AgentResponseInsight['statement_type'], text, evidence_refs: evidenceRefs };
  });
  return items.every((item): item is AgentResponseInsight => item !== null) ? items : null;
}

function parseActions(value: unknown, sourceTurnId: string | null): AgentResponseAction[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6 || !sourceTurnId) return null;
  let promptCount = 0;
  let clarificationCount = 0;
  const actions = value.map((item) => {
    const source = record(item);
    const actionId = boundedText(source?.action_id, 160);
    const kind = boundedText(source?.kind, 64);
    const label = boundedText(source?.label, 160);
    if (!source || !actionId || !kind || !label) return null;
    const action: AgentResponseAction = { action_id: actionId, kind, label };
    if (!copyOptionalText(source, action, 'result_id', 160) || !copyOptionalText(source, action, 'source_turn_id', 160)) return null;
    if (source.params !== undefined && !record(source.params)) return null;
    if (kind === 'prompt') {
      promptCount += 1;
      const params = record(source.params);
      const message = boundedText(params?.message, 500);
      if (promptCount > 3 || action.source_turn_id !== sourceTurnId || !params || Object.keys(params).length !== 1 || !message) return null;
      action.params = { message };
    } else if (kind === 'clarify') {
      clarificationCount += 1;
      if (clarificationCount > 4 || !isClarificationAction(source, sourceTurnId)) return null;
      action.params = {
        candidate_id: source.params.candidate_id,
        message: source.params.message,
      };
    } else if (source.params) {
      action.params = { ...source.params };
    }
    return action;
  });
  return actions.every((action): action is AgentResponseAction => action !== null) ? actions : null;
}

export function isClarificationAction(value: unknown, sourceTurnId?: string): value is ClarificationAction {
  const source = record(value);
  const params = record(source?.params);
  return Boolean(
    source
    && source.kind === 'clarify'
    && boundedText(source.action_id, 160)
    && boundedText(source.label, 160)
    && boundedText(source.source_turn_id, 160)
    && (!sourceTurnId || source.source_turn_id === sourceTurnId)
    && params
    && Object.keys(params).length === 2
    && Object.prototype.hasOwnProperty.call(params, 'candidate_id')
    && Object.prototype.hasOwnProperty.call(params, 'message')
    && boundedText(params.candidate_id, 500)
    && boundedText(params.message, 500),
  );
}

function copyOptionalText(source: Record<string, unknown>, target: object, key: string, maxLength: number): boolean {
  if (source[key] === undefined) return true;
  const value = boundedText(source[key], maxLength);
  if (!value) return false;
  Object.assign(target, { [key]: value });
  return true;
}

function parseLimitations(value: unknown): AgentResponseLimitation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) return null;
  const limitations = value.map((item) => {
    const source = record(item);
    const code = boundedText(source?.code, 160);
    const text = boundedText(source?.text, 500);
    return code && text ? { code, text } : null;
  });
  return limitations.every((item): item is AgentResponseLimitation => item !== null) ? limitations : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function serializedPayloadBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? new TextEncoder().encode(serialized).length : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
