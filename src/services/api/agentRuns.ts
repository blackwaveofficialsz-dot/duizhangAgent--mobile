import { apiStream } from './client';
import { readSseData } from '@/services/sse/parseSse';
import type { AgentRunEventEnvelope } from '@/types/agentRun';

export class AgentRunStreamError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'AgentRunStreamError';
  }
}

export async function* streamAgentRunEvents(
  runId: string,
  afterSequence: number,
  signal: AbortSignal,
): AsyncGenerator<AgentRunEventEnvelope> {
  const response = await apiStream('/api/v1/agent-runs/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id: runId, after_sequence: afterSequence }),
    signal,
  });
  if (!response.body) throw new AgentRunStreamError('研究任务事件流缺少响应内容', false);

  for await (const raw of readSseData(response.body)) {
    let parsed: AgentRunEventEnvelope;
    try {
      parsed = JSON.parse(raw) as AgentRunEventEnvelope;
    } catch {
      throw new AgentRunStreamError('研究任务事件格式错误', false);
    }
    if (
      !parsed
      || parsed.run_id !== runId
      || !Number.isInteger(parsed.sequence)
      || parsed.sequence <= 0
      || typeof parsed.type !== 'string'
      || typeof parsed.created_at !== 'string'
      || parsed.created_at.length === 0
      || parsed.data === null
      || typeof parsed.data !== 'object'
      || Array.isArray(parsed.data)
    ) throw new AgentRunStreamError('研究任务事件格式错误', false);
    yield parsed;
  }
}
