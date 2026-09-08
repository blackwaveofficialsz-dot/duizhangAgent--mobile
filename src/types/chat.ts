export type SessionListItem = {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type InterruptedRecoveryContext = {
  knownSessionIds: string[];
  requestSent: boolean;
  snapshotGeneration?: number;
  snapshotReady: boolean;
  startedAt: string;
  userText: string;
};

export type ToolCallStatus = 'running' | 'completed' | 'failed';

export type ToolCallData = {
  name: string;
  description: string;
  status: ToolCallStatus;
};

export type ApprovalRequest = {
  action: string;
  description: string;
  turnId: string;
  sourceSessionId: string;
};

export type QueryEvidence = {
  dataset_name: string;
  date_range: { from: string | null; to: string | null };
  scope: string;
  fields: string[];
  filters: Array<{ field: string; op: string; value: unknown }>;
  group_by: string[];
  metrics: string[];
  knowledge_entries: string[];
  row_counts: { returned: number; truncated: boolean };
  warnings: string[];
};

export type KnowledgeSuggestion = {
  title: string;
  content: string;
};

export type QueryExportInfo = {
  available: boolean;
  total: number;
  returned: number;
  truncated: boolean;
  dataset_name: string;
};

export type KnowledgeContext = {
  missing: string[];
  suggestions: string[];
  trace: string[];
};

export type ConnectorQueryMetadata = {
  evidence?: QueryEvidence | null;
  knowledge_suggestion?: KnowledgeSuggestion | null;
  export?: QueryExportInfo | null;
  knowledge_context?: KnowledgeContext | null;
};

export {
  agentResponseFromMetadata,
  normalizeMessageAgentResponse,
  parseAgentResponsePayload,
} from './agentResponse';
export type {
  AgentResponseAction,
  AgentResponseColumn,
  AgentResponseInsight,
  AgentResponseLimitation,
  AgentResponseMetric,
  AgentResponsePart,
  AgentResponsePayload,
} from './agentResponse';
import type { AgentResponsePayload } from './agentResponse';
import type { AgentActivity } from './agentActivity';
export type { AgentActivity, AgentActivityStatus, AgentActivityStep } from './agentActivity';

export type MessageItem = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  streaming?: boolean;
  interrupted?: boolean;
  recovery?: InterruptedRecoveryContext;
  toolCall?: ToolCallData;
  task_id?: string | null;
  metadata?: unknown | null;
  agentResponse?: AgentResponsePayload | null;
  activity?: AgentActivity | null;
};

export type SessionDetailResponse = {
  session_id: string;
  title: string;
  messages: MessageItem[];
};

export type ChatSession = SessionListItem & {
  pending?: boolean;
};
