import { apiRequest } from './client';
import type { SessionDetailResponse, SessionListItem } from '@/types/chat';

export function listSessions(signal?: AbortSignal): Promise<SessionListItem[]> {
  return apiRequest('/api/v1/sessions', { signal });
}

export function getSessionDetail(sessionId: string, signal?: AbortSignal): Promise<SessionDetailResponse> {
  return apiRequest(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export function deleteSession(sessionId: string): Promise<void> {
  return apiRequest(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}
