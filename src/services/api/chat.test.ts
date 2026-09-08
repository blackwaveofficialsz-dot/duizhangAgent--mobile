import { apiRequest, apiStream } from './client';
import { getQueryEvidence, streamChat } from './chat';

jest.mock('./client', () => ({ apiRequest: jest.fn(), apiStream: jest.fn() }));

describe('chat API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests query evidence from the mobile contract endpoint', async () => {
    jest.mocked(apiRequest).mockResolvedValue({ evidence: null, export: null, knowledge_context: null, knowledge_suggestion: null });

    await getQueryEvidence('tenant-99:session 7');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/connectors/query-evidence?session_id=tenant-99%3Asession%207');
  });

  it('serializes the active session into the streaming HTTP request body', () => {
    const signal = new AbortController().signal;
    streamChat('继续对比上一周期', 'session-1', signal);

    expect(apiStream).toHaveBeenCalledWith('/api/v1/chat', expect.objectContaining({
      method: 'POST',
      signal,
    }));
    const request = jest.mocked(apiStream).mock.calls[0][1]!;
    expect(JSON.parse(request.body as string)).toEqual({
      message: '继续对比上一周期',
      session_id: 'session-1',
    });
  });

  it('includes a clarification interaction only when one is supplied', () => {
    const signal = new AbortController().signal;
    const interaction = {
      kind: 'clarification_choice' as const,
      source_turn_id: 'turn-1',
      candidate_id: 'analytics:sales_summary',
    };

    streamChat('查看经营销售数据', 'session-1', signal, interaction);

    const request = jest.mocked(apiStream).mock.calls[0][1]!;
    expect(JSON.parse(request.body as string)).toEqual({
      message: '查看经营销售数据',
      session_id: 'session-1',
      interaction,
    });
  });
});
