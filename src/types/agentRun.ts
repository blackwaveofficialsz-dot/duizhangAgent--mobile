export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'validating'
  | 'waiting_for_data'
  | 'waiting_for_approval'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRunEventEnvelope = {
  run_id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type AgentRunPublicEvent = {
  sequence: number;
  type: string;
  stage?: string;
  label?: string;
  detail?: string;
  status?: AgentRunStatus;
  text?: string;
};

export type AgentRunCleanupReason = 'terminal' | 'interrupted' | 'replaced';

export type AgentRunEventHandlers = {
  onEvent: (event: AgentRunPublicEvent) => unknown;
  onCleanup?: (reason: AgentRunCleanupReason) => void;
};
