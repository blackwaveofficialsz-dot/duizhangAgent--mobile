import * as sessionsApi from '@/services/api/sessions';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { createChatCache } from '@/services/cache/chatCache';
import type { CacheEntry, CacheStorage } from '@/services/cache/cacheRepositories';
import { getOfflineCacheIdentity, getOfflineCacheRepositories, runCurrentCacheOperation } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { partialSalesAgentResponse, sessionDetailWithAgentResponse, validAgentResponse } from '@/test/agentResponseFixture';
import { parseAgentActivity } from '@/types/agentActivity';
import { useChatStore } from './chatStore';

jest.mock('@/services/api/sessions', () => ({
  deleteSession: jest.fn(),
  getSessionDetail: jest.fn(),
  listSessions: jest.fn(),
}));
jest.mock('@/services/cache/offlineCache', () => ({
  getOfflineCacheIdentity: jest.fn(),
  getOfflineCacheRepositories: jest.fn(),
  runCurrentCacheOperation: jest.fn(),
}));

class MemoryCacheStorage implements CacheStorage {
  entries: CacheEntry[] = [];

  async clear(): Promise<void> { this.entries = []; }
  async purgeExpired(now: number): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.expiresAt >= now);
  }
  async readCategory(identity: CacheEntry['identity'], category: CacheEntry['category']): Promise<CacheEntry[]> {
    return this.entries.filter((entry) => (
      entry.identity.tenantId === identity.tenantId
      && entry.identity.userId === identity.userId
      && entry.category === category
    ));
  }
  async replaceCategory(identity: CacheEntry['identity'], category: CacheEntry['category'], entries: CacheEntry[]): Promise<void> {
    this.entries = [
      ...this.entries.filter((entry) => entry.identity.tenantId !== identity.tenantId || entry.identity.userId !== identity.userId || entry.category !== category),
      ...entries,
    ];
  }
  async upsert(entry: CacheEntry): Promise<void> {
    this.entries = [...this.entries.filter((candidate) => candidate.key !== entry.key), entry];
  }
}

function deferred<T>() {
  let reject!: (error: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('useChatStore', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.mocked(getOfflineCacheIdentity).mockReturnValue(null);
    jest.mocked(getOfflineCacheRepositories).mockReset();
    jest.mocked(runCurrentCacheOperation).mockImplementation(async (operation) => {
      const identity = jest.mocked(getOfflineCacheIdentity)();
      if (!identity) return null;
      return operation(await jest.mocked(getOfflineCacheRepositories)(), identity);
    });
    useChatStore.setState({
      activeSessionId: null,
      deletingSessionId: null,
      isOffline: false,
      lastSyncedAt: null,
      messagesBySessionId: {},
      sessions: [],
    });
    useNetworkStore.setState({ status: 'online' });
  });

  it('replaces a local pending session ID while preserving its messages', () => {
    const pendingId = useChatStore.getState().newSession();
    useChatStore.setState({
      messagesBySessionId: {
        [pendingId]: [{ id: 'message-1', role: 'user', content: '你好', created_at: '2026-07-16T10:00:00+08:00' }],
      },
    });

    useChatStore.getState().replacePendingSessionId(pendingId, 'server-1');

    expect(useChatStore.getState().activeSessionId).toBe('server-1');
    expect(useChatStore.getState().sessions).toEqual([
      expect.objectContaining({ pending: false, session_id: 'server-1' }),
    ]);
    expect(useChatStore.getState().messagesBySessionId).toEqual({
      'server-1': [{ id: 'message-1', role: 'user', content: '你好', created_at: '2026-07-16T10:00:00+08:00' }],
    });
  });

  it('updates only the current stream tool calls', () => {
    useChatStore.setState({
      messagesBySessionId: {
        'server-1': [
          { id: 'tool-running', role: 'tool_call', content: '', created_at: '2026-07-16T10:00:00+08:00', toolCall: { name: '查询', description: '', status: 'running' } },
          { id: 'tool-complete', role: 'tool_call', content: '', created_at: '2026-07-16T10:00:01+08:00', toolCall: { name: '旧查询', description: '', status: 'completed' } },
        ],
      },
    });

    useChatStore.getState().finishToolCalls('server-1', ['tool-running'], 'failed');

    expect(useChatStore.getState().messagesBySessionId['server-1']).toEqual([
      expect.objectContaining({ toolCall: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ toolCall: expect.objectContaining({ status: 'completed' }) }),
    ]);
  });

  it('merges and finishes activity only on its target assistant message', () => {
    useChatStore.setState({
      messagesBySessionId: {
        'server-activity': [
          { id: 'user-1', role: 'user', content: '分析', created_at: '2026-08-24T10:00:00+08:00' },
          { id: 'assistant-1', role: 'assistant', content: '', created_at: '2026-08-24T10:00:01+08:00', streaming: true },
          { id: 'tool-1', role: 'tool_call', content: '', created_at: '2026-08-24T10:00:02+08:00' },
        ],
      },
    });

    useChatStore.getState().mergeMessageActivity('server-activity', 'assistant-1', {
      step_id: 'query-sales', label: '查询销售数据', status: 'running', elapsed_ms: 20, sequence: 1,
    });
    useChatStore.getState().mergeMessageActivity('server-activity', 'user-1', {
      step_id: 'must-not-attach', label: '不应写入', status: 'running', elapsed_ms: 1, sequence: 2,
    });
    useChatStore.getState().finishMessageActivity('server-activity', 'assistant-1', 'completed');

    const [user, assistant, tool] = useChatStore.getState().messagesBySessionId['server-activity'];
    expect(user.activity).toBeUndefined();
    expect(tool.activity).toBeUndefined();
    expect(assistant.activity).toEqual(expect.objectContaining({
      status: 'completed',
      steps: [expect.objectContaining({ step_id: 'query-sales', status: 'completed' })],
    }));
  });

  it('installs a terminal server activity that client completion cannot overwrite', () => {
    useChatStore.setState({
      messagesBySessionId: {
        'server-activity': [{
          id: 'assistant-1', role: 'assistant', content: '', created_at: '2026-08-24T10:00:00+08:00', streaming: true,
        }],
      },
    });
    const terminal = parseAgentActivity({
      version: 'v1', status: 'partial', label: '分析结果不完整', elapsed_ms: 50,
      total_duration_ms: 175,
      steps: [{ step_id: 'load', label: '读取业务数据', status: 'completed', elapsed_ms: 50 }],
      scope: ['凤八店'], sources: ['经营销售快照'],
    })!;
    const store = useChatStore.getState() as ReturnType<typeof useChatStore.getState> & {
      setMessageActivity?: (sessionId: string, messageId: string, activity: typeof terminal) => void;
    };

    expect(typeof store.setMessageActivity).toBe('function');
    store.setMessageActivity?.('server-activity', 'assistant-1', terminal);
    useChatStore.getState().finishMessageActivity('server-activity', 'assistant-1', 'completed');

    expect(useChatStore.getState().messagesBySessionId['server-activity'][0].activity).toEqual(terminal);
  });

  it('attaches an agent response without copying it into metadata', () => {
    useChatStore.setState({
      messagesBySessionId: {
        'server-1': [{
          id: 'assistant-1',
          role: 'assistant',
          content: '销售汇总已生成',
          created_at: '2026-08-18T10:00:00+08:00',
          metadata: { connector_query: { export: { available: true, total: 12 } } },
        }],
      },
    });
    const agentResponse = validAgentResponse;

    useChatStore.getState().setMessageAgentResponse('server-1', 'assistant-1', agentResponse);

    expect(useChatStore.getState().messagesBySessionId['server-1'][0]).toEqual(expect.objectContaining({
      agentResponse,
      metadata: {
        connector_query: { export: { available: true, total: 12 } },
      },
    }));
  });

  it('deduplicates a server session and keeps pending messages during replacement', () => {
    const pendingId = useChatStore.getState().newSession();
    const pendingMessages = [
      { id: 'user-local', role: 'user', content: '本地问题', created_at: '2026-07-16T10:00:00+08:00' },
      { id: 'assistant-local', role: 'assistant', content: '部分', created_at: '2026-07-16T10:00:01+08:00', streaming: true },
    ];
    useChatStore.setState((state) => ({
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [pendingId]: pendingMessages,
        'tenant-99:server-1': [
          { id: 'assistant-old', role: 'assistant', content: '旧目标桶', created_at: '2026-07-16T09:00:00+08:00' },
        ],
      },
      sessions: [
        ...state.sessions,
        { session_id: 'tenant-99:server-1', title: '服务端对话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    }));

    useChatStore.getState().replacePendingSessionId(pendingId, 'tenant-99:server-1');
    useChatStore.getState().appendMessageContent('tenant-99:server-1', 'assistant-local', '继续');

    expect(useChatStore.getState().sessions.filter((session) => session.session_id === 'tenant-99:server-1')).toHaveLength(1);
    expect(useChatStore.getState().messagesBySessionId).toEqual({
      'tenant-99:server-1': [
        pendingMessages[0],
        expect.objectContaining({ id: 'assistant-local', content: '部分继续' }),
      ],
    });
  });

  it('ignores stale append and finish writes after reset', () => {
    const pendingId = useChatStore.getState().newSession();
    useChatStore.getState().addMessage(pendingId, {
      id: 'assistant-1', role: 'assistant', content: '部分', created_at: '2026-07-16T10:00:00+08:00', streaming: true,
    });

    useChatStore.getState().reset();
    useChatStore.getState().appendMessageContent(pendingId, 'assistant-1', '迟到');
    useChatStore.getState().finishMessage(pendingId, 'assistant-1', true);

    expect(useChatStore.getState().messagesBySessionId).toEqual({});
  });

  it('does not recreate a deleted message bucket from a stale finish', async () => {
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: {
        'server-1': [{ id: 'assistant-1', role: 'assistant', content: '部分', created_at: '2026-07-16T10:00:00+08:00', streaming: true }],
      },
      sessions: [{ session_id: 'server-1', title: '待删除', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    jest.spyOn(sessionsApi, 'deleteSession').mockResolvedValue(undefined);

    await useChatStore.getState().deleteSession('server-1');
    useChatStore.getState().finishMessage('server-1', 'assistant-1', true);

    expect(useChatStore.getState().messagesBySessionId['server-1']).toBeUndefined();
  });

  it('keeps a local pending session when refreshing the server list', async () => {
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '服务端对话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' },
    ]);
    const pendingId = useChatStore.getState().newSession();

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual([pendingId, 'server-1']);
  });

  it('shows only the current user cached session list when offline', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    const read = jest.fn().mockResolvedValue([
      { session_id: 'cached-1', title: '缓存会话', created_at: '2026-07-16T14:00:00+08:00', updated_at: '2026-07-16T15:05:00+08:00' },
    ]);
    jest.mocked(getOfflineCacheIdentity).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    jest.mocked(getOfflineCacheRepositories).mockResolvedValue({
      sessions: { lastSyncedAt: jest.fn().mockResolvedValue(cachedAt), read, save: jest.fn() },
    } as never);
    jest.spyOn(sessionsApi, 'listSessions').mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));

    await useChatStore.getState().loadSessions();

    expect(read).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, expect.any(Number));
    expect(useChatStore.getState()).toMatchObject({
      isOffline: true,
      lastSyncedAt: cachedAt,
      sessions: [expect.objectContaining({ session_id: 'cached-1', title: '缓存会话' })],
    });
  });

  it('opens a cached session body without a network request while offline', async () => {
    const detail = {
      session_id: 'cached-1',
      title: '缓存会话',
      messages: [{ id: 'message-1', role: 'assistant', content: '离线正文', created_at: '2026-07-16T15:00:00+08:00' }],
    };
    jest.mocked(getOfflineCacheIdentity).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    jest.mocked(getOfflineCacheRepositories).mockResolvedValue({
      sessions: { readDetail: jest.fn().mockResolvedValue(detail) },
    } as never);
    useChatStore.setState({
      isOffline: true,
      sessions: [{ session_id: 'cached-1', title: '缓存会话', created_at: '2026-07-16T15:00:00+08:00', updated_at: '2026-07-16T15:00:00+08:00' }],
    });
    useNetworkStore.setState({ status: 'offline' });

    await expect(useChatStore.getState().openSession('cached-1')).resolves.toBe(true);

    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalled();
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: 'cached-1',
      messagesBySessionId: { 'cached-1': detail.messages },
    });
  });

  it('hydrates a valid agent response from historical metadata', async () => {
    const agentResponse = {
      version: 1 as const,
      domain: 'analytics',
      task: 'sales_summary',
      result_status: 'ok' as const,
      result_id: 'result-history',
      source_turn_id: 'turn-history',
      content: '销售汇总已生成',
      parts: [{ kind: 'summary', title: '历史销售汇总', metrics: [] }],
    };
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'server-history',
      title: '历史会话',
      messages: [{
        id: 'assistant-history',
        role: 'assistant',
        content: '销售汇总已生成',
        created_at: '2026-08-18T10:00:00+08:00',
        metadata: {
          connector_query: { export: { available: true, total: 12 } },
          agent_response: agentResponse,
        },
      }],
    });
    useChatStore.setState({
      sessions: [{ session_id: 'server-history', title: '历史会话', created_at: '2026-08-18T10:00:00+08:00', updated_at: '2026-08-18T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('server-history')).resolves.toBe(true);

    expect(useChatStore.getState().messagesBySessionId['server-history'][0]).toEqual(expect.objectContaining({
      agentResponse: expect.objectContaining({ result_id: agentResponse.result_id }),
      metadata: expect.objectContaining({ connector_query: expect.any(Object), agent_response: agentResponse }),
    }));
  });

  it('restores only validated v1 activity from assistant history metadata', async () => {
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'server-activity-history',
      title: '活动历史',
      messages: [
        {
          id: 'user-history', role: 'user', content: '分析', created_at: '2026-08-24T10:00:00+08:00',
          metadata: {
            agent_activity: {
              version: 'v1', status: 'running', label: '不应恢复', elapsed_ms: 10, steps: [], scope: [], sources: [],
            },
          },
        },
        {
          id: 'assistant-history', role: 'assistant', content: '结果', created_at: '2026-08-24T10:00:01+08:00',
          metadata: {
            agent_activity: {
              version: 'v1', status: 'completed', label: '分析完成', elapsed_ms: 30,
              steps: [{ step_id: 'query-sales', label: '查询销售数据', status: 'completed', elapsed_ms: 30 }],
              scope: ['销售'], sources: ['销售日报'], private_reasoning: 'drop-me',
            },
          },
        },
        {
          id: 'assistant-malformed', role: 'assistant', content: '旧结果', created_at: '2026-08-24T10:00:02+08:00',
          metadata: { agent_activity: { version: 'v2', status: 'completed' } },
        },
      ],
    });
    useChatStore.setState({
      sessions: [{ session_id: 'server-activity-history', title: '活动历史', created_at: '2026-08-24T10:00:00+08:00', updated_at: '2026-08-24T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('server-activity-history')).resolves.toBe(true);

    const messages = useChatStore.getState().messagesBySessionId['server-activity-history'];
    expect(messages[0].activity).toBeUndefined();
    expect(messages[1].activity).toEqual({
      version: 'v1', status: 'completed', label: '分析完成', elapsed_ms: 30,
      steps: [{ step_id: 'query-sales', label: '查询销售数据', status: 'completed', elapsed_ms: 30, sequence: 1 }],
      scope: ['销售'], sources: ['销售日报'],
    });
    expect(messages[2].activity).toBeUndefined();
  });

  it('removes raw activity metadata while retaining safe history metadata', async () => {
    const saveDetail = jest.fn().mockResolvedValue(undefined);
    jest.mocked(getOfflineCacheIdentity).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    jest.mocked(getOfflineCacheRepositories).mockResolvedValue({ sessions: { saveDetail } } as never);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'server-sanitized-history', title: '安全活动',
      messages: [{
        id: 'assistant-history', role: 'assistant', content: '结果', created_at: '2026-08-24T10:00:00+08:00',
        metadata: {
          connector_query: { export: { available: true, total: 3 } },
          agent_activity: {
            version: 'v1', status: 'completed', label: '分析完成', elapsed_ms: 20,
            steps: [], scope: [], sources: [], private_reasoning: 'do-not-store',
          },
        },
      }],
    });
    useChatStore.setState({
      sessions: [{ session_id: 'server-sanitized-history', title: '安全活动', created_at: '2026-08-24T10:00:00+08:00', updated_at: '2026-08-24T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('server-sanitized-history')).resolves.toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const message = useChatStore.getState().messagesBySessionId['server-sanitized-history'][0];
    expect(message.metadata).toEqual({ connector_query: { export: { available: true, total: 3 } } });
    expect(message.activity).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(JSON.stringify(message)).not.toContain('do-not-store');
    expect(JSON.stringify(saveDetail.mock.calls[0][1])).not.toContain('do-not-store');
  });

  it('restores a validated response from history metadata', async () => {
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue(sessionDetailWithAgentResponse());
    useChatStore.setState({
      sessions: [{ session_id: 'session-1', title: '经营分析', created_at: '2026-08-21T10:00:00+08:00', updated_at: '2026-08-21T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('session-1')).resolves.toBe(true);

    expect(useChatStore.getState().messagesBySessionId['session-1'][0].agentResponse?.parts.map((part) => part.kind))
      .toEqual(['summary', 'insights', 'table', 'notice']);
  });

  it('caches normalized API history and restores it after a network failure', async () => {
    const saveDetail = jest.fn().mockResolvedValue(undefined);
    const readDetail = jest.fn();
    jest.mocked(getOfflineCacheIdentity).mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    jest.mocked(getOfflineCacheRepositories).mockResolvedValue({ sessions: { readDetail, saveDetail } } as never);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'sales-history', title: '销售分析',
      messages: [{
        id: 'assistant-sales', role: 'assistant', content: '本期销售数据缺少 1 天快照。', created_at: '2026-08-21T10:00:00+08:00',
        metadata: { agent_response: partialSalesAgentResponse, ignored_private_data: 'drop-me' },
      }],
    });

    await expect(useChatStore.getState().openSession('sales-history')).resolves.toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const cachedDetail = saveDetail.mock.calls[0][1];
    expect(cachedDetail.messages[0].agentResponse?.result_id).toBe('sales-turn-partial');

    useChatStore.getState().reset();
    readDetail.mockResolvedValue(cachedDetail);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));

    await expect(useChatStore.getState().openSession('sales-history')).resolves.toBe(true);
    expect(readDetail).toHaveBeenCalled();
    expect(useChatStore.getState().messagesBySessionId['sales-history'][0].agentResponse?.limitations)
      .toEqual([{ code: 'missing_dates', text: '缺少 1 天快照。' }]);
  });

  it('persists normalized recovered direct-open history through the real offline cache', async () => {
    const identity = { tenantId: 'tenant-1', userId: 'user-1' };
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    jest.mocked(getOfflineCacheIdentity).mockReturnValue(identity);
    jest.mocked(getOfflineCacheRepositories).mockResolvedValue({ sessions: cache } as never);
    const pendingId = useChatStore.getState().newSession();
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'sales-history', title: '销售分析', created_at: '2026-08-21T10:00:00+08:00', updated_at: '2026-08-21T10:00:00+08:00' },
    ]);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'sales-history', title: '销售分析',
      messages: [
        { id: 'user-sales', role: 'user', content: '销售分析', created_at: '2026-08-21T10:00:00+08:00' },
        {
          id: 'assistant-sales', role: 'assistant', content: '本期销售数据缺少 1 天快照。', created_at: '2026-08-21T10:00:01+08:00',
          metadata: {
            agent_response: partialSalesAgentResponse,
            corrupt_agent_response: { version: 1, parts: [] },
            ignored_private_data: 'drop-me',
          },
        },
      ],
    });

    await expect(useChatStore.getState().recoverPendingSession(pendingId, {
      knownSessionIds: [], requestSent: true, snapshotReady: true,
      startedAt: '2026-08-21T10:00:00+08:00', userText: '销售分析',
    })).resolves.toEqual(expect.objectContaining({ status: 'recovered' }));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.entries).toHaveLength(1);
    expect(storage.entries[0].payload).not.toContain('ignored_private_data');
    expect(storage.entries[0].payload).not.toContain('corrupt_agent_response');
    const persisted = JSON.parse(storage.entries[0].payload) as { messages: Array<Record<string, unknown>> };
    const persistedAssistant = persisted.messages.find((message) => message.id === 'assistant-sales');
    expect(persistedAssistant).toBeDefined();
    expect(persistedAssistant).not.toHaveProperty('metadata');
    const restored = await cache.readDetail(identity, 'sales-history', Date.now());
    expect(restored?.messages[0]).toEqual(expect.objectContaining({ content: '销售分析' }));
    expect(restored?.messages[1].agentResponse).toEqual(expect.objectContaining({ result_id: 'sales-turn-partial' }));
    expect(restored?.messages[1].metadata).toBeUndefined();
  });

  it('ignores an oversized historical response preview while preserving fallback content', async () => {
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({
      session_id: 'server-history',
      title: '历史会话',
      messages: [{
        id: 'assistant-history',
        role: 'assistant',
        content: '销售汇总已生成',
        created_at: '2026-08-18T10:00:00+08:00',
        metadata: {
          agent_response: {
            version: 1,
            domain: 'analytics',
            task: 'sales_summary',
            result_status: 'ok',
            result_id: 'result-history-oversized',
            source_turn_id: 'turn-history-oversized',
            content: '销售汇总已生成',
            parts: [{
              kind: 'table',
              columns: [{ key: 'biz_date', label: '日期' }],
              preview_rows: Array.from({ length: 51 }, (_, index) => ({ biz_date: `2026-08-${index + 1}` })),
            }],
          },
        },
      }],
    });
    useChatStore.setState({
      sessions: [{ session_id: 'server-history', title: '历史会话', created_at: '2026-08-18T10:00:00+08:00', updated_at: '2026-08-18T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('server-history')).resolves.toBe(true);

    const message = useChatStore.getState().messagesBySessionId['server-history'][0];
    expect(message.content).toBe('销售汇总已生成');
    expect(message.agentResponse).toBeUndefined();
  });

  it('refreshes a cached session body from the server when the device is online again', async () => {
    const detail = {
      session_id: 'cached-1',
      title: '服务端会话',
      messages: [{ id: 'message-2', role: 'assistant', content: '最新正文', created_at: '2026-07-16T15:10:00+08:00' }],
    };
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue(detail);
    useChatStore.setState({
      isOffline: true,
      sessions: [{ session_id: 'cached-1', title: '缓存会话', created_at: '2026-07-16T15:00:00+08:00', updated_at: '2026-07-16T15:00:00+08:00' }],
    });

    await expect(useChatStore.getState().openSession('cached-1')).resolves.toBe(true);

    expect(sessionsApi.getSessionDetail).toHaveBeenCalledWith('cached-1', undefined);
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: 'cached-1',
      isOffline: false,
      messagesBySessionId: { 'cached-1': detail.messages },
    });
  });

  it('returns to a new local session after deleting the active server session', async () => {
    jest.spyOn(sessionsApi, 'deleteSession').mockResolvedValue(undefined);
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '已完成对话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().deleteSession('server-1')).resolves.toBe('deleted-active');

    expect(sessionsApi.deleteSession).toHaveBeenCalledWith('server-1');
    expect(useChatStore.getState().sessions).toHaveLength(1);
    expect(useChatStore.getState().sessions[0]).toEqual(expect.objectContaining({ pending: true }));
    expect(useChatStore.getState().activeSessionId).toBe(useChatStore.getState().sessions[0].session_id);
  });

  it('does not delete a server session before connectivity is confirmed', async () => {
    const deleteRequestCount = jest.mocked(sessionsApi.deleteSession).mock.calls.length;
    useNetworkStore.setState({ status: 'unknown' });
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().deleteSession('server-1')).resolves.toBe('busy');
    expect(sessionsApi.deleteSession).toHaveBeenCalledTimes(deleteRequestCount);
  });

  it('keeps the latest session detail when requests resolve out of order', async () => {
    const sessionA = deferred<{ session_id: string; title: string; messages: [] }>();
    const sessionB = deferred<{ session_id: string; title: string; messages: [{ id: string; role: string; content: string; created_at: string }] }>();
    jest.spyOn(sessionsApi, 'getSessionDetail').mockImplementation((sessionId) => (
      sessionId === 'session-a' ? sessionA.promise : sessionB.promise
    ));

    const openingA = useChatStore.getState().openSession('session-a');
    const openingB = useChatStore.getState().openSession('session-b');
    sessionB.resolve({
      session_id: 'session-b',
      title: '最新会话',
      messages: [{ id: 'message-b', role: 'assistant', content: 'B', created_at: '2026-07-16T10:00:00+08:00' }],
    });
    await expect(openingB).resolves.toBe(true);
    sessionA.resolve({ session_id: 'session-a', title: '旧会话', messages: [] });
    await expect(openingA).resolves.toBe(false);

    expect(useChatStore.getState().activeSessionId).toBe('session-b');
    expect(useChatStore.getState().messagesBySessionId).toEqual({
      'session-b': [{ id: 'message-b', role: 'assistant', content: 'B', created_at: '2026-07-16T10:00:00+08:00' }],
    });
  });

  it('ignores a stale open failure after the latest session has loaded', async () => {
    const sessionA = deferred<{ session_id: string; title: string; messages: [] }>();
    const sessionB = deferred<{ session_id: string; title: string; messages: [] }>();
    jest.spyOn(sessionsApi, 'getSessionDetail').mockImplementation((sessionId) => (
      sessionId === 'session-a' ? sessionA.promise : sessionB.promise
    ));

    const openingA = useChatStore.getState().openSession('session-a');
    const openingB = useChatStore.getState().openSession('session-b');
    sessionB.resolve({ session_id: 'session-b', title: '最新会话', messages: [] });
    await expect(openingB).resolves.toBe(true);
    sessionA.reject(new Error('旧请求失败'));
    await expect(openingA).resolves.toBe(false);

    expect(useChatStore.getState().activeSessionId).toBe('session-b');
    expect(useChatStore.getState().messagesBySessionId).toEqual({ 'session-b': [] });
  });

  it('does not let a delayed history load replace a newly created pending session', async () => {
    const history = deferred<{ session_id: string; title: string; messages: [] }>();
    jest.spyOn(sessionsApi, 'getSessionDetail').mockReturnValue(history.promise);

    const opening = useChatStore.getState().openSession('server-1');
    const pendingId = useChatStore.getState().newSession();
    history.resolve({ session_id: 'server-1', title: '历史会话', messages: [] });

    await expect(opening).resolves.toBe(false);
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ pending: true, session_id: pendingId })]);
  });

  it('ignores a delayed history load after reset', async () => {
    const history = deferred<{ session_id: string; title: string; messages: [] }>();
    jest.spyOn(sessionsApi, 'getSessionDetail').mockReturnValue(history.promise);

    const opening = useChatStore.getState().openSession('server-1');
    useChatStore.getState().reset();
    history.resolve({ session_id: 'server-1', title: '历史会话', messages: [] });

    await expect(opening).resolves.toBe(false);
    expect(useChatStore.getState()).toMatchObject({ activeSessionId: null, messagesBySessionId: {}, sessions: [] });
  });

  it('does not create another pending session when the active pending session is empty', () => {
    const firstPendingId = useChatStore.getState().newSession();
    const secondPendingId = useChatStore.getState().newSession();

    expect(secondPendingId).toBe(firstPendingId);
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ pending: true, session_id: firstPendingId })]);
    expect(useChatStore.getState().messagesBySessionId).toEqual({ [firstPendingId]: [] });
  });

  it('does not create a pending session after a delayed delete when the user starts another session', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    const deleting = useChatStore.getState().deleteSession('server-1');
    const pendingId = useChatStore.getState().newSession();
    deletion.resolve();

    await expect(deleting).resolves.toBe('deleted');
    expect(useChatStore.getState().activeSessionId).toBe(pendingId);
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ pending: true, session_id: pendingId })]);
  });

  it('does not restore a deleted session from an older list request', async () => {
    const deletion = deferred<void>();
    const list = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'listSessions').mockReturnValue(list.promise);
    useChatStore.setState({
      activeSessionId: 'server-2',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });

    const loading = useChatStore.getState().loadSessions();
    const deleting = useChatStore.getState().deleteSession('server-1');
    deletion.resolve();
    await expect(deleting).resolves.toBe('deleted');
    list.resolve([
      { session_id: 'server-1', title: '已删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    await loading;

    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual(['server-2']);
  });

  it('does not reactivate a deleted session from an older detail request', async () => {
    const deletion = deferred<void>();
    const detail = deferred<{ session_id: string; title: string; messages: [] }>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockReturnValue(detail.promise);
    useChatStore.setState({
      activeSessionId: 'server-2',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });

    const opening = useChatStore.getState().openSession('server-1');
    const deleting = useChatStore.getState().deleteSession('server-1');
    deletion.resolve();
    await expect(deleting).resolves.toBe('deleted');
    detail.resolve({ session_id: 'server-1', title: '已删除会话', messages: [] });

    await expect(opening).resolves.toBe(false);
    expect(useChatStore.getState().activeSessionId).not.toBe('server-1');
    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual(['server-2']);
  });

  it('keeps the newest list when concurrent refreshes resolve out of order', async () => {
    const firstList = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    const secondList = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    jest.spyOn(sessionsApi, 'listSessions')
      .mockReturnValueOnce(firstList.promise)
      .mockReturnValueOnce(secondList.promise);

    const firstLoading = useChatStore.getState().loadSessions();
    const secondLoading = useChatStore.getState().loadSessions();
    secondList.resolve([{ session_id: 'server-new', title: '新列表', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }]);
    await secondLoading;
    firstList.resolve([{ session_id: 'server-old', title: '旧列表', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' }]);
    await firstLoading;

    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual(['server-new']);
  });

  it('does not request a detail for a session while it is deleting', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({ session_id: 'server-1', title: '待删除会话', messages: [] });
    useChatStore.setState({
      activeSessionId: 'server-2',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });

    const deleting = useChatStore.getState().deleteSession('server-1');
    const detailRequestCount = (sessionsApi.getSessionDetail as jest.Mock).mock.calls.length;

    await expect(useChatStore.getState().openSession('server-1')).resolves.toBe(false);
    expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(detailRequestCount);
    deletion.resolve();
    await expect(deleting).resolves.toBe('deleted');
  });

  it('does not restore a deleting session from a list response after deletion succeeds', async () => {
    const deletion = deferred<void>();
    const list = deferred<Array<{ session_id: string; title: string; created_at: string; updated_at: string }>>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'listSessions').mockReturnValue(list.promise);
    useChatStore.setState({
      activeSessionId: 'server-2',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });

    const deleting = useChatStore.getState().deleteSession('server-1');
    const loading = useChatStore.getState().loadSessions();
    deletion.resolve();
    await expect(deleting).resolves.toBe('deleted');
    list.resolve([
      { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      { session_id: 'server-2', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    await loading;

    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual(['server-2']);
  });

  it('clears deleting state and preserves the session when deletion fails', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    const deleting = useChatStore.getState().deleteSession('server-1');
    expect(useChatStore.getState().deletingSessionId).toBe('server-1');
    deletion.reject(new Error('网络异常'));

    await expect(deleting).rejects.toThrow('网络异常');

    expect(useChatStore.getState().deletingSessionId).toBeNull();
    expect(useChatStore.getState().activeSessionId).toBe('server-1');
    expect(useChatStore.getState().sessions.map((session) => session.session_id)).toEqual(['server-1']);
  });

  it('blocks history opens during deletion and permits them after completion', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'getSessionDetail').mockResolvedValue({ session_id: 'server-2', title: '其他会话', messages: [] });
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '待删除会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '其他会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });

    const deleting = useChatStore.getState().deleteSession('server-1');
    const detailRequestCount = (sessionsApi.getSessionDetail as jest.Mock).mock.calls.length;
    await expect(useChatStore.getState().openSession('server-2')).resolves.toBe(false);
    expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(detailRequestCount);
    deletion.resolve();

    await expect(deleting).resolves.toBe('deleted-active');
    expect(useChatStore.getState().activeSessionId).toMatch(/^pending-/);
    expect(useChatStore.getState().sessions).toEqual([
      expect.objectContaining({ pending: true }),
      expect.objectContaining({ session_id: 'server-2' }),
    ]);
    expect(useChatStore.getState().sessions.find((session) => session.session_id === 'server-1')).toBeUndefined();

    await expect(useChatStore.getState().openSession('server-2')).resolves.toBe(true);
    expect(useChatStore.getState().activeSessionId).toBe('server-2');
  });

  it('does not let a reset-stale successful delete change a newer deletion', async () => {
    const deletionA = deferred<void>();
    const deletionB = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockImplementation((sessionId) => (
      sessionId === 'session-a' ? deletionA.promise : deletionB.promise
    ));
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [] },
      sessions: [{ session_id: 'session-a', title: 'A 会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    const staleDelete = useChatStore.getState().deleteSession('session-a');
    useChatStore.getState().reset();
    useChatStore.setState({
      activeSessionId: 'session-b',
      messagesBySessionId: { 'session-b': [] },
      sessions: [{ session_id: 'session-b', title: 'B 会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    const currentDelete = useChatStore.getState().deleteSession('session-b');
    deletionA.resolve();

    await expect(staleDelete).resolves.toBe('stale');
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: 'session-b',
      deletingSessionId: 'session-b',
      messagesBySessionId: { 'session-b': [] },
      sessions: [expect.objectContaining({ session_id: 'session-b' })],
    });

    deletionB.resolve();
    await expect(currentDelete).resolves.toBe('deleted-active');
  });

  it('does not let a reset-stale failed delete clear or reject a newer deletion', async () => {
    const deletionA = deferred<void>();
    const deletionB = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockImplementation((sessionId) => (
      sessionId === 'session-a' ? deletionA.promise : deletionB.promise
    ));
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [] },
      sessions: [{ session_id: 'session-a', title: 'A 会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    const staleDelete = useChatStore.getState().deleteSession('session-a');
    useChatStore.getState().reset();
    useChatStore.setState({
      activeSessionId: 'session-b',
      messagesBySessionId: { 'session-b': [] },
      sessions: [{ session_id: 'session-b', title: 'B 会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    const currentDelete = useChatStore.getState().deleteSession('session-b');
    deletionA.reject(new Error('A 删除失败'));

    await expect(staleDelete).resolves.toBe('stale');
    expect(useChatStore.getState()).toMatchObject({
      activeSessionId: 'session-b',
      deletingSessionId: 'session-b',
      messagesBySessionId: { 'session-b': [] },
      sessions: [expect.objectContaining({ session_id: 'session-b' })],
    });

    deletionB.resolve();
    await expect(currentDelete).resolves.toBe('deleted-active');
  });

  it('distinguishes a missing session from a busy deletion', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    useChatStore.setState({
      activeSessionId: 'session-a',
      messagesBySessionId: { 'session-a': [] },
      sessions: [{ session_id: 'session-a', title: 'A 会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    await expect(useChatStore.getState().deleteSession('missing')).resolves.toBe('not-found');
    const currentDelete = useChatStore.getState().deleteSession('session-a');
    await expect(useChatStore.getState().deleteSession('session-b')).resolves.toBe('busy');
    deletion.resolve();
    await expect(currentDelete).resolves.toBe('deleted-active');
  });
});
