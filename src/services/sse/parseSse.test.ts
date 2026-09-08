import { parseSse } from './parseSse';
import { validAgentResponse } from '@/test/agentResponseFixture';

const encoder = new TextEncoder();

function streamChunks(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect(...chunks: string[]) {
  const events = [];
  for await (const event of parseSse(streamChunks(...chunks))) events.push(event);
  return events;
}

describe('parseSse', () => {
  it('cancels and completes after DONE even when the source stays open', async () => {
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const cancelSource = jest.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
      cancel: cancelSource,
    });
    const parsing = (async () => {
      const events = [];
      for await (const event of parseSse(source)) events.push(event);
      return events;
    })();

    const outcome = await Promise.race([
      parsing.then((events) => ({ status: 'completed', events })),
      new Promise<{ status: 'timeout'; events: never[] }>((resolve) => {
        setTimeout(() => resolve({ status: 'timeout', events: [] }), 100);
      }),
    ]);
    if (outcome.status === 'timeout') sourceController.close();
    await parsing;

    expect(outcome).toEqual({ status: 'completed', events: [{ type: 'done' }] });
    expect(cancelSource).toHaveBeenCalledTimes(1);
  });

  it('parses JSON string tokens and DONE from one chunk', async () => {
    await expect(collect('data: "\u4f60\u597d"\n\ndata: [DONE]\n\n')).resolves.toEqual([
      { type: 'text', content: '你好' },
      { type: 'done' },
    ]);
  });

  it('parses sticky frames split across arbitrary chunks', async () => {
    await expect(collect(
      'data: {"type":"meta","session_id":"server-1","turn_id":"turn-1"}\n\ndata: "第',
      '一段"\n\ndata: {"type":"text","content":"第二段"}\n',
      '\ndata: [DONE]\n\n',
    )).resolves.toEqual([
      { type: 'meta', sessionId: 'server-1', turnId: 'turn-1', category: '' },
      { type: 'text', content: '第一段' },
      { type: 'text', content: '第二段' },
      { type: 'done' },
    ]);
  });

  it('preserves agent response payloads in meta events for the chat stream', async () => {
    const agentResponse = { version: 1, domain: 'analytics', task: 'sales_summary', parts: [] };

    await expect(collect(`data: ${JSON.stringify({
      type: 'meta', session_id: 'server-1', agent_response: agentResponse,
    })}\n\n`)).resolves.toEqual([
      { type: 'meta', sessionId: 'server-1', turnId: '', category: '', agentResponse },
    ]);
  });

  it('exposes agent_response from a meta frame', async () => {
    const events = await collect(
      `data: ${JSON.stringify({ type: 'meta', session_id: 'session-1', turn_id: 'turn-1', agent_response: validAgentResponse })}\n\n`,
    );

    expect(events[0]).toMatchObject({
      type: 'meta',
      sessionId: 'session-1',
      agentResponse: validAgentResponse,
    });
  });

  it('exposes terminal agent_activity metadata without treating it as transport completion', async () => {
    const agentActivity = {
      version: 'v1', status: 'partial', label: '分析结果不完整', elapsed_ms: 50,
      total_duration_ms: 175,
      steps: [{ step_id: 'load', label: '读取业务数据', status: 'completed', elapsed_ms: 50 }],
      scope: ['凤八店'], sources: ['经营销售快照'],
    };

    await expect(collect(
      `data: ${JSON.stringify({ type: 'meta', agent_activity: agentActivity })}\n\n`,
      'data: [DONE]\n\n',
    )).resolves.toEqual([
      { type: 'meta', turnId: '', category: '', agentActivity },
      { type: 'done' },
    ]);
  });

  it('supports CRLF, multi-line data, and a final frame without a blank line', async () => {
    await expect(collect(
      'data: 旧格式\r\n\r\ndata: 第一行\r\ndata: 第二行\r\n\r\ndata: 收尾',
    )).resolves.toEqual([
      { type: 'text', content: '旧格式' },
      { type: 'text', content: '第一行\n第二行' },
      { type: 'text', content: '收尾' },
    ]);
  });

  it('preserves tool and approval events for later feature rendering', async () => {
    await expect(collect(
      'data: {"type":"tool_call","name":"query","description":"查询数据"}\n\n'
      + 'data: {"type":"approval_request","action":"export","turn_id":"turn-2"}\n\n',
    )).resolves.toEqual([
      { type: 'tool_call', data: { type: 'tool_call', name: 'query', description: '查询数据' } },
      { type: 'approval_request', data: { type: 'approval_request', action: 'export', turn_id: 'turn-2' } },
    ]);
  });

  it('preserves stages and keeps failures distinct from completed messages', async () => {
    await expect(collect(
      'data: {"type":"stage","code":"querying","label":"正在查询"}\n\n'
      + 'data: {"type":"error","message":"查询失败"}\n\n'
      + 'data: [DONE]\n\n',
    )).resolves.toEqual([
      { type: 'stage', code: 'querying', label: '正在查询', detail: '', status: 'running' },
      { type: 'error', message: '查询失败', code: 'agent_failed', retryable: false },
    ]);
  });

  it('ignores comments, unknown JSON objects, and empty data frames', async () => {
    await expect(collect(
      ': heartbeat\n\ndata:\n\ndata: {"type":"future_event","value":1}\n\n',
    )).resolves.toEqual([]);
  });
});
