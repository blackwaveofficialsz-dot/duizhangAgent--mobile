import { create } from 'zustand';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { runCurrentCacheOperation } from '@/services/cache/offlineCache';
import { isDeviceOffline, isDeviceOnline } from '@/services/network/networkStore';
import * as sessionsApi from '@/services/api/sessions';
import { normalizeMessageAgentResponse } from '@/types/agentResponse';
import { finishAgentActivity, mergeAgentActivityStep, parseAgentActivity } from '@/types/agentActivity';
import type {
  AgentActivity,
  AgentActivityStatus,
  AgentActivityStep,
  AgentResponsePayload,
  ChatSession,
  ConnectorQueryMetadata,
  InterruptedRecoveryContext,
  MessageItem,
  SessionDetailResponse,
} from '@/types/chat';

export type DeleteSessionResult = 'deleted' | 'deleted-active' | 'busy' | 'not-found' | 'stale';
export type PendingRecoveryResult =
  | { status: 'recovered'; detail: SessionDetailResponse }
  | { status: 'not-found' }
  | { status: 'stale' };

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  deletingSessionId: string | null;
  isOffline: boolean;
  lastSyncedAt: number | null;
  messagesBySessionId: Record<string, MessageItem[]>;
  reset: () => void;
  loadSessions: (signal?: AbortSignal) => Promise<void>;
  openSession: (sessionId: string, signal?: AbortSignal) => Promise<boolean>;
  newSession: () => string;
  replacePendingSessionId: (pendingSessionId: string, sessionId: string) => void;
  addMessage: (sessionId: string, message: MessageItem) => void;
  appendMessageContent: (sessionId: string, messageId: string, content: string) => void;
  mergeMessageActivity: (sessionId: string, messageId: string, step: AgentActivityStep) => void;
  setMessageActivity: (sessionId: string, messageId: string, activity: AgentActivity) => void;
  finishMessageActivity: (sessionId: string, messageId: string, status: Exclude<AgentActivityStatus, 'running'>, force?: boolean) => void;
  setMessageTaskId: (sessionId: string, messageId: string, taskId: string) => void;
  finishToolCalls: (sessionId: string, messageIds: string[], status: 'completed' | 'failed') => void;
  finishMessage: (sessionId: string, messageId: string, interrupted: boolean) => void;
  setMessageConnectorQuery: (sessionId: string, messageId: string, connectorQuery: ConnectorQueryMetadata) => void;
  setMessageAgentResponse: (sessionId: string, messageId: string, agentResponse: AgentResponsePayload) => void;
  preparePendingRequest: (sessionId: string, messageId: string, signal?: AbortSignal) => Promise<boolean>;
  markPendingRequestSent: (sessionId: string, messageId: string) => boolean;
  restartMessage: (sessionId: string, messageId: string) => void;
  recoverPendingSession: (
    pendingSessionId: string,
    recovery: InterruptedRecoveryContext,
    signal?: AbortSignal,
  ) => Promise<PendingRecoveryResult>;
  deleteSession: (sessionId: string) => Promise<DeleteSessionResult>;
};

let pendingSessionCount = 0;
let actionGeneration = 0;
let listRequest = 0;
let deleteRequest = 0;

function mergeMessageMetadata(metadata: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}), ...extra };
}

function normalizeHistoryMessage(message: MessageItem): MessageItem {
  const normalized = normalizeMessageAgentResponse(message);
  const metadata = normalized.metadata;
  const metadataActivity = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? parseAgentActivity((metadata as Record<string, unknown>).agent_activity)
    : null;
  const withoutRawActivity = removeRawActivityMetadata(normalized);
  if (withoutRawActivity.role !== 'assistant') return withoutRawActivity;
  const activity = metadataActivity ?? parseAgentActivity(withoutRawActivity.activity);
  if (activity) return { ...withoutRawActivity, activity };
  if (withoutRawActivity.activity === undefined) return withoutRawActivity;
  const { activity: _activity, ...withoutActivity } = withoutRawActivity;
  return withoutActivity;
}

function removeRawActivityMetadata(message: MessageItem): MessageItem {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('agent_activity' in metadata)) return message;
  const { agent_activity: _activity, ...safeMetadata } = metadata as Record<string, unknown>;
  if (Object.keys(safeMetadata).length) return { ...message, metadata: safeMetadata };
  const { metadata: _metadata, ...withoutMetadata } = message;
  return withoutMetadata;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  deletingSessionId: null,
  isOffline: false,
  lastSyncedAt: null,
  messagesBySessionId: {},
  reset: () => {
    actionGeneration += 1;
    listRequest += 1;
    deleteRequest += 1;
    set({ activeSessionId: null, deletingSessionId: null, isOffline: false, lastSyncedAt: null, messagesBySessionId: {}, sessions: [] });
  },
  loadSessions: async (signal) => {
    const generation = actionGeneration;
    const request = ++listRequest;
    try {
      if (isDeviceOffline()) throw new Error(NETWORK_ERROR_MESSAGE);
      const sessions = await sessionsApi.listSessions(signal);
      if (signal?.aborted || generation !== actionGeneration || request !== listRequest || get().deletingSessionId) return;
      set((state) => ({ isOffline: false, lastSyncedAt: Date.now(), sessions: [...state.sessions.filter((session) => session.pending), ...sessions] }));
      saveCachedSessions(sessions);
    } catch (error) {
      if (signal?.aborted || generation !== actionGeneration || request !== listRequest || get().deletingSessionId) return;
      const cached = await readCachedSessions(error);
      if (!cached) throw error;
      if (signal?.aborted || generation !== actionGeneration || request !== listRequest || get().deletingSessionId) return;
      set((state) => ({
        isOffline: true,
        lastSyncedAt: cached.lastSyncedAt,
        sessions: [...state.sessions.filter((session) => session.pending), ...cached.sessions],
      }));
    }
  },
  openSession: async (sessionId, signal) => {
    if (get().deletingSessionId) return false;
    const generation = ++actionGeneration;
    try {
      let fromCache = isDeviceOffline();
      let detail: SessionDetailResponse | null;
      if (fromCache) {
        detail = await readCachedSessionDetail(sessionId);
      } else {
        try {
          detail = await sessionsApi.getSessionDetail(sessionId, signal);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE) throw error;
          fromCache = true;
          detail = await readCachedSessionDetail(sessionId);
          if (!detail) throw error;
        }
      }
      if (!detail) return false;
      if (signal?.aborted || generation !== actionGeneration) return false;
      const normalizedDetail = { ...detail, messages: detail.messages.map(normalizeHistoryMessage) };
      set((state) => ({
        activeSessionId: normalizedDetail.session_id,
        isOffline: fromCache,
        lastSyncedAt: fromCache ? state.lastSyncedAt : Date.now(),
        messagesBySessionId: { ...state.messagesBySessionId, [normalizedDetail.session_id]: normalizedDetail.messages },
        sessions: state.sessions.map((session) => (
          session.session_id === normalizedDetail.session_id ? { ...session, title: normalizedDetail.title } : session
        )),
      }));
      if (!fromCache) saveCachedSessionDetail(normalizedDetail);
      return true;
    } catch (error) {
      if (signal?.aborted || generation !== actionGeneration) return false;
      throw error;
    }
  },
  newSession: () => {
    actionGeneration += 1;
    const state = get();
    const activeSession = state.sessions.find((session) => session.session_id === state.activeSessionId);
    if (activeSession?.pending && state.messagesBySessionId[activeSession.session_id]?.length === 0) {
      return activeSession.session_id;
    }
    const sessionId = `pending-${Date.now()}-${++pendingSessionCount}`;
    const now = new Date().toISOString();
    set((current) => {
      const pendingIds = new Set(current.sessions.filter((session) => session.pending).map((session) => session.session_id));
      const messagesBySessionId = Object.fromEntries(
        Object.entries(current.messagesBySessionId).filter(([id]) => !pendingIds.has(id)),
      );
      return {
        activeSessionId: sessionId,
        messagesBySessionId: { ...messagesBySessionId, [sessionId]: [] },
        sessions: [{ session_id: sessionId, title: '新对话', created_at: now, updated_at: now, pending: true }, ...current.sessions.filter((session) => !session.pending)],
      };
    });
    return sessionId;
  },
  replacePendingSessionId: (pendingSessionId, sessionId) => {
    actionGeneration += 1;
    const pending = get().sessions.find((item) => item.session_id === pendingSessionId && item.pending);
    if (!pending || pendingSessionId === sessionId) return;
    set((state) => {
      const target = state.sessions.find((item) => item.session_id === sessionId);
      const replacement = target ?? { ...pending, session_id: sessionId, pending: false };
      const { [pendingSessionId]: messages = [], ...withoutPending } = state.messagesBySessionId;
      const { [sessionId]: _targetMessages, ...messagesBySessionId } = withoutPending;
      return {
        activeSessionId: state.activeSessionId === pendingSessionId ? sessionId : state.activeSessionId,
        messagesBySessionId: { ...messagesBySessionId, [sessionId]: messages },
        sessions: state.sessions.flatMap((item) => {
          if (item.session_id === pendingSessionId) return [replacement];
          return item.session_id === sessionId ? [] : [item];
        }),
      };
    });
  },
  addMessage: (sessionId, message) => set((state) => ({
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: [...(state.messagesBySessionId[sessionId] ?? []), message],
    },
  })),
  appendMessageContent: (sessionId, messageId, content) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    const messageIndex = messages?.findIndex((message) => message.id === messageId) ?? -1;
    if (!messages || messageIndex < 0) return state;
    const nextMessages = [...messages];
    nextMessages[messageIndex] = {
      ...messages[messageIndex],
      content: messages[messageIndex].content + content,
    };
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: nextMessages,
      },
    };
  }),
  mergeMessageActivity: (sessionId, messageId, step) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    const message = messages?.find((item) => item.id === messageId);
    if (!messages || message?.role !== 'assistant') return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((item) => (
          item.id === messageId ? { ...item, activity: mergeAgentActivityStep(item.activity, step) } : item
        )),
      },
    };
  }),
  setMessageActivity: (sessionId, messageId, activity) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    const message = messages?.find((item) => item.id === messageId);
    if (!messages || message?.role !== 'assistant') return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((item) => (
          item.id === messageId ? { ...item, activity } : item
        )),
      },
    };
  }),
  finishMessageActivity: (sessionId, messageId, status, force = false) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    const message = messages?.find((item) => item.id === messageId);
    if (!messages || message?.role !== 'assistant') return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((item) => (
          item.id === messageId ? { ...item, activity: finishAgentActivity(item.activity, status, force) } : item
        )),
      },
    };
  }),
  setMessageTaskId: (sessionId, messageId, taskId) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages?.some((message) => message.id === messageId)) return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          message.id === messageId ? { ...message, task_id: taskId } : message
        )),
      },
    };
  }),
  finishToolCalls: (sessionId, messageIds, status) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages || !messageIds.length) return state;
    const ids = new Set(messageIds);
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          ids.has(message.id) && message.toolCall?.status === 'running'
            ? { ...message, toolCall: { ...message.toolCall, status } }
            : message
        )),
      },
    };
  }),
  finishMessage: (sessionId, messageId, interrupted) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages?.some((message) => message.id === messageId)) return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          message.id === messageId ? { ...message, interrupted, streaming: false } : message
        )),
      },
    };
  }),
  setMessageConnectorQuery: (sessionId, messageId, connectorQuery) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages?.some((message) => message.id === messageId)) return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          message.id === messageId
            ? { ...message, metadata: mergeMessageMetadata(message.metadata, { connector_query: connectorQuery }) }
            : message
        )),
      },
    };
  }),
  setMessageAgentResponse: (sessionId, messageId, agentResponse) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages?.some((message) => message.id === messageId)) return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          message.id === messageId
            ? {
              ...message,
              agentResponse,
            }
            : message
        )),
      },
    };
  }),
  preparePendingRequest: async (sessionId, messageId, signal) => {
    const generation = actionGeneration;
    const sessions = await sessionsApi.listSessions(signal);
    if (
      signal?.aborted
      || generation !== actionGeneration
      || get().activeSessionId !== sessionId
      || !get().sessions.some((session) => session.session_id === sessionId && session.pending)
    ) return false;

    let prepared = false;
    set((state) => {
      const messages = state.messagesBySessionId[sessionId];
      if (!messages?.some((message) => message.id === messageId && message.recovery)) return state;
      prepared = true;
      return {
        messagesBySessionId: {
          ...state.messagesBySessionId,
          [sessionId]: messages.map((message) => (
            message.id === messageId && message.recovery
              ? {
                ...message,
                recovery: {
                  ...message.recovery,
                  knownSessionIds: sessions.map((session) => session.session_id),
                  requestSent: false,
                  snapshotGeneration: generation,
                  snapshotReady: true,
                },
              }
              : message
          )),
        },
      };
    });
    return prepared;
  },
  markPendingRequestSent: (sessionId, messageId) => {
    const state = get();
    const message = state.messagesBySessionId[sessionId]?.find((item) => item.id === messageId);
    if (
      state.activeSessionId !== sessionId
      || !state.sessions.some((session) => session.session_id === sessionId && session.pending)
      || !message?.recovery?.snapshotReady
      || message.recovery.snapshotGeneration !== actionGeneration
    ) return false;

    set((current) => ({
      messagesBySessionId: {
        ...current.messagesBySessionId,
        [sessionId]: current.messagesBySessionId[sessionId].map((item) => (
          item.id === messageId && item.recovery
            ? { ...item, recovery: { ...item.recovery, requestSent: true } }
            : item
        )),
      },
    }));
    return true;
  },
  restartMessage: (sessionId, messageId) => set((state) => {
    const messages = state.messagesBySessionId[sessionId];
    if (!messages?.some((message) => message.id === messageId)) return state;
    return {
      messagesBySessionId: {
        ...state.messagesBySessionId,
        [sessionId]: messages.map((message) => (
          message.id === messageId ? { ...message, interrupted: false, streaming: true } : message
        )),
      },
    };
  }),
  recoverPendingSession: async (pendingSessionId, recovery, signal) => {
    if (!recovery.snapshotReady || !recovery.requestSent) return { status: 'not-found' };
    const generation = actionGeneration;
    const request = ++listRequest;
    const isCurrent = () => (
      !signal?.aborted
      && generation === actionGeneration
      && request === listRequest
      && get().activeSessionId === pendingSessionId
      && get().sessions.some((session) => session.session_id === pendingSessionId && session.pending)
    );
    if (!isCurrent()) return { status: 'stale' };

    const sessions = await sessionsApi.listSessions(signal);
    if (!isCurrent()) return { status: 'stale' };
    const knownSessionIds = new Set(recovery.knownSessionIds);
    const candidates = sessions.filter((session) => !knownSessionIds.has(session.session_id));
    const matches: SessionDetailResponse[] = [];

    for (const candidate of candidates) {
      const detail = await sessionsApi.getSessionDetail(candidate.session_id, signal);
      if (!isCurrent()) return { status: 'stale' };
      if (matchesRecovery(detail, recovery.userText)) matches.push(detail);
    }

    if (!isCurrent()) return { status: 'stale' };
    if (matches.length !== 1) {
      set((state) => ({ sessions: mergeLoadedSessions(state.sessions, sessions) }));
      return { status: 'not-found' };
    }

    if (!isCurrent()) return { status: 'stale' };
    const detail = matches[0];
    const normalizedDetail = { ...detail, messages: detail.messages.map(normalizeHistoryMessage) };
    actionGeneration += 1;
    set((state) => {
      const { [pendingSessionId]: _pendingMessages, ...withoutPending } = state.messagesBySessionId;
      const { [normalizedDetail.session_id]: _targetMessages, ...messagesBySessionId } = withoutPending;
      return {
        activeSessionId: normalizedDetail.session_id,
        messagesBySessionId: { ...messagesBySessionId, [normalizedDetail.session_id]: normalizedDetail.messages },
        sessions: uniqueSessions(sessions),
      };
    });
    saveCachedSessionDetail(normalizedDetail);
    return { status: 'recovered', detail: normalizedDetail };
  },
  deleteSession: async (sessionId) => {
    if (get().deletingSessionId || !isDeviceOnline()) return 'busy';
    const target = get().sessions.find((item) => item.session_id === sessionId);
    if (!target) return 'not-found';
    const request = ++deleteRequest;
    actionGeneration += 1;
    set({ deletingSessionId: sessionId });
    try {
      if (!target.pending) await sessionsApi.deleteSession(sessionId);
      if (request !== deleteRequest) return 'stale';
      listRequest += 1;
      set((state) => {
        const { [sessionId]: _messages, ...messagesBySessionId } = state.messagesBySessionId;
        return {
          deletingSessionId: null,
          messagesBySessionId,
          sessions: state.sessions.filter((item) => item.session_id !== sessionId),
        };
      });
      if (get().activeSessionId === sessionId) {
        get().newSession();
        return 'deleted-active';
      }
      return 'deleted';
    } catch (error) {
      if (request !== deleteRequest) return 'stale';
      set((state) => ({ deletingSessionId: state.deletingSessionId === sessionId ? null : state.deletingSessionId }));
      throw error;
    }
  },
}));

async function readCachedSessions(error: unknown): Promise<{ lastSyncedAt: number | null; sessions: ChatSession[] } | null> {
  if (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE) return null;
  try {
    return await runCurrentCacheOperation(async (repositories, identity) => {
      const now = Date.now();
      const sessions = await repositories.sessions.read(identity, now);
      if (!sessions.length) return null;
      return { lastSyncedAt: await repositories.sessions.lastSyncedAt(identity, now), sessions };
    });
  } catch {
    return null;
  }
}

function saveCachedSessions(sessions: ChatSession[]): void {
  void runCurrentCacheOperation((repositories, identity) => (
    repositories.sessions.save(identity, sessions, Date.now())
  )).catch(() => {});
}

async function readCachedSessionDetail(sessionId: string): Promise<SessionDetailResponse | null> {
  try {
    return await runCurrentCacheOperation((repositories, identity) => (
      repositories.sessions.readDetail(identity, sessionId, Date.now())
    ));
  } catch {
    return null;
  }
}

function saveCachedSessionDetail(detail: SessionDetailResponse): void {
  void runCurrentCacheOperation((repositories, identity) => (
    repositories.sessions.saveDetail(identity, detail, Date.now())
  )).catch(() => {});
}

function mergeLoadedSessions(current: ChatSession[], loaded: ChatSession[]): ChatSession[] {
  return uniqueSessions([...current.filter((session) => session.pending), ...loaded]);
}

function uniqueSessions(sessions: ChatSession[]): ChatSession[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (seen.has(session.session_id)) return false;
    seen.add(session.session_id);
    return true;
  });
}

function matchesRecovery(detail: SessionDetailResponse, userText: string): boolean {
  const userMessages = detail.messages.filter((message) => message.role === 'user');
  return userMessages[0]?.content === userText
    || userMessages[userMessages.length - 1]?.content === userText;
}
