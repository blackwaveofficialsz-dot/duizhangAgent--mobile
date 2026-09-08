import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as sessionsApi from '@/services/api/sessions';
import * as chatApi from '@/services/api/chat';
import { showToast } from '@/components/feedback/AppToast';
import { useNetworkStore } from '@/services/network/networkStore';
import type { AgentRunEventHandlers } from '@/types/agentRun';
import { validAgentResponse } from '@/test/agentResponseFixture';
import { useChatStore } from './chatStore';
import { useAgentRunEvents } from './useAgentRunEvents';
import { useChatStream } from './useChatStream';

jest.mock('@/services/api/chat', () => ({ getQueryEvidence: jest.fn(), streamChat: jest.fn() }));
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('./useAgentRunEvents', () => ({ useAgentRunEvents: jest.fn() }));
jest.mock('@/features/tasks/taskStore', () => ({
  useTaskStore: {
    getState: () => ({ refresh: mockTaskRefresh, startPolling: mockTaskStartPolling, stopPolling: mockTaskStopPolling }),
  },
}));
jest.mock('@/services/api/sessions', () => ({
  deleteSession: jest.fn(),
  getSessionDetail: jest.fn(),
  listSessions: jest.fn(),
}));

const durableStart = jest.fn();
const durableCancel = jest.fn();
const mockTaskRefresh = jest.fn(async () => undefined);
const mockTaskStartPolling = jest.fn();
const mockTaskStopPolling = jest.fn();

const encoder = new TextEncoder();

function responseFrom(...chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('useChatStream', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(useAgentRunEvents).mockReturnValue({ start: durableStart, cancel: durableCancel });
    jest.mocked(sessionsApi.listSessions).mockResolvedValue([]);
    useChatStore.getState().reset();
    useNetworkStore.setState({ status: 'online' });
  });

  it('does not create or send a message when the device is offline', async () => {
    useNetworkStore.setState({ status: 'offline' });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('离线消息'));

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().sessions).toEqual([]);
  });

  it('writes adjacent tokens in bounded batches', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    jest.mocked(chatApi.streamChat).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    }), { status: 200 }));
    const sessionId = useChatStore.getState().newSession();
    const originalAppend = useChatStore.getState().appendMessageContent;
    const append = jest.fn(originalAppend);
    useChatStore.setState({ appendMessageContent: append });
    const { result } = await renderHook(() => useChatStream());
    const largeToken = '长'.repeat(5000);
    const expected = `甲乙${largeToken}`;
    let sending!: Promise<void>;

    try {
      await act(async () => {
        sending = result.current.sendMessage('批量写入');
        await Promise.resolve();
      });
      await act(async () => {
        streamController.enqueue(encoder.encode(
          `data: "甲"\n\ndata: "乙"\n\ndata: ${JSON.stringify(largeToken)}\n\n`,
        ));
        await Promise.resolve();
      });

      await waitFor(() => expect(append.mock.calls.map((call) => call[2]).join('')).toBe(expected));
      expect(append).toHaveBeenCalledTimes(2);
      expect(append.mock.calls.every((call) => call[2].length <= 4096)).toBe(true);
      expect(append.mock.calls.every((call) => call[0] === sessionId)).toBe(true);
    } finally {
      streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
      streamController.close();
      await act(async () => sending);
      useChatStore.setState({ appendMessageContent: originalAppend });
    }
  });

  it('aborts the old session stream and drops its late events after switching sessions', async () => {
    let firstController!: ReadableStreamDefaultController<Uint8Array>;
    let firstSignal: AbortSignal | undefined;
    jest.mocked(chatApi.streamChat)
      .mockImplementationOnce(async (_message, _sessionId, signal) => {
        firstSignal = signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { firstController = controller; },
        }), { status: 200 });
      })
      .mockResolvedValueOnce(responseFrom('data: "B 回复"\n\ndata: [DONE]\n\n'));
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [], 'session-b': [] },
      sessions: [
        { session_id: 'session-a', title: 'A', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'session-b', title: 'B', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });
    const { result } = await renderHook(() => useChatStream());
    let firstSending!: Promise<void>;

    try {
      await act(async () => {
        firstSending = result.current.sendMessage('A 问题');
        await Promise.resolve();
      });
      await act(async () => {
        useChatStore.setState({ activeSessionId: 'session-b' });
        await Promise.resolve();
      });

      expect(firstSignal?.aborted).toBe(true);
      expect(result.current.isStreaming).toBe(false);
      await act(async () => {
        firstController.enqueue(encoder.encode('data: "A 晚到内容"\n\n'));
        await Promise.resolve();
      });
      await act(async () => result.current.sendMessage('B 问题'));

      expect(chatApi.streamChat).toHaveBeenCalledTimes(2);
      expect(useChatStore.getState().messagesBySessionId['session-b'].at(-1)?.content).toBe('B 回复');
      expect(useChatStore.getState().messagesBySessionId['session-b'].some((message) => message.content.includes('A 晚到内容'))).toBe(false);
    } finally {
      result.current.stopGeneration();
      try { firstController.close(); } catch {}
      await act(async () => firstSending);
    }
  });


  it('does not create or send a message before connectivity is confirmed', async () => {
    useNetworkStore.setState({ status: 'unknown' });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('网络状态待确认'));

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().sessions).toEqual([]);
  });

  it('replaces a pending session from meta and keeps updating the same assistant message', async () => {
    const serverSessionId = 'tenant-99:session-4b2f';
    jest.spyOn(chatApi, 'streamChat').mockResolvedValue(responseFrom(
      `data: {"type":"meta","session_id":"${serverSessionId}","turn_id":"turn-1"}\n\n`,
      'data: "第一段"\n\ndata: {"type":"text","content":"第二段"}\n\ndata: [DONE]\n\n',
    ));
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('  你好  '));

    expect(chatApi.streamChat).toHaveBeenCalledWith('你好', '', expect.any(AbortSignal));
    expect(useChatStore.getState().activeSessionId).toBe(serverSessionId);
    expect(useChatStore.getState().messagesBySessionId[pendingId]).toBeUndefined();
    expect(useChatStore.getState().messagesBySessionId[serverSessionId]).toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
      expect.objectContaining({ role: 'assistant', content: '第一段第二段', interrupted: false, streaming: false }),
    ]);
    expect(useChatStore.getState().messagesBySessionId[serverSessionId].filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('hands a background kickoff to the durable run and keeps its assistant pending until terminal cleanup', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('研究利润变化'));

    const pending = useChatStore.getState().messagesBySessionId['server-research'][1];
    expect(durableStart).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(mockTaskStartPolling).toHaveBeenCalledTimes(1);
    expect(mockTaskRefresh).toHaveBeenCalledTimes(1);
    expect(pending).toEqual(expect.objectContaining({ task_id: 'run-1', streaming: true, interrupted: false }));
    expect(result.current.isStreaming).toBe(false);
    expect(chatApi.getQueryEvidence).not.toHaveBeenCalled();

    await act(() => durableHandlers?.onEvent({
      sequence: 1,
      type: 'final',
      status: 'completed',
      text: '公开研究结论',
    }));
    await act(() => durableHandlers?.onCleanup?.('terminal'));

    expect(useChatStore.getState().messagesBySessionId['server-research'][1]).toEqual(expect.objectContaining({
      content: '公开研究结论',
      interrupted: false,
      streaming: false,
    }));
    expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-1');
  });

  it('keeps an active background run attached during a normal follow-up', async () => {
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"chat"}\n\n',
        'data: "补充问题回复"\n\ndata: [DONE]\n\n',
      ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('开始研究'));
    await act(async () => result.current.sendMessage('补充问题'));

    expect(durableStart).toHaveBeenCalledTimes(1);
    expect(durableCancel).not.toHaveBeenCalled();
    expect(useChatStore.getState().messagesBySessionId['server-research'][1]).toEqual(expect.objectContaining({
      task_id: 'run-1',
      streaming: true,
    }));
  });

  it('retains ownership when the same background run is attached again', async () => {
    let activeHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      activeHandlers?.onCleanup?.('replaced');
      activeHandlers = handlers;
    });
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
        'data: [DONE]\n\n',
      ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('第一次研究'));
    await act(async () => result.current.sendMessage('第二次研究'));
    await act(() => useChatStore.setState({ activeSessionId: 'other-session' }));

    expect(durableStart).toHaveBeenNthCalledWith(2, 'run-1', expect.any(Object));
    expect(durableCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent background runs attached to their own messages and polling owners', async () => {
    const handlers = new Map<string, AgentRunEventHandlers>();
    durableStart.mockImplementation((runId: string, next: AgentRunEventHandlers) => {
      handlers.set(runId, next);
    });
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-2"}\n\n',
        'data: [DONE]\n\n',
      ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('第一次研究'));
    await act(async () => result.current.sendMessage('第二次研究'));
    await act(() => handlers.get('run-1')?.onEvent({
      sequence: 1, type: 'final', status: 'completed', text: '第一份结论',
    }));
    await act(() => handlers.get('run-1')?.onCleanup?.('terminal'));

    expect(useChatStore.getState().messagesBySessionId['server-research'][1]).toEqual(expect.objectContaining({
      task_id: 'run-1', content: '第一份结论', interrupted: false, streaming: false,
    }));
    expect(useChatStore.getState().messagesBySessionId['server-research'][3]).toEqual(expect.objectContaining({
      task_id: 'run-2', content: '', interrupted: false, streaming: true,
    }));

    await act(() => handlers.get('run-2')?.onEvent({
      sequence: 1, type: 'final', status: 'completed', text: '第二份结论',
    }));
    await act(() => handlers.get('run-2')?.onCleanup?.('terminal'));

    expect(useChatStore.getState().messagesBySessionId['server-research'][3]).toEqual(expect.objectContaining({
      task_id: 'run-2', content: '第二份结论', interrupted: false, streaming: false,
    }));
    expect(durableCancel).not.toHaveBeenCalled();
    expect(mockTaskStartPolling).toHaveBeenCalledWith('research:run-1');
    expect(mockTaskStartPolling).toHaveBeenCalledWith('research:run-2');
    expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-1');
    expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-2');
  });

  it('refreshes stale waiting task state before active status rearms polling', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    await act(async () => result.current.sendMessage('开始研究'));
    mockTaskRefresh.mockClear();
    mockTaskStartPolling.mockClear();

    await act(async () => {
      durableHandlers?.onEvent({ sequence: 1, type: 'status', status: 'running' });
      await Promise.resolve();
    });

    expect(mockTaskRefresh).toHaveBeenCalledTimes(1);
    expect(mockTaskStartPolling).toHaveBeenCalledTimes(1);
  });

  it.each(['waiting_for_data', 'waiting_for_approval', 'needs_review'])('%s refreshes tasks before stopping polling', async (status) => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    const refresh = deferred<void>();
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    mockTaskRefresh.mockImplementation(async () => { await refresh.promise; });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('开始研究'));
    mockTaskRefresh.mockClear();
    mockTaskStopPolling.mockClear();

    await act(async () => {
      void durableHandlers?.onEvent({ sequence: 1, type: 'status', status: status as never });
      await Promise.resolve();
    });
    expect(mockTaskRefresh).toHaveBeenCalledTimes(1);
    expect(mockTaskStopPolling).not.toHaveBeenCalled();

    await act(async () => refresh.resolve());
    await waitFor(() => expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-1'));
  });

  it.each([
    ['final', { sequence: 1, type: 'final' as const, status: 'completed' as const }],
    ['failed', { sequence: 1, type: 'failed' as const, status: 'failed' as const }],
  ])('%s refreshes tasks before terminal polling cleanup', async (_name, terminalEvent) => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    const refresh = deferred<void>();
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    mockTaskRefresh.mockImplementation(async () => { await refresh.promise; });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('开始研究'));
    mockTaskRefresh.mockClear();
    mockTaskStopPolling.mockClear();

    const terminal = durableHandlers?.onEvent(terminalEvent);
    await act(async () => { await Promise.resolve(); });
    expect(mockTaskRefresh).toHaveBeenCalledTimes(1);
    expect(mockTaskStopPolling).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve();
      await terminal;
    });
    expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-1');
  });

  it('keeps a normal follow-up stream active when the background run finishes', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    let followupController!: ReadableStreamDefaultController<Uint8Array>;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) { followupController = controller; },
      }), { status: 200 }));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('开始研究'));
    let followup!: Promise<void>;
    await act(() => { followup = result.current.sendMessage('补充问题'); });
    await act(() => durableHandlers?.onCleanup?.('terminal'));

    expect(result.current.isStreaming).toBe(true);
    followupController.enqueue(encoder.encode('data: [DONE]\n\n'));
    followupController.close();
    await act(async () => followup);
  });

  it.each(['stop', 'session change', 'unmount'])('cancels the durable run view on %s', async (action) => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => {
      durableHandlers = handlers;
    });
    durableCancel.mockImplementation(() => durableHandlers?.onCleanup?.('interrupted'));
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research","category":"research","background":true,"run_id":"run-1"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const rendered = await renderHook(() => useChatStream());

    await act(async () => rendered.result.current.sendMessage('开始研究'));
    if (action === 'stop') await act(() => rendered.result.current.stopGeneration());
    else if (action === 'session change') {
      await act(() => useChatStore.setState({ activeSessionId: 'other-session' }));
    } else await act(() => rendered.unmount());

    expect(durableCancel).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messagesBySessionId['server-research'][1]).toEqual(expect.objectContaining({
      interrupted: true,
      streaming: false,
    }));
  });

  it('keeps tool events allowlisted, completes them, and holds approval locally', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-tool","category":"report"}\n\n',
      'data: {"type":"tool_call","name":"查询订单","description":"按日期汇总","arguments":"SELECT token","headers":{"Authorization":"secret"}}\n\n',
      'data: {"type":"approval_request","action":"导出报表","description":"导出本月结果","turn_id":"turn-7","ignored":"secret"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('生成报表'));

    const messages = useChatStore.getState().messagesBySessionId['server-tool'];
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool_call',
        toolCall: { name: '查询订单', description: '按日期汇总', status: 'completed' },
      }),
    ]));
    expect(JSON.stringify(messages)).not.toContain('SELECT token');
    expect(JSON.stringify(messages)).not.toContain('Authorization');
    expect((result.current as unknown as { pendingApproval: unknown }).pendingApproval).toEqual({
      action: '导出报表', description: '导出本月结果', turnId: 'turn-7', sourceSessionId: 'server-tool',
    });
  });

  it('keeps public activity on the current assistant through tokens and completes it only at DONE', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-activity","category":"report"}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"completed","elapsed_ms":20,"sequence":1}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"summarize","label":"汇总结果","status":"running","elapsed_ms":5,"sequence":2}\n\n',
      'data: "销售结论"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('销售分析'));

    const assistant = useChatStore.getState().messagesBySessionId['server-activity'][1];
    expect(assistant.content).toBe('销售结论');
    expect(assistant.activity).toEqual(expect.objectContaining({
      status: 'completed',
      steps: [
        expect.objectContaining({ step_id: 'query-sales', status: 'completed' }),
        expect.objectContaining({ step_id: 'summarize', status: 'completed' }),
      ],
    }));
  });

  it.each([
    ['ok', 'completed'],
    ['partial', 'partial'],
    ['empty', 'empty'],
    ['unavailable', 'unavailable'],
    ['failed', 'failed'],
  ] as const)('keeps the %s business terminal after terminal activity meta and done', async (resultStatus, activityStatus) => {
    const agentResponse = {
      ...validAgentResponse,
      result_status: resultStatus,
      result_id: `result-${resultStatus}`,
    };
    const terminalActivity = {
      version: 'v1', status: activityStatus, label: `terminal-${activityStatus}`, elapsed_ms: 50,
      total_duration_ms: 175,
      steps: [{ step_id: 'load', label: '读取业务数据', status: 'completed', elapsed_ms: 50 }],
      scope: ['凤八店'], sources: ['经营销售快照'],
    };
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      `data: ${JSON.stringify({ type: 'meta', session_id: `server-${resultStatus}`, agent_response: agentResponse })}\n\n`,
      'data: {"type":"stage","visibility":"public","step_id":"load","label":"读取业务数据","status":"completed","elapsed_ms":50,"sequence":1}\n\n',
      `data: ${JSON.stringify({ type: 'meta', agent_activity: terminalActivity })}\n\n`,
      'data: "结果"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('查询经营数据'));

    expect(useChatStore.getState().messagesBySessionId[`server-${resultStatus}`][1].activity).toMatchObject({
      status: activityStatus,
      elapsed_ms: 50,
      total_duration_ms: 175,
      scope: ['凤八店'],
      sources: ['经营销售快照'],
    });
  });

  it.each([
    ['explicit null', null],
    ['valid status with missing contract fields', { result_status: 'ok' }],
    ['unsupported version with a valid status', { version: 2, result_status: 'ok' }],
  ])('fails closed for %s agent_response metadata', async (_case, agentResponse) => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-invalid"}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"load","label":"读取业务数据","status":"completed","elapsed_ms":10,"sequence":1}\n\n',
      `data: ${JSON.stringify({ type: 'meta', agent_response: agentResponse })}\n\n`,
      'data: "兼容正文"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('查询经营数据'));

    const assistant = useChatStore.getState().messagesBySessionId['server-invalid'][1];
    expect(assistant.agentResponse).toBeUndefined();
    expect(assistant.activity?.status).toBe('failed');
  });

  it('fails public activity and ignores later frames after a backend error', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-failed","category":"report"}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
      'data: {"type":"error","message":"处理失败","code":"agent_failed"}\n\n',
      'data: "不得追加"\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('销售分析'));

    const assistant = useChatStore.getState().messagesBySessionId['server-failed'][1];
    expect(assistant).toEqual(expect.objectContaining({ content: '', streaming: false }));
    expect(assistant.activity).toEqual(expect.objectContaining({
      status: 'failed',
      steps: [expect.objectContaining({ status: 'failed' })],
    }));
    expect(result.current.isStreaming).toBe(false);
  });

  it('fails and cancels the owning background Research run before late durable events can mutate it', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => { durableHandlers = handlers; });
    durableCancel.mockImplementation((runId?: string) => {
      if (runId === 'run-failed') durableHandlers?.onCleanup?.('interrupted');
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-research-failed","category":"research","background":true,"run_id":"run-failed"}\n\n',
      'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
      'data: {"type":"error","message":"研究失败","code":"agent_failed"}\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('研究利润变化'));
    await act(() => durableHandlers?.onEvent({
      sequence: 1, type: 'final', status: 'completed', text: '不得追加',
    }));

    const assistant = useChatStore.getState().messagesBySessionId['server-research-failed'][1];
    expect(durableCancel).toHaveBeenCalledWith('run-failed');
    expect(mockTaskStopPolling).toHaveBeenCalledWith('research:run-failed');
    expect(mockTaskStartPolling).toHaveBeenCalledTimes(1);
    expect(assistant).toEqual(expect.objectContaining({ content: '', streaming: false }));
    expect(assistant.activity?.status).toBe('failed');
    expect(result.current.isStreaming).toBe(false);
  });

  it('fails the parent activity when Research terminal cleanup precedes its SSE error', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => { durableHandlers = handlers; });
    jest.mocked(chatApi.streamChat).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    }), { status: 200 }));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    let sending!: Promise<void>;

    await act(() => { sending = result.current.sendMessage('研究利润变化'); });
    await act(() => streamController.enqueue(encoder.encode(
      'data: {"type":"meta","session_id":"server-research-race","category":"research","background":true,"run_id":"run-race"}\n\n'
      + 'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
    )));
    await waitFor(() => expect(durableStart).toHaveBeenCalledWith('run-race', expect.any(Object)));
    await act(() => durableHandlers?.onCleanup?.('terminal'));
    await act(() => streamController.enqueue(encoder.encode('data: {"type":"error","message":"研究失败","code":"agent_failed"}\n\n')));
    await act(async () => sending);

    const assistant = useChatStore.getState().messagesBySessionId['server-research-race'][1];
    expect(assistant).toEqual(expect.objectContaining({ streaming: false }));
    expect(assistant.activity?.status).toBe('failed');
    expect(result.current.isStreaming).toBe(false);
  });

  it('marks a user stop as cancelled and an unexpected stream end as interrupted', async () => {
    let stopController!: ReadableStreamDefaultController<Uint8Array>;
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) { stopController = controller; },
      }), { status: 200 }))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-cancelled","category":"report"}\n\n',
        'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
      ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    let stopped!: Promise<void>;

    await act(() => { stopped = result.current.sendMessage('停止分析'); });
    await act(() => stopController.enqueue(encoder.encode(
      'data: {"type":"meta","session_id":"server-cancelled","category":"report"}\n\n'
      + 'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
    )));
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe('server-cancelled'));
    await act(() => result.current.stopGeneration());
    try { stopController.close(); } catch {}
    await act(async () => stopped);
    await act(async () => result.current.sendMessage('网络中断'));

    expect(chatApi.streamChat).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messagesBySessionId['server-cancelled'][1].activity?.status).toBe('cancelled');
    expect(useChatStore.getState().messagesBySessionId['server-cancelled'][3].activity?.status).toBe('interrupted');
  });

  it('projects Research events to their owning assistant instead of a later reply', async () => {
    let durableHandlers: AgentRunEventHandlers | undefined;
    durableStart.mockImplementation((_runId, handlers: AgentRunEventHandlers) => { durableHandlers = handlers; });
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-research-activity","category":"research","background":true,"run_id":"run-activity"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom('data: [DONE]\n\n'));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('开始研究'));
    await act(async () => result.current.sendMessage('后续问题'));
    await act(() => durableHandlers?.onEvent({
      sequence: 1, type: 'status', stage: 'researching', label: '正在研究', detail: '分析趋势', status: 'running',
    }));

    const messages = useChatStore.getState().messagesBySessionId['server-research-activity'];
    expect(messages[1].activity).toEqual(expect.objectContaining({
      status: 'running', steps: [expect.objectContaining({ step_id: 'researching', label: '正在研究' })],
    }));
    expect(messages[3].activity).toBeUndefined();
  });

  it('suppresses tool messages after public activity but keeps the legacy tool path', async () => {
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-public-tool","category":"report"}\n\n',
        'data: {"type":"stage","visibility":"public","step_id":"query-sales","label":"查询销售数据","status":"running","elapsed_ms":10,"sequence":1}\n\n',
        'data: {"type":"tool_call","name":"查询订单","description":"按日期汇总"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-legacy-tool","category":"report"}\n\n',
        'data: {"type":"tool_call","name":"查询订单","description":"按日期汇总"}\n\n',
        'data: [DONE]\n\n',
      ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('公开活动'));
    await act(async () => result.current.sendMessage('旧工具'));

    expect(useChatStore.getState().messagesBySessionId['server-public-tool'].filter((message) => message.role === 'tool_call')).toHaveLength(0);
    expect(useChatStore.getState().messagesBySessionId['server-legacy-tool']).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool_call', toolCall: expect.objectContaining({ status: 'completed' }) }),
    ]));
  });

  it('preserves explicit terminal tool statuses and defaults unknown statuses to running', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-tools","category":"report"}\n\n',
      'data: {"type":"tool_call","name":"失败工具","description":"","status":"failed","arguments":"secret"}\n\n',
      'data: {"type":"tool_call","name":"完成工具","description":"","status":"completed"}\n\n',
      'data: {"type":"tool_call","name":"未知工具","description":"","status":"finished"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('运行工具'));

    expect(useChatStore.getState().messagesBySessionId['server-tools']).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolCall: expect.objectContaining({ name: '失败工具', status: 'failed' }) }),
      expect.objectContaining({ toolCall: expect.objectContaining({ name: '完成工具', status: 'completed' }) }),
      expect.objectContaining({ toolCall: expect.objectContaining({ name: '未知工具', status: 'completed' }) }),
    ]));
    expect(JSON.stringify(useChatStore.getState().messagesBySessionId['server-tools'])).not.toContain('secret');
  });

  it('sends an approved action only once and never auto-approves after an interrupted stream', async () => {
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-approval","category":"report"}\n\n',
        'data: {"type":"approval_request","action":"导出报表","description":"导出结果","turn_id":"turn-8"}\n\n',
        'data: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom('data: [DONE]\n\n'));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('导出数据'));
    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    await act(async () => (result.current as unknown as { approvePending: () => Promise<void> }).approvePending());
    await act(async () => (result.current as unknown as { approvePending: () => Promise<void> }).approvePending());

    expect(chatApi.streamChat).toHaveBeenCalledTimes(2);
    expect(chatApi.streamChat).toHaveBeenLastCalledWith('同意执行: 导出报表', 'server-approval', expect.any(AbortSignal));
  });

  it('invalidates approval when the active session changes from its source session', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    jest.mocked(chatApi.streamChat).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    }), { status: 200 }));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('导出数据'); });
    await act(() => streamController.enqueue(encoder.encode(
      'data: {"type":"meta","session_id":"server-a","category":"report"}\n\n'
      + 'data: {"type":"approval_request","action":"导出报表","description":"导出结果","turn_id":"turn-a"}\n\n',
    )));
    await waitFor(() => expect((result.current as unknown as { pendingApproval: unknown }).pendingApproval).toEqual(expect.objectContaining({
      sourceSessionId: 'server-a',
    })));
    await act(() => useChatStore.setState((state) => ({
      activeSessionId: 'server-b',
      messagesBySessionId: { ...state.messagesBySessionId, 'server-b': [] },
      sessions: [...state.sessions, { session_id: 'server-b', title: 'B', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    })));

    await waitFor(() => expect((result.current as unknown as { pendingApproval: unknown }).pendingApproval).toBeNull());
    await act(async () => (result.current as unknown as { approvePending: () => Promise<void> }).approvePending());
    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
    await act(async () => sending);
  });

  it('drops a late approval event after the source session is no longer active', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    jest.mocked(chatApi.streamChat).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    }), { status: 200 }));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('导出数据'); });
    await act(() => streamController.enqueue(encoder.encode('data: {"type":"meta","session_id":"server-a","category":"report"}\n\n')));
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe('server-a'));
    await act(() => useChatStore.setState((state) => ({
      activeSessionId: 'server-b',
      messagesBySessionId: { ...state.messagesBySessionId, 'server-b': [] },
      sessions: [...state.sessions, { session_id: 'server-b', title: 'B', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    })));
    await act(() => streamController.enqueue(encoder.encode(
      'data: {"type":"approval_request","action":"导出报表","description":"导出结果","turn_id":"turn-late"}\n\n'
      + 'data: [DONE]\n\n',
    )));
    await act(async () => sending);

    expect((result.current as unknown as { pendingApproval: unknown }).pendingApproval).toBeNull();
  });

  it('does not surface approval until its source session has resolved', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"approval_request","action":"导出报表","description":"导出结果","turn_id":"turn-pending"}\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('导出数据'));

    expect((result.current as unknown as { pendingApproval: unknown }).pendingApproval).toBeNull();
  });

  it('loads query evidence only after a completed business query', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-query","category":"connector_query"}\n\n',
      'data: "查询完成"\n\ndata: [DONE]\n\n',
    ));
    jest.mocked(chatApi.getQueryEvidence).mockResolvedValue({
      evidence: null,
      export: { available: true, total: 5, returned: 5, truncated: false, dataset_name: '订单' },
      knowledge_context: null,
      knowledge_suggestion: null,
    });
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('查询订单'));

    expect(chatApi.getQueryEvidence).toHaveBeenCalledWith('server-query');
    expect(useChatStore.getState().messagesBySessionId['server-query'][1].metadata).toEqual({
      connector_query: expect.objectContaining({ export: expect.objectContaining({ total: 5 }) }),
    });
  });

  it('keeps a v1 agent response from a meta frame through normal completion', async () => {
    const agentResponse = validAgentResponse;
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      `data: ${JSON.stringify({ type: 'meta', session_id: 'server-sales', agent_response: agentResponse })}\n\n`,
      'data: "销售汇总已生成"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('给我过去三十天凤八店的销售数据'));

    expect(useChatStore.getState().messagesBySessionId['server-sales'][1]).toEqual(expect.objectContaining({
      agentResponse: expect.objectContaining({ result_id: agentResponse.result_id }),
      content: '销售汇总已生成',
      streaming: false,
    }));
    expect(useChatStore.getState().messagesBySessionId['server-sales'][1].metadata).toBeUndefined();
  });

  it('treats Failed as terminal and ignores a later structured payload', async () => {
    const cancel = jest.fn();
    jest.mocked(chatApi.streamChat).mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"stage","code":"querying","label":"正在查询"}\n\n'
          + 'data: {"type":"error","message":"处理失败","code":"agent_failed"}\n\n'
          + `data: ${JSON.stringify({ type: 'meta', session_id: 'server-failed', agent_response: validAgentResponse })}\n\n`,
        ));
      },
      cancel,
    }), { status: 200 }));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('查询经营数据'));

    const message = useChatStore.getState().messagesBySessionId[
      useChatStore.getState().activeSessionId!
    ].at(-1)!;
    expect(message.streaming).toBe(false);
    expect(message.agentResponse).toBeUndefined();
    expect(result.current).not.toHaveProperty('activeStage');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('sends a follow-up prompt to the active server session', async () => {
    useChatStore.setState({
      activeSessionId: 'session-1',
      sessions: [{
        session_id: 'session-1',
        title: '已有会话',
        created_at: '2026-08-21T10:00:00+08:00',
        updated_at: '2026-08-21T10:00:00+08:00',
      }],
      messagesBySessionId: { 'session-1': [] },
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('继续对比上一周期'));

    expect(chatApi.streamChat).toHaveBeenCalledWith(
      '继续对比上一周期',
      'session-1',
      expect.any(AbortSignal),
    );
  });

  it('posts a clarification interaction without changing visible user text', async () => {
    useChatStore.setState({
      activeSessionId: 'session-1',
      sessions: [{
        session_id: 'session-1',
        title: '已有会话',
        created_at: '2026-08-21T10:00:00+08:00',
        updated_at: '2026-08-21T10:00:00+08:00',
      }],
      messagesBySessionId: { 'session-1': [] },
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    const { result } = await renderHook(() => useChatStream());
    const clarifyAction = {
      action_id: 'sales',
      kind: 'clarify',
      label: '查看经营销售数据',
      source_turn_id: 'turn-1',
      params: { candidate_id: 'analytics:sales_summary', message: '查看经营销售数据' },
    };

    await act(async () => result.current.sendStructuredAction!(clarifyAction));

    expect(chatApi.streamChat).toHaveBeenCalledWith(
      '查看经营销售数据',
      'session-1',
      expect.any(AbortSignal),
      { kind: 'clarification_choice', source_turn_id: 'turn-1', candidate_id: 'analytics:sales_summary' },
    );
    expect(useChatStore.getState().messagesBySessionId['session-1'][0].content).toBe('查看经营销售数据');
  });

  it('attaches an agent response from a second metadata-only meta frame', async () => {
    const agentResponse = {
      version: 1,
      domain: 'analytics',
      task: 'sales_summary',
      result_status: 'ok',
      result_id: 'result-two-meta',
      source_turn_id: 'turn-two-meta',
      content: '销售汇总已生成',
      parts: [{ kind: 'summary', title: '销售汇总', metrics: [] }],
    };
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-sales","category":"analytics"}\n\n',
      `data: ${JSON.stringify({ type: 'meta', agent_response: agentResponse })}\n\n`,
      'data: "销售汇总已生成"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('给我过去三十天凤八店的销售数据'));

    expect(useChatStore.getState().messagesBySessionId['server-sales'][1]).toEqual(expect.objectContaining({
      agentResponse: expect.objectContaining({ result_id: agentResponse.result_id }),
      content: '销售汇总已生成',
      streaming: false,
    }));
  });

  it('ignores an unsupported agent response version and keeps fallback text', async () => {
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      `data: ${JSON.stringify({
        type: 'meta',
        session_id: 'server-sales',
        agent_response: {
          version: 2,
          domain: 'analytics',
          task: 'sales_summary',
          result_status: 'ok',
          result_id: 'result-v2',
          source_turn_id: 'turn-v2',
          parts: [{ kind: 'summary', title: '销售汇总' }],
        },
      })}\n\n`,
      'data: "销售汇总已生成"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('给我过去三十天凤八店的销售数据'));

    const assistantMessage = useChatStore.getState().messagesBySessionId['server-sales'][1];
    expect(assistantMessage).toEqual(expect.objectContaining({
      content: '销售汇总已生成',
      streaming: false,
    }));
    expect(assistantMessage).not.toHaveProperty('agentResponse');
  });

  it('ignores an oversized live response preview and keeps fallback text', async () => {
    const agentResponse = {
      version: 1,
      domain: 'analytics',
      task: 'sales_summary',
      result_status: 'ok',
      result_id: 'result-oversized',
      source_turn_id: 'turn-oversized',
      content: '销售汇总已生成',
      parts: [{
        kind: 'table',
        columns: [{ key: 'biz_date', label: '日期' }],
        preview_rows: Array.from({ length: 51 }, (_, index) => ({ biz_date: `2026-08-${index + 1}` })),
      }],
    };
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      `data: ${JSON.stringify({ type: 'meta', session_id: 'server-sales', agent_response: agentResponse })}\n\n`,
      'data: "销售汇总已生成"\n\n',
      'data: [DONE]\n\n',
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('给我过去三十天凤八店的销售数据'));

    const assistantMessage = useChatStore.getState().messagesBySessionId['server-sales'][1];
    expect(assistantMessage).toEqual(expect.objectContaining({ content: '销售汇总已生成', streaming: false }));
    expect(assistantMessage).not.toHaveProperty('agentResponse');
  });

  it('finishes the stream before a hanging evidence request and ignores evidence after reset', async () => {
    const evidence = deferred<{
      evidence: null;
      export: { available: boolean; total: number; returned: number; truncated: boolean; dataset_name: string };
      knowledge_context: null;
      knowledge_suggestion: null;
    }>();
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      'data: {"type":"meta","session_id":"server-evidence","category":"connector_query"}\n\n',
      'data: "查询完成"\n\ndata: [DONE]\n\n',
    ));
    jest.mocked(chatApi.getQueryEvidence).mockReturnValue(evidence.promise);
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('查询订单'); });
    await waitFor(() => expect(chatApi.getQueryEvidence).toHaveBeenCalledWith('server-evidence'));
    expect(result.current.isStreaming).toBe(false);
    expect(useChatStore.getState().messagesBySessionId['server-evidence'][1]).toEqual(expect.objectContaining({ streaming: false }));

    await act(() => useChatStore.getState().reset());
    await act(async () => {
      evidence.resolve({
        evidence: null,
        export: { available: true, total: 1, returned: 1, truncated: false, dataset_name: '订单' },
        knowledge_context: null,
        knowledge_suggestion: null,
      });
      await sending;
    });
    expect(useChatStore.getState().messagesBySessionId).toEqual({});
  });

  it('drops a prior turn evidence response after a newer turn completes in the same session', async () => {
    const firstEvidence = deferred<{
      evidence: null;
      export: { available: boolean; total: number; returned: number; truncated: boolean; dataset_name: string };
      knowledge_context: null;
      knowledge_suggestion: null;
    }>();
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-a","category":"connector_query"}\n\n',
        'data: "第一轮完成"\n\ndata: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-a","category":"connector_query"}\n\n',
        'data: "第二轮完成"\n\ndata: [DONE]\n\n',
      ));
    jest.mocked(chatApi.getQueryEvidence)
      .mockReturnValueOnce(firstEvidence.promise)
      .mockResolvedValueOnce({
        evidence: null,
        export: { available: true, total: 2, returned: 2, truncated: false, dataset_name: '第二轮' },
        knowledge_context: null,
        knowledge_suggestion: null,
      });
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('第一问'));
    await waitFor(() => expect(chatApi.getQueryEvidence).toHaveBeenCalledTimes(1));
    await act(async () => result.current.sendMessage('第二问'));
    await waitFor(() => expect(chatApi.getQueryEvidence).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useChatStore.getState().messagesBySessionId['server-a'][3].metadata).toEqual({
      connector_query: expect.objectContaining({ export: expect.objectContaining({ total: 2 }) }),
    }));

    await act(async () => {
      firstEvidence.resolve({
        evidence: null,
        export: { available: true, total: 1, returned: 1, truncated: false, dataset_name: '第一轮' },
        knowledge_context: null,
        knowledge_suggestion: null,
      });
      await Promise.resolve();
    });

    expect(useChatStore.getState().messagesBySessionId['server-a'][1].metadata).toBeUndefined();
    expect(useChatStore.getState().messagesBySessionId['server-a'][3].metadata).toEqual({
      connector_query: expect.objectContaining({ export: expect.objectContaining({ total: 2 }) }),
    });
  });

  it('keeps evidence fresh when a newer turn starts after the hook remounts', async () => {
    const firstEvidence = deferred<{
      evidence: null;
      export: { available: boolean; total: number; returned: number; truncated: boolean; dataset_name: string };
      knowledge_context: null;
      knowledge_suggestion: null;
    }>();
    jest.mocked(chatApi.streamChat)
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-remount","category":"connector_query"}\n\n',
        'data: "第一轮完成"\n\ndata: [DONE]\n\n',
      ))
      .mockResolvedValueOnce(responseFrom(
        'data: {"type":"meta","session_id":"server-remount","category":"connector_query"}\n\n',
        'data: "第二轮完成"\n\ndata: [DONE]\n\n',
      ));
    jest.mocked(chatApi.getQueryEvidence)
      .mockReturnValueOnce(firstEvidence.promise)
      .mockResolvedValueOnce({
        evidence: null,
        export: { available: true, total: 2, returned: 2, truncated: false, dataset_name: '第二轮' },
        knowledge_context: null,
        knowledge_suggestion: null,
      });
    useChatStore.getState().newSession();
    const firstHook = await renderHook(() => useChatStream());

    await act(async () => firstHook.result.current.sendMessage('第一问'));
    await waitFor(() => expect(chatApi.getQueryEvidence).toHaveBeenCalledTimes(1));
    await firstHook.unmount();

    const secondHook = await renderHook(() => useChatStream());
    await act(async () => secondHook.result.current.sendMessage('第二问'));
    await waitFor(() => expect(chatApi.getQueryEvidence).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useChatStore.getState().messagesBySessionId['server-remount'][3].metadata).toEqual({
      connector_query: expect.objectContaining({ export: expect.objectContaining({ total: 2 }) }),
    }));

    await act(async () => {
      firstEvidence.resolve({
        evidence: null,
        export: { available: true, total: 1, returned: 1, truncated: false, dataset_name: '第一轮' },
        knowledge_context: null,
        knowledge_suggestion: null,
      });
      await Promise.resolve();
    });

    expect(useChatStore.getState().messagesBySessionId['server-remount'][1].metadata).toBeUndefined();
    expect(useChatStore.getState().messagesBySessionId['server-remount'][3].metadata).toEqual({
      connector_query: expect.objectContaining({ export: expect.objectContaining({ total: 2 }) }),
    });
  });

  it('deduplicates history that loads before meta and continues in the pending message bucket', async () => {
    const serverSessionId = 'tenant-99:server-race';
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    jest.spyOn(chatApi, 'streamChat').mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    }), { status: 200 }));
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: serverSessionId, title: '已入列表', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('竞态问题'); });
    await act(async () => useChatStore.getState().loadSessions());
    useChatStore.setState((state) => ({
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [serverSessionId]: [{ id: 'old', role: 'assistant', content: '旧桶', created_at: '2026-07-16T09:00:00+08:00' }],
      },
    }));
    await act(() => {
      streamController.enqueue(encoder.encode(
        `data: {"type":"meta","session_id":"${serverSessionId}"}\n\ndata: "新内容"\n\ndata: [DONE]\n\n`,
      ));
    });
    await act(async () => sending);

    expect(useChatStore.getState().sessions.filter((session) => session.session_id === serverSessionId)).toHaveLength(1);
    expect(useChatStore.getState().messagesBySessionId[pendingId]).toBeUndefined();
    expect(useChatStore.getState().messagesBySessionId[serverSessionId]).toEqual([
      expect.objectContaining({ role: 'user', content: '竞态问题' }),
      expect.objectContaining({ role: 'assistant', content: '新内容', streaming: false }),
    ]);
  });

  it('stops generation without discarding received content or retrying automatically', async () => {
    jest.spyOn(chatApi, 'streamChat').mockImplementation(async (_message, _sessionId, signal) => (
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: "已接收"\n\n'));
          signal.addEventListener('abort', () => {
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        },
      }), { status: 200 })
    ));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('停止测试'); });
    await waitFor(() => {
      const sessionId = useChatStore.getState().activeSessionId!;
      expect(useChatStore.getState().messagesBySessionId[sessionId]?.[1]?.content).toBe('已接收');
    });
    await act(() => result.current.stopGeneration());
    await act(async () => sending);

    const sessionId = useChatStore.getState().activeSessionId!;
    expect(useChatStore.getState().messagesBySessionId[sessionId][1]).toEqual(
      expect.objectContaining({ content: '已接收', interrupted: true, streaming: false }),
    );
    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming).toBe(false);
  });

  it('marks a network failure as interrupted without automatically resending', async () => {
    jest.spyOn(chatApi, 'streamChat').mockRejectedValue(new Error('无法连接服务器，请检查网络或服务状态'));
    useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('断网测试'));

    const sessionId = useChatStore.getState().activeSessionId!;
    expect(useChatStore.getState().messagesBySessionId[sessionId][1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: '', interrupted: true, streaming: false }),
    );
    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
  });

  it('uses an authoritative server snapshot and never recovers an old same-text session', async () => {
    const oldSession = { session_id: 'server-old', title: '原问题', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' };
    jest.mocked(sessionsApi.listSessions).mockResolvedValue([oldSession]);
    jest.mocked(sessionsApi.getSessionDetail).mockResolvedValue({
      ...oldSession,
      messages: [
        { id: 'old-user', role: 'user', content: '原问题', created_at: '2026-07-16T09:00:00+08:00' },
        { id: 'old-assistant', role: 'assistant', content: '旧回复', created_at: '2026-07-16T09:00:01+08:00' },
      ],
    });
    jest.mocked(chatApi.streamChat).mockRejectedValueOnce(new Error('请求未到达服务端'));
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('原问题'));
    expect(useChatStore.getState().messagesBySessionId[pendingId][1]).toEqual(expect.objectContaining({
      interrupted: true,
      recovery: expect.objectContaining({
        knownSessionIds: [oldSession.session_id],
        requestSent: true,
        snapshotReady: true,
      }),
    }));

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalled();
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().messagesBySessionId[pendingId].at(-1)).toEqual(
      expect.objectContaining({ interrupted: true }),
    );
  });

  it('keeps the pending turn when snapshot loading fails and safely sends it after explicit retry', async () => {
    const oldSession = { session_id: 'server-old', title: '旧对话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' };
    const newSession = { session_id: 'tenant-99:new-session', title: '原问题', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.mocked(sessionsApi.listSessions)
      .mockRejectedValueOnce(new Error('会话列表加载失败'))
      .mockResolvedValueOnce([oldSession]);
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom(
      `data: {"type":"meta","session_id":"${newSession.session_id}"}\n\ndata: "恢复发送"\n\ndata: [DONE]\n\n`,
    ));
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.sendMessage('不能丢的问题'));

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().messagesBySessionId[pendingId]).toEqual([
      expect.objectContaining({ role: 'user', content: '不能丢的问题' }),
      expect.objectContaining({
        role: 'assistant',
        interrupted: true,
        recovery: expect.objectContaining({ requestSent: false, snapshotReady: false }),
      }),
    ]);

    await act(async () => result.current.retryInterruptedMessage());

    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(2);
    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    expect(chatApi.streamChat).toHaveBeenCalledWith('不能丢的问题', '', expect.any(AbortSignal));
    expect(useChatStore.getState().activeSessionId).toBe(newSession.session_id);
    expect(useChatStore.getState().messagesBySessionId[newSession.session_id]).toEqual([
      expect.objectContaining({ role: 'user', content: '不能丢的问题' }),
      expect.objectContaining({ role: 'assistant', content: '恢复发送', interrupted: false }),
    ]);
  });

  it('does not post a pending turn when the active session changes during snapshot loading', async () => {
    const loading = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    const sessionB = { session_id: 'server-b', title: 'B', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' };
    jest.mocked(sessionsApi.listSessions).mockReturnValue(loading.promise);
    jest.mocked(sessionsApi.getSessionDetail).mockResolvedValue({ ...sessionB, messages: [] });
    useChatStore.setState({ sessions: [sessionB], messagesBySessionId: { [sessionB.session_id]: [] } });
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('切换前的问题'); });
    await act(async () => useChatStore.getState().openSession(sessionB.session_id));
    loading.resolve([sessionB]);
    await act(async () => sending);

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().activeSessionId).toBe(sessionB.session_id);
    expect(useChatStore.getState().messagesBySessionId[pendingId].at(-1)).toEqual(
      expect.objectContaining({ interrupted: true }),
    );
  });

  it('aborts a pending first snapshot immediately and ignores its late result', async () => {
    const loading = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    let snapshotSignal: AbortSignal | undefined;
    jest.mocked(sessionsApi.listSessions).mockImplementation((signal) => {
      snapshotSignal = signal;
      return loading.promise;
    });
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());

    let sending!: Promise<void>;
    await act(() => { sending = result.current.sendMessage('停止快照'); });
    await waitFor(() => expect(sessionsApi.listSessions).toHaveBeenCalledTimes(1));
    await act(() => result.current.stopGeneration());
    const busyAfterStop = result.current.isStreaming;
    loading.resolve([]);
    await act(async () => sending);

    expect(snapshotSignal?.aborted).toBe(true);
    expect(busyAfterStop).toBe(false);
    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().messagesBySessionId[pendingId][1]).toEqual(expect.objectContaining({
      interrupted: true,
      recovery: expect.objectContaining({ requestSent: false, snapshotReady: false }),
    }));
  });

  it('reloads and opens the server session before an explicit interrupted retry', async () => {
    const order: string[] = [];
    const serverSessionId = 'tenant-99:session-4b2f';
    const session = {
      session_id: serverSessionId,
      title: '已有对话',
      created_at: '2026-07-16T10:00:00+08:00',
      updated_at: '2026-07-16T10:00:00+08:00',
    };
    jest.spyOn(sessionsApi, 'listSessions').mockImplementation(async () => {
      order.push('load');
      return [session];
    });
    jest.spyOn(sessionsApi, 'getSessionDetail').mockImplementation(async () => {
      order.push('open');
      return { ...session, messages: [] };
    });
    jest.spyOn(chatApi, 'streamChat').mockImplementation(async () => {
      order.push('send');
      return responseFrom('data: "重试成功"\n\ndata: [DONE]\n\n');
    });
    useChatStore.setState({
      activeSessionId: serverSessionId,
      messagesBySessionId: {
        [serverSessionId]: [
          { id: 'user-1', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
          { id: 'assistant-1', role: 'assistant', content: '部分', created_at: '2026-07-16T10:00:01+08:00', interrupted: true, streaming: false },
        ],
      },
      sessions: [session],
    });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.retryInterruptedMessage());

    expect(order).toEqual(['load', 'open', 'send']);
    expect(chatApi.streamChat).toHaveBeenCalledWith('原问题', serverSessionId, expect.any(AbortSignal));
  });

  it('does not reclaim session A when the user opens B while retry is loading sessions', async () => {
    const loading = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    const sessionA = { session_id: 'server-a', title: 'A', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    const sessionB = { session_id: 'server-b', title: 'B', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.spyOn(sessionsApi, 'listSessions').mockReturnValue(loading.promise);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockImplementation(async (sessionId) => ({
      ...(sessionId === 'server-b' ? sessionB : sessionA),
      messages: [],
    }));
    jest.spyOn(chatApi, 'streamChat').mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    useChatStore.setState({
      activeSessionId: 'server-a',
      messagesBySessionId: {
        'server-a': [
          { id: 'user-a', role: 'user', content: 'A 问题', created_at: '2026-07-16T10:00:00+08:00' },
          { id: 'assistant-a', role: 'assistant', content: '中断', created_at: '2026-07-16T10:00:01+08:00', interrupted: true },
        ],
        'server-b': [],
      },
      sessions: [sessionA, sessionB],
    });
    const { result } = await renderHook(() => useChatStream());

    let retrying!: Promise<void>;
    await act(() => { retrying = result.current.retryInterruptedMessage(); });
    await act(async () => useChatStore.getState().openSession('server-b'));
    loading.resolve([sessionA, sessionB]);
    await act(async () => retrying);

    expect(useChatStore.getState().activeSessionId).toBe('server-b');
    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalledWith('server-a', expect.any(AbortSignal));
    expect(chatApi.streamChat).not.toHaveBeenCalled();
  });

  it('blocks a new send and lets stop invalidate retry while session loading is pending', async () => {
    const loading = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    const session = { session_id: 'server-a', title: 'A', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    const interruptedMessages = [
      { id: 'user-a', role: 'user', content: 'A 问题', created_at: '2026-07-16T10:00:00+08:00' },
      { id: 'assistant-a', role: 'assistant', content: '中断', created_at: '2026-07-16T10:00:01+08:00', interrupted: true },
    ];
    jest.mocked(sessionsApi.listSessions).mockReturnValue(loading.promise);
    jest.mocked(sessionsApi.getSessionDetail).mockResolvedValue({ ...session, messages: interruptedMessages });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    useChatStore.setState({
      activeSessionId: session.session_id,
      messagesBySessionId: { [session.session_id]: interruptedMessages },
      sessions: [session],
    });
    const { result } = await renderHook(() => useChatStream());

    let retrying!: Promise<void>;
    await act(() => { retrying = result.current.retryInterruptedMessage(); });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(async () => result.current.sendMessage('不应发送的新问题'));
    await act(() => result.current.stopGeneration());
    loading.resolve([session]);
    await act(async () => retrying);

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalled();
    expect(useChatStore.getState().messagesBySessionId[session.session_id]).toEqual(interruptedMessages);
    expect(result.current.isStreaming).toBe(false);
  });

  it('aborts pending recovery detail and ignores the late matching session', async () => {
    const detailLoading = deferred<{
      session_id: string;
      title: string;
      created_at: string;
      updated_at: string;
      messages: Array<{ id: string; role: string; content: string; created_at: string }>;
    }>();
    const recovered = { session_id: 'tenant-99:late', title: '原问题', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    let listSignal: AbortSignal | undefined;
    let detailSignal: AbortSignal | undefined;
    jest.mocked(sessionsApi.listSessions).mockImplementation(async (signal) => {
      listSignal = signal;
      return [recovered];
    });
    jest.mocked(sessionsApi.getSessionDetail).mockImplementation((_sessionId, signal) => {
      detailSignal = signal;
      return detailLoading.promise;
    });
    const pendingId = useChatStore.getState().newSession();
    const originalMessages = [
      { id: 'local-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
      {
        id: 'local-assistant',
        role: 'assistant',
        content: '中断',
        created_at: '2026-07-16T10:00:01+08:00',
        interrupted: true,
        recovery: {
          knownSessionIds: [],
          requestSent: true,
          snapshotReady: true,
          startedAt: '2026-07-16T10:00:00+08:00',
          userText: '原问题',
        },
      },
    ];
    useChatStore.setState({ messagesBySessionId: { [pendingId]: originalMessages } });
    const { result } = await renderHook(() => useChatStream());

    let retrying!: Promise<void>;
    await act(() => { retrying = result.current.retryInterruptedMessage(); });
    await waitFor(() => expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(1));
    await act(() => result.current.stopGeneration());
    detailLoading.resolve({
      ...recovered,
      messages: [{ id: 'server-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' }],
    });
    await act(async () => retrying);

    expect(listSignal?.aborted).toBe(true);
    expect(detailSignal?.aborted).toBe(true);
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().messagesBySessionId).toEqual({ [pendingId]: originalMessages });
    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
  });

  it.each([true, false])(
    'blocks a normal send while a pending turn with requestSent=%s is unresolved',
    async (requestSent) => {
      const pendingId = useChatStore.getState().newSession();
      const originalMessages = [
        { id: 'local-user', role: 'user', content: '第一问', created_at: '2026-07-16T10:00:00+08:00' },
        {
          id: 'local-assistant',
          role: 'assistant',
          content: '中断',
          created_at: '2026-07-16T10:00:01+08:00',
          interrupted: true,
          recovery: {
            knownSessionIds: [],
            requestSent,
            snapshotReady: true,
            startedAt: '2026-07-16T10:00:00+08:00',
            userText: '第一问',
          },
        },
      ];
      useChatStore.setState({ messagesBySessionId: { [pendingId]: originalMessages } });
      jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom('data: [DONE]\n\n'));
      const { result } = await renderHook(() => useChatStream());

      expect(result.current.isPendingBlocked).toBe(true);
      await act(async () => result.current.sendMessage('第二问'));

      expect(chatApi.streamChat).not.toHaveBeenCalled();
      expect(sessionsApi.listSessions).not.toHaveBeenCalled();
      expect(useChatStore.getState().activeSessionId).toBe(pendingId);
      expect(useChatStore.getState().messagesBySessionId).toEqual({ [pendingId]: originalMessages });
    },
  );

  it('does not resend when the latest matching user already has an assistant reply', async () => {
    const session = { session_id: 'server-a', title: 'A', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([session]);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      ...session,
      messages: [
        { id: 'server-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
        { id: 'server-assistant', role: 'assistant', content: '服务端已完成', created_at: '2026-07-16T10:00:01+08:00' },
      ],
    });
    jest.spyOn(chatApi, 'streamChat').mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    useChatStore.setState({
      activeSessionId: 'server-a',
      messagesBySessionId: {
        'server-a': [
          { id: 'local-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
          { id: 'local-assistant', role: 'assistant', content: '中断', created_at: '2026-07-16T10:00:01+08:00', interrupted: true },
        ],
      },
      sessions: [session],
    });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).not.toHaveBeenCalled();
    expect(useChatStore.getState().messagesBySessionId['server-a']).toEqual([
      expect.objectContaining({ id: 'server-user' }),
      expect.objectContaining({ id: 'server-assistant', content: '服务端已完成' }),
    ]);
  });

  it('retries when the latest matching user has no later assistant reply', async () => {
    const session = { session_id: 'server-a', title: 'A', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.mocked(sessionsApi.listSessions).mockResolvedValue([session]);
    jest.mocked(sessionsApi.getSessionDetail).mockResolvedValue({
      ...session,
      messages: [
        { id: 'server-user-old', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
        { id: 'server-assistant-old', role: 'assistant', content: '旧回复', created_at: '2026-07-16T10:00:01+08:00' },
        { id: 'server-user-latest', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:02+08:00' },
      ],
    });
    jest.mocked(chatApi.streamChat).mockResolvedValue(responseFrom('data: [DONE]\n\n'));
    useChatStore.setState({
      activeSessionId: session.session_id,
      messagesBySessionId: {
        [session.session_id]: [
          { id: 'local-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
          { id: 'local-assistant', role: 'assistant', content: '中断', created_at: '2026-07-16T10:00:01+08:00', interrupted: true },
        ],
      },
      sessions: [session],
    });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).toHaveBeenCalledWith('原问题', session.session_id, expect.any(AbortSignal));
  });

  it('recovers a pending first turn and stops when the server already has the reply', async () => {
    const oldSession = { session_id: 'server-old', title: '旧对话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' };
    const recoveredSession = { session_id: 'tenant-99:recovered', title: '原问题', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(new Error('网络中断'));
    jest.mocked(sessionsApi.listSessions).mockResolvedValue([oldSession]);
    useChatStore.setState({ activeSessionId: oldSession.session_id, sessions: [oldSession], messagesBySessionId: { [oldSession.session_id]: [] } });
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    await act(async () => result.current.sendMessage('原问题'));
    expect(useChatStore.getState().messagesBySessionId[pendingId][1]).toEqual(expect.objectContaining({
      interrupted: true,
      recovery: expect.objectContaining({ knownSessionIds: ['server-old'], userText: '原问题', startedAt: expect.any(String) }),
    }));
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([recoveredSession, oldSession]);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      ...recoveredSession,
      messages: [
        { id: 'server-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' },
        { id: 'server-assistant', role: 'assistant', content: '已在服务端完成', created_at: '2026-07-16T10:00:01+08:00' },
      ],
    });

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    expect(sessionsApi.getSessionDetail).toHaveBeenCalledWith(
      recoveredSession.session_id,
      expect.any(AbortSignal),
    );
    expect(useChatStore.getState().activeSessionId).toBe(recoveredSession.session_id);
    expect(useChatStore.getState().messagesBySessionId[recoveredSession.session_id]).toEqual([
      expect.objectContaining({ id: 'server-user' }),
      expect.objectContaining({ id: 'server-assistant' }),
    ]);
  });

  it('retries a recovered pending first turn on the matched server session, never an empty ID', async () => {
    const recoveredSession = { session_id: 'tenant-99:user-only', title: '原问题', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.spyOn(chatApi, 'streamChat')
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce(responseFrom('data: "重试回复"\n\ndata: [DONE]\n\n'));
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    await act(async () => result.current.sendMessage('原问题'));
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([recoveredSession]);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      ...recoveredSession,
      messages: [{ id: 'server-user', role: 'user', content: '原问题', created_at: '2026-07-16T10:00:00+08:00' }],
    });

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).toHaveBeenNthCalledWith(1, '原问题', '', expect.any(AbortSignal));
    expect(chatApi.streamChat).toHaveBeenNthCalledWith(2, '原问题', recoveredSession.session_id, expect.any(AbortSignal));
    expect(useChatStore.getState().activeSessionId).toBe(recoveredSession.session_id);
    expect(useChatStore.getState().messagesBySessionId[pendingId]).toBeUndefined();
  });

  it('keeps a pending interruption when no new server session reliably matches', async () => {
    const unrelatedSession = { session_id: 'tenant-99:unrelated', title: '原问题', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' };
    jest.spyOn(chatApi, 'streamChat').mockRejectedValueOnce(new Error('网络中断'));
    const pendingId = useChatStore.getState().newSession();
    const { result } = await renderHook(() => useChatStream());
    await act(async () => result.current.sendMessage('原问题'));
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([unrelatedSession]);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      ...unrelatedSession,
      messages: [{ id: 'other-user', role: 'user', content: '其他问题', created_at: '2026-07-16T10:00:00+08:00' }],
    });

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().messagesBySessionId[pendingId].at(-1)).toEqual(expect.objectContaining({ interrupted: true }));
    expect(showToast).toHaveBeenLastCalledWith('未能确认服务端会话，请稍后重试', 'error');
  });

  it('does not retry an older interruption after a later reply completed', async () => {
    const sessionId = useChatStore.getState().newSession();
    useChatStore.setState({
      messagesBySessionId: {
        [sessionId]: [
          { id: 'user-1', role: 'user', content: '旧问题', created_at: '2026-07-16T10:00:00+08:00' },
          { id: 'assistant-1', role: 'assistant', content: '中断', created_at: '2026-07-16T10:00:01+08:00', interrupted: true },
          { id: 'user-2', role: 'user', content: '新问题', created_at: '2026-07-16T10:01:00+08:00' },
          { id: 'assistant-2', role: 'assistant', content: '已完成', created_at: '2026-07-16T10:01:01+08:00', interrupted: false },
        ],
      },
    });
    const { result } = await renderHook(() => useChatStream());

    await act(async () => result.current.retryInterruptedMessage());

    expect(chatApi.streamChat).not.toHaveBeenCalled();
  });
});
