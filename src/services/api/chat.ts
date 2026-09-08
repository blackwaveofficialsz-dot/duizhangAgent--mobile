import { apiRequest, apiStream, type ApiStreamResponse } from './client';
import type { ConnectorQueryMetadata } from '@/types/chat';
import type { ChatInteraction } from '@/types/agentResponse';

export function streamChat(
  message: string,
  sessionId: string,
  signal: AbortSignal,
  interaction?: ChatInteraction,
): Promise<ApiStreamResponse> {
  return apiStream('/api/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(interaction ? { message, session_id: sessionId, interaction } : { message, session_id: sessionId }),
    signal,
  });
}

export function getQueryEvidence(sessionId: string): Promise<ConnectorQueryMetadata> {
  return apiRequest(`/api/v1/connectors/query-evidence?session_id=${encodeURIComponent(sessionId)}`);
}
