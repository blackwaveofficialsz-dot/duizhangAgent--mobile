import { parsePublicAgentActivityStep } from '@/types/agentActivity';

export type AgentStage = {
  code: string;
  label: string;
  detail: string;
  status: string;
  step_id?: string;
  elapsed_ms?: number;
  sequence?: number;
  visibility?: 'public';
};

export type ChatSseEvent =
  | { type: 'text'; content: string }
  | {
    type: 'meta';
    sessionId?: string;
    turnId?: string;
    category?: string;
    background?: true;
    runId?: string;
    agentResponse?: unknown;
    agentActivity?: unknown;
  }
  | ({ type: 'stage' } & AgentStage)
  | { type: 'error'; message: string; code: string; retryable: boolean }
  | { type: 'tool_call'; data: Record<string, unknown> }
  | { type: 'approval_request'; data: Record<string, unknown> }
  | { type: 'done' };

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatSseEvent, void, void> {
  for await (const data of readSseData(body)) {
    const event = parseData(data);
    if (event) {
      yield event;
      if (event.type === 'error' || event.type === 'done') return;
    }
  }
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sourceDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let boundary = findFrameBoundary(buffer);
      while (boundary) {
        const data = frameData(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);
        if (data) yield data;
        boundary = findFrameBoundary(buffer);
      }

      if (done) {
        sourceDone = true;
        const data = frameData(buffer);
        if (data) yield data;
        return;
      }
    }
  } finally {
    if (!sourceDone) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function findFrameBoundary(value: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function frameData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
}

function parseData(data: string): ChatSseEvent | null {
  if (data === '[DONE]') return { type: 'done' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { type: 'text', content: data };
  }

  if (typeof parsed === 'string') return { type: 'text', content: parsed };
  if (!parsed || typeof parsed !== 'object') return null;

  const payload = parsed as Record<string, unknown>;
  if (payload.type === 'text' && typeof payload.content === 'string') {
    return { type: 'text', content: payload.content };
  }
  if (payload.type === 'stage' && typeof payload.label === 'string') {
    const activityStep = parsePublicAgentActivityStep(payload);
    if (activityStep) {
      return {
        type: 'stage',
        code: typeof payload.code === 'string' ? payload.code : '',
        label: activityStep.label,
        detail: activityStep.detail ?? '',
        status: activityStep.status,
        step_id: activityStep.step_id,
        elapsed_ms: activityStep.elapsed_ms,
        sequence: activityStep.sequence,
        visibility: 'public',
      };
    }
    if ('visibility' in payload) return null;
    return {
      type: 'stage',
      code: typeof payload.code === 'string' ? payload.code : '',
      label: payload.label,
      detail: typeof payload.detail === 'string' ? payload.detail : '',
      status: typeof payload.status === 'string' ? payload.status : 'running',
    };
  }
  if (payload.type === 'error' && typeof payload.message === 'string') {
    return {
      type: 'error',
      message: payload.message,
      code: typeof payload.code === 'string' ? payload.code : 'agent_failed',
      retryable: payload.retryable === true,
    };
  }
  if (payload.type === 'meta') {
    const meta: ChatSseEvent = {
      type: 'meta',
      turnId: typeof payload.turn_id === 'string' ? payload.turn_id : '',
      category: typeof payload.category === 'string' ? payload.category : '',
    };
    if (typeof payload.session_id === 'string') meta.sessionId = payload.session_id;
    if (payload.background === true) meta.background = true;
    if (typeof payload.run_id === 'string') meta.runId = payload.run_id;
    if ('agent_response' in payload) meta.agentResponse = payload.agent_response;
    if ('agent_activity' in payload) meta.agentActivity = payload.agent_activity;
    return meta;
  }
  if (payload.type === 'tool_call' || payload.type === 'approval_request') {
    return { type: payload.type, data: payload };
  }
  return null;
}
