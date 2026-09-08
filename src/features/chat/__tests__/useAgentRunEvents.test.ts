import { act, renderHook } from '@testing-library/react-native';
import { NETWORK_ERROR_MESSAGE, apiStream } from '@/services/api/client';
import type { AgentRunPublicEvent } from '@/types/agentRun';
import { useAgentRunEvents } from '../useAgentRunEvents';

jest.mock('@/services/api/client', () => ({
  NETWORK_ERROR_MESSAGE: '无法连接服务器，请检查网络或服务状态',
  apiStream: jest.fn(),
}));

const mockApiStream = apiStream as jest.MockedFunction<typeof apiStream>;
const encoder = new TextEncoder();

function event(sequence: number, type = 'progress', data: Record<string, unknown> = {}) {
  return {
    run_id: 'run-1',
    sequence,
    type,
    data,
    created_at: '2026-08-10T10:00:00+08:00',
  };
}

function stream(events: unknown[], cancel = jest.fn(async () => undefined)) {
  const payload = events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('');
  let sent = false;
  return {
    body: {
      getReader: () => ({
        read: jest.fn(async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: encoder.encode(payload) };
        }),
        cancel,
        releaseLock: jest.fn(),
      }),
    } as unknown as ReadableStream<Uint8Array>,
  };
}

function rawStream(raw: string) {
  let sent = false;
  return {
    body: {
      getReader: () => ({
        read: jest.fn(async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: encoder.encode(raw) };
        }),
        cancel: jest.fn(async () => undefined),
        releaseLock: jest.fn(),
      }),
    } as unknown as ReadableStream<Uint8Array>,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('useAgentRunEvents', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockApiStream.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reconnects from the last handled sequence and ignores replay duplicates', async () => {
    mockApiStream
      .mockResolvedValueOnce(stream([event(1), event(2)]))
      .mockResolvedValueOnce(stream([
        event(2),
        event(3, 'final', { status: 'completed', text: '研究结论' }),
      ]));
    const updates: AgentRunPublicEvent[] = [];
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: (item) => updates.push(item) }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));

    expect(updates.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(updates[2]?.text).toBe('研究结论');
    expect(mockApiStream).toHaveBeenNthCalledWith(2, '/api/v1/agent-runs/events', expect.objectContaining({
      body: JSON.stringify({ run_id: 'run-1', after_sequence: 2 }),
      method: 'POST',
    }));
  });

  it('reconnects from the last sequence after a mid-stream TypeError', async () => {
    let reads = 0;
    mockApiStream
      .mockResolvedValueOnce({
        body: {
          getReader: () => ({
            read: jest.fn(async () => {
              reads += 1;
              if (reads === 1) return { done: false, value: encoder.encode(`data: ${JSON.stringify(event(7))}\n\n`) };
              throw new TypeError('network connection lost');
            }),
            cancel: jest.fn(async () => undefined),
            releaseLock: jest.fn(),
          }),
        } as unknown as ReadableStream<Uint8Array>,
      })
      .mockResolvedValueOnce(stream([event(8, 'final', { status: 'completed' })]));
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn() }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));

    expect(mockApiStream).toHaveBeenNthCalledWith(2, '/api/v1/agent-runs/events', expect.objectContaining({
      body: JSON.stringify({ run_id: 'run-1', after_sequence: 7 }),
    }));
  });

  it.each([
    ['final', event(1, 'final', { status: 'completed' })],
    ['failed', event(1, 'failed', { status: 'failed' })],
  ])('waits for an async %s event handler before terminal cleanup', async (_name, terminalEvent) => {
    const refresh = deferred<void>();
    const onCleanup = jest.fn();
    mockApiStream.mockResolvedValue(stream([terminalEvent]));
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', {
      onEvent: async () => { await refresh.promise; },
      onCleanup,
    }));
    await act(async () => { await Promise.resolve(); });

    expect(onCleanup).not.toHaveBeenCalled();
    await act(async () => {
      refresh.resolve();
      await Promise.resolve();
    });
    expect(onCleanup).toHaveBeenCalledWith('terminal');
  });

  it.each([
    ['final', event(1, 'final', { status: 'completed' })],
    ['failed', event(1, 'failed', { status: 'failed' })],
    ['terminal stage', event(1, 'status', { stage: 'cancelled' })],
  ])('%s event aborts and cleans up once', async (_name, terminalEvent) => {
    mockApiStream.mockResolvedValue(stream([terminalEvent]));
    const onCleanup = jest.fn();
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup }));
    await act(async () => jest.runAllTimersAsync());

    const signal = mockApiStream.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(onCleanup).toHaveBeenCalledWith('terminal');
  });

  it.each(['cancel', 'unmount'])('%s aborts the request and clears state', async (action) => {
    mockApiStream.mockImplementation(() => new Promise(() => undefined));
    const onCleanup = jest.fn();
    const rendered = await renderHook(() => useAgentRunEvents());

    await act(() => rendered.result.current.start('run-1', { onEvent: jest.fn(), onCleanup }));
    if (action === 'cancel') await act(() => rendered.result.current.cancel());
    else await act(() => rendered.unmount());

    const signal = mockApiStream.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(onCleanup).toHaveBeenCalledWith('interrupted');
  });

  it('cancels only the requested run', async () => {
    mockApiStream.mockImplementation(() => new Promise(() => undefined));
    const firstCleanup = jest.fn();
    const secondCleanup = jest.fn();
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup: firstCleanup }));
    await act(() => result.current.start('run-2', { onEvent: jest.fn(), onCleanup: secondCleanup }));
    await act(() => result.current.cancel('run-1'));

    expect(firstCleanup).toHaveBeenCalledWith('interrupted');
    expect(secondCleanup).not.toHaveBeenCalled();
  });

  it('exposes only whitelisted public fields and keeps failed tools nonterminal', async () => {
    mockApiStream.mockResolvedValue(stream([
      event(1, 'tool', { status: 'failed', arguments: 'secret', label: '查询失败' }),
      event(2, 'final', {
        status: 'completed',
        text: '公开结论',
        observation: 'hidden',
        authorization_snapshot: { tenant_id: 'hidden' },
      }),
    ]));
    const updates: AgentRunPublicEvent[] = [];
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: (item) => updates.push(item) }));
    await act(async () => jest.runAllTimersAsync());

    expect(updates).toEqual([
      { sequence: 1, type: 'tool', label: '查询失败' },
      { sequence: 2, type: 'final', status: 'completed', text: '公开结论' },
    ]);
  });

  it.each([
    ['malformed JSON', rawStream('data: not-json\n\n')],
    ['nonpositive sequence', stream([event(0)])],
    ['missing created_at', stream([{ run_id: 'run-1', sequence: 1, type: 'progress', data: {} }])],
  ])('treats %s as fatal instead of reconnecting', async (_name, response) => {
    mockApiStream.mockResolvedValue(response);
    const onCleanup = jest.fn();
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));

    expect(mockApiStream).toHaveBeenCalledTimes(1);
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP 400', Object.assign(new Error('bad request'), { status: 400 }), false],
    ['network', new Error(NETWORK_ERROR_MESSAGE), true],
    ['HTTP 503', Object.assign(new Error('unavailable'), { status: 503 }), true],
  ])('classifies %s failures', async (_name, error, retryable) => {
    mockApiStream.mockRejectedValueOnce(error);
    if (retryable) {
      mockApiStream.mockResolvedValueOnce(stream([event(1, 'final', { status: 'completed' })]));
    }
    const onCleanup = jest.fn();
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));

    expect(mockApiStream).toHaveBeenCalledTimes(retryable ? 2 : 1);
    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(onCleanup).toHaveBeenCalledWith(retryable ? 'terminal' : 'interrupted');
  });

  it('keeps different run streams active until each finishes', async () => {
    const first = deferred<ReturnType<typeof stream>>();
    const second = deferred<ReturnType<typeof stream>>();
    mockApiStream
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const firstCleanup = jest.fn();
    const secondCleanup = jest.fn();
    const firstEvents: number[] = [];
    const secondEvents: number[] = [];
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', {
      onEvent: (item) => firstEvents.push(item.sequence),
      onCleanup: firstCleanup,
    }));
    await act(() => result.current.start('run-2', {
      onEvent: (item) => secondEvents.push(item.sequence),
      onCleanup: secondCleanup,
    }));

    const firstSignal = mockApiStream.mock.calls[0]?.[1]?.signal as AbortSignal;
    const secondSignal = mockApiStream.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);
    expect(secondSignal.aborted).toBe(false);
    expect(firstCleanup).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve(stream([event(1, 'final', { status: 'completed' })]));
      second.resolve(stream([{ ...event(1, 'final', { status: 'completed' }), run_id: 'run-2' }]));
      await jest.runAllTimersAsync();
    });

    expect(firstEvents).toEqual([1]);
    expect(secondEvents).toEqual([1]);
    expect(firstCleanup).toHaveBeenCalledWith('terminal');
    expect(secondCleanup).toHaveBeenCalledWith('terminal');
  });

  it('replaces only an existing stream for the same run id', async () => {
    mockApiStream.mockImplementation(() => new Promise(() => undefined));
    const firstCleanup = jest.fn();
    const secondCleanup = jest.fn();
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup: firstCleanup }));
    await act(() => result.current.start('run-1', { onEvent: jest.fn(), onCleanup: secondCleanup }));

    expect(firstCleanup).toHaveBeenCalledWith('replaced');
    expect(secondCleanup).not.toHaveBeenCalled();
  });

  it('replays the same sequence when the event handler throws', async () => {
    mockApiStream
      .mockResolvedValueOnce(stream([event(1)]))
      .mockResolvedValueOnce(stream([event(1), event(2, 'final', { status: 'completed' })]));
    let failOnce = true;
    const received: number[] = [];
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', {
      onEvent: (item) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('render failed');
        }
        received.push(item.sequence);
      },
    }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));

    expect(received).toEqual([1, 2]);
    expect(mockApiStream).toHaveBeenNthCalledWith(2, '/api/v1/agent-runs/events', expect.objectContaining({
      body: JSON.stringify({ run_id: 'run-1', after_sequence: 0 }),
    }));
  });

  it('cancels the retained reader after terminal delivery', async () => {
    const cancel = jest.fn(async () => undefined);
    mockApiStream.mockResolvedValue(stream([event(1, 'final', { status: 'completed' })], cancel));
    const { result } = await renderHook(() => useAgentRunEvents());

    await act(() => result.current.start('run-1', { onEvent: jest.fn() }));
    await act(async () => jest.runAllTimersAsync());

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
