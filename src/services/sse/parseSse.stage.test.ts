import { parseSse } from './parseSse';


function streamFrame(payload: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}


describe('parseSse stage events', () => {
  it('preserves stable stage fields', async () => {
    const events = [];
    for await (const event of parseSse(streamFrame({
      type: 'stage',
      code: 'querying',
      label: '正在查询',
      detail: '门店经营数据',
      status: 'running',
    }))) events.push(event);

    expect(events[0]).toEqual({
      type: 'stage',
      code: 'querying',
      label: '正在查询',
      detail: '门店经营数据',
      status: 'running',
    });
  });

  it('retains validated public activity metadata on stage events', async () => {
    const events = [];
    for await (const event of parseSse(streamFrame({
      type: 'stage',
      code: 'querying',
      label: '正在查询',
      detail: '门店经营数据',
      status: 'running',
      visibility: 'public',
      step_id: 'query-sales',
      elapsed_ms: 120,
      sequence: 2,
      internal_reasoning: 'must not leak',
    }))) events.push(event);

    expect(events[0]).toEqual({
      type: 'stage',
      code: 'querying',
      label: '正在查询',
      detail: '门店经营数据',
      status: 'running',
      visibility: 'public',
      step_id: 'query-sales',
      elapsed_ms: 120,
      sequence: 2,
    });
  });

  it('discards private stages instead of treating them as legacy stages', async () => {
    const events = [];
    for await (const event of parseSse(streamFrame({
      type: 'stage',
      code: 'querying',
      label: '正在查询',
      detail: '门店经营数据',
      status: 'running',
      visibility: 'private',
      step_id: 'query-sales',
      elapsed_ms: 120,
      sequence: 2,
    }))) events.push(event);

    expect(events).toEqual([{ type: 'done' }]);
  });

  it('uses normalized public activity fields at their accepted boundaries', async () => {
    const events = [];
    for await (const event of parseSse(streamFrame({
      type: 'stage',
      code: 'querying',
      label: ` ${'查'.repeat(24)} `,
      detail: ` ${'数'.repeat(60)} `,
      status: 'completed',
      visibility: 'public',
      step_id: ' query-sales ',
      elapsed_ms: 120,
      sequence: 2,
    }))) events.push(event);

    expect(events[0]).toEqual({
      type: 'stage',
      code: 'querying',
      label: '查'.repeat(24),
      detail: '数'.repeat(60),
      status: 'completed',
      visibility: 'public',
      step_id: 'query-sales',
      elapsed_ms: 120,
      sequence: 2,
    });
  });

  it('keeps structured failures distinct from assistant text', async () => {
    const events = [];
    for await (const event of parseSse(streamFrame({
      type: 'error',
      message: '模型暂时不可用',
      code: 'model_unavailable',
      retryable: true,
    }))) events.push(event);

    expect(events[0]).toEqual({
      type: 'error',
      message: '模型暂时不可用',
      code: 'model_unavailable',
      retryable: true,
    });
  });
});
