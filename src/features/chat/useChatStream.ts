import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/components/feedback/AppToast';
import { getQueryEvidence, streamChat } from '@/services/api/chat';
import { isDeviceOnline } from '@/services/network/networkStore';
import { parseSse } from '@/services/sse/parseSse';
import { isClarificationAction, parseAgentResponsePayload, type AgentResponseAction, type AgentResponsePayload, type ChatInteraction } from '@/types/agentResponse';
import { parseAgentActivity, parsePublicAgentActivityStep } from '@/types/agentActivity';
import { useTaskStore } from '@/features/tasks/taskStore';
import type { AgentRunPublicEvent } from '@/types/agentRun';
import type { ApprovalRequest, MessageItem } from '@/types/chat';
import { TASK_RUN_STATUS_LABELS } from '@/types/task';
import { useChatStore } from './chatStore';
import { useAgentRunEvents } from './useAgentRunEvents';

let localMessageCount = 0;
let nextEvidenceGeneration = 0;
const evidenceGenerations = new Map<string, number>();
const TOKEN_BUFFER_LIMIT = 4096;
const TOKEN_FLUSH_MS = 16;

export function useChatStream() {
  const durableEvents = useAgentRunEvents();
  const abortRef = useRef<AbortController | null>(null);
  const streamTargetRef = useRef<{ controller: AbortController; sessionId: string; messageId: string } | null>(null);
  const nextDurableGenerationRef = useRef(0);
  const durableRunsRef = useRef(new Map<string, { generation: number; sessionId: string; messageId: string }>());
  const streamGenerationRef = useRef(0);
  const streamSessionRef = useRef<string | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  const retryGenerationRef = useRef(0);
  const retryPendingRef = useRef(false);
  const retrySessionRef = useRef<string | null>(null);
  const retryingRef = useRef(false);
  const approvalRef = useRef<ApprovalRequest | null>(null);
  const approvalSentRef = useRef(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const isPendingBlocked = useChatStore(hasUnresolvedPendingRequest);

  useEffect(() => {
    const streamController = abortRef.current;
    if (streamController && streamSessionRef.current !== activeSessionId) {
      abortRef.current = null;
      streamTargetRef.current = null;
      streamSessionRef.current = null;
      streamGenerationRef.current += 1;
      streamController.abort();
      setStreaming(false);
    }
    if ([...durableRunsRef.current.values()].some((run) => run.sessionId !== activeSessionId)) {
      durableEvents.cancel();
      durableRunsRef.current.clear();
    }
    const retryController = retryAbortRef.current;
    if (retryingRef.current && retrySessionRef.current !== activeSessionId) {
      const state = useChatStore.getState();
      const pendingWasResolved = retryPendingRef.current
        && !state.sessions.some((session) => session.session_id === retrySessionRef.current)
        && Boolean(activeSessionId)
        && state.sessions.some((session) => session.session_id === activeSessionId && !session.pending);
      if (pendingWasResolved) {
        retrySessionRef.current = activeSessionId;
      } else {
        retryAbortRef.current = null;
        retryPendingRef.current = false;
        retrySessionRef.current = null;
        retryGenerationRef.current += 1;
        retryingRef.current = false;
        retryController?.abort();
        setIsRetrying(false);
      }
    }
  }, [activeSessionId, durableEvents.cancel]);

  useEffect(() => {
    if (approvalRef.current?.sourceSessionId === activeSessionId) return;
    approvalRef.current = null;
    approvalSentRef.current = false;
    setPendingApproval(null);
  }, [activeSessionId]);

  const runStream = useCallback(async (
    text: string,
    localSessionId: string,
    assistantMessageId: string,
    pending: boolean,
    interaction?: ChatInteraction,
  ): Promise<void> => {
    const controller = new AbortController();
    const streamGeneration = ++streamGenerationRef.current;
    let resolvedSessionId = localSessionId;
    const evidenceGeneration = ++nextEvidenceGeneration;
    evidenceGenerations.set(resolvedSessionId, evidenceGeneration);
    let completed = false;
    let activityEndStatus: 'completed' | 'partial' | 'empty' | 'unavailable' | 'failed' | 'interrupted' = 'interrupted';
    let businessTerminalStatus: 'completed' | 'partial' | 'empty' | 'unavailable' | 'failed' | null = null;
    let backgroundRun = false;
    let backgroundRunId: string | null = null;
    let publicActivity = false;
    let turnCategory = '';
    let loadEvidence = false;
    const toolMessageIds: string[] = [];
    let tokenChunks: string[] = [];
    let tokenLength = 0;
    let tokenTimer: ReturnType<typeof setTimeout> | null = null;
    const ownsStream = () => (
      abortRef.current === controller
      && streamGenerationRef.current === streamGeneration
    );
    const canConsume = () => ownsStream() && !controller.signal.aborted;
    const flushTokens = () => {
      if (tokenTimer) clearTimeout(tokenTimer);
      tokenTimer = null;
      if (!tokenLength) return;
      const content = tokenChunks.join('');
      tokenChunks = [];
      tokenLength = 0;
      useChatStore.getState().appendMessageContent(resolvedSessionId, assistantMessageId, content);
    };
    const scheduleTokenFlush = () => {
      if (tokenTimer || !tokenLength) return;
      tokenTimer = setTimeout(() => {
        tokenTimer = null;
        flushTokens();
      }, TOKEN_FLUSH_MS);
    };
    const bufferToken = (content: string) => {
      let offset = 0;
      while (offset < content.length) {
        const take = Math.min(TOKEN_BUFFER_LIMIT - tokenLength, content.length - offset);
        tokenChunks.push(content.slice(offset, offset + take));
        tokenLength += take;
        offset += take;
        if (tokenLength === TOKEN_BUFFER_LIMIT) flushTokens();
      }
      scheduleTokenFlush();
    };

    abortRef.current = controller;
    streamTargetRef.current = { controller, sessionId: localSessionId, messageId: assistantMessageId };
    streamSessionRef.current = localSessionId;
    setStreaming(true);
    useChatStore.getState().restartMessage(localSessionId, assistantMessageId);

    try {
      if (pending) {
        const prepared = await waitForAbort(
          useChatStore.getState().preparePendingRequest(localSessionId, assistantMessageId, controller.signal),
          controller.signal,
        );
        if (!prepared || controller.signal.aborted) return;
        if (!useChatStore.getState().markPendingRequestSent(localSessionId, assistantMessageId)) return;
      }

      const response = interaction
        ? await streamChat(text, pending ? '' : localSessionId, controller.signal, interaction)
        : await streamChat(text, pending ? '' : localSessionId, controller.signal);
      if (!response.body) throw new Error('服务端未返回可读消息流');

      for await (const event of parseSse(response.body)) {
        if (!canConsume()) break;
        if (event.type === 'meta') {
          turnCategory = event.category ?? '';
          if (event.sessionId && event.sessionId !== resolvedSessionId) {
            clearEvidenceGeneration(resolvedSessionId, evidenceGeneration);
            evidenceGenerations.set(event.sessionId, evidenceGeneration);
            streamSessionRef.current = event.sessionId;
            useChatStore.getState().replacePendingSessionId(resolvedSessionId, event.sessionId);
            resolvedSessionId = event.sessionId;
            if (streamTargetRef.current?.controller === controller) streamTargetRef.current.sessionId = event.sessionId;
          }
          if ('agentResponse' in event) {
            const agentResponse = parseAgentResponsePayload(event.agentResponse);
            if (agentResponse) {
              useChatStore.getState().setMessageAgentResponse(resolvedSessionId, assistantMessageId, agentResponse);
              businessTerminalStatus = agentResponseActivityStatus(agentResponse.result_status);
            } else {
              businessTerminalStatus = 'failed';
            }
          }
          const agentActivity = parseAgentActivity(event.agentActivity);
          if (agentActivity) {
            publicActivity = true;
            useChatStore.getState().setMessageActivity(resolvedSessionId, assistantMessageId, agentActivity);
          }
          if (event.background && event.runId) {
            backgroundRun = true;
            const runId = event.runId;
            backgroundRunId = runId;
            const durableGeneration = ++nextDurableGenerationRef.current;
            const durableSessionId = resolvedSessionId;
            const pollingOwner = `research:${runId}`;
            useChatStore.getState().setMessageTaskId(durableSessionId, assistantMessageId, runId);
            durableEvents.start(runId, {
              onEvent: async (runEvent) => {
                if (durableRunsRef.current.get(runId)?.generation !== durableGeneration) return;
                applyAgentRunEvent(durableSessionId, assistantMessageId, runEvent);
                if ((runEvent.type === 'status' || runEvent.type === 'final' || runEvent.type === 'failed') && runEvent.status) {
                  await useTaskStore.getState().refresh();
                  if (durableRunsRef.current.get(runId)?.generation !== durableGeneration) return;
                  if (runEvent.status === 'queued' || runEvent.status === 'running' || runEvent.status === 'validating') {
                    useTaskStore.getState().startPolling(pollingOwner);
                  } else {
                    useTaskStore.getState().stopPolling(pollingOwner);
                  }
                }
              },
              onCleanup: (reason) => {
                if (durableRunsRef.current.get(runId)?.generation !== durableGeneration) return;
                useTaskStore.getState().stopPolling(pollingOwner);
                useChatStore.getState().finishMessage(
                  durableSessionId,
                  assistantMessageId,
                  reason !== 'terminal',
                );
                useChatStore.getState().finishMessageActivity(
                  durableSessionId,
                  assistantMessageId,
                  reason === 'terminal' ? 'completed' : 'interrupted',
                );
                durableRunsRef.current.delete(runId);
                void useTaskStore.getState().refresh();
              },
            });
            durableRunsRef.current.set(runId, {
              generation: durableGeneration,
              sessionId: durableSessionId,
              messageId: assistantMessageId,
            });
            useTaskStore.getState().startPolling(pollingOwner);
            void useTaskStore.getState().refresh();
          }
        } else if (event.type === 'text') {
          bufferToken(event.content);
        } else if (event.type === 'stage') {
          if (
            event.visibility === 'public'
            && event.step_id !== undefined
            && event.elapsed_ms !== undefined
            && event.sequence !== undefined
          ) {
            publicActivity = true;
            useChatStore.getState().mergeMessageActivity(resolvedSessionId, assistantMessageId, {
              step_id: event.step_id,
              label: event.label,
              ...(event.detail ? { detail: event.detail } : {}),
              status: event.status as 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
              elapsed_ms: event.elapsed_ms,
              sequence: event.sequence,
            });
          }
        } else if (event.type === 'error') {
          activityEndStatus = 'failed';
          useChatStore.getState().finishMessageActivity(
            resolvedSessionId,
            assistantMessageId,
            'failed',
            backgroundRunId !== null,
          );
          if (backgroundRunId) {
            backgroundRun = false;
            if (durableRunsRef.current.has(backgroundRunId)) durableEvents.cancel(backgroundRunId);
          }
          throw new Error(event.message);
        } else if (event.type === 'tool_call') {
          if (publicActivity) continue;
          const toolMessageId = createMessageId('tool_call');
          toolMessageIds.push(toolMessageId);
          useChatStore.getState().addMessage(resolvedSessionId, {
            id: toolMessageId,
            role: 'tool_call',
            content: '',
            created_at: new Date().toISOString(),
            toolCall: {
              name: typeof event.data.name === 'string' ? event.data.name : '工具调用',
              description: typeof event.data.description === 'string' ? event.data.description : '',
              status: toolStatus(event.data.status),
            },
          });
        } else if (event.type === 'approval_request') {
          const state = useChatStore.getState();
          const sourceSession = state.sessions.find((session) => session.session_id === resolvedSessionId);
          if (
            state.activeSessionId !== resolvedSessionId
            || !sourceSession
            || sourceSession.pending
          ) continue;
          const approval = {
            action: typeof event.data.action === 'string' ? event.data.action : '',
            description: typeof event.data.description === 'string' ? event.data.description : '',
            turnId: typeof event.data.turn_id === 'string' ? event.data.turn_id : '',
            sourceSessionId: resolvedSessionId,
          };
          approvalRef.current = approval;
          approvalSentRef.current = false;
          setPendingApproval(approval);
        } else if (event.type === 'done') {
          completed = true;
          activityEndStatus = businessTerminalStatus ?? 'completed';
        }
      }
      loadEvidence = !backgroundRun && completed && shouldLoadQueryEvidence(turnCategory);
    } catch (error) {
      if (ownsStream() && !isAbortError(error)) {
        showToast(error instanceof Error ? error.message : '回复中断，请稍后重试', 'error');
      }
    } finally {
      flushTokens();
      if (!backgroundRun) {
        useChatStore.getState().finishMessageActivity(resolvedSessionId, assistantMessageId, activityEndStatus);
        useChatStore.getState().finishMessage(resolvedSessionId, assistantMessageId, !completed);
      }
      useChatStore.getState().finishToolCalls(resolvedSessionId, toolMessageIds, completed ? 'completed' : 'failed');
      if (ownsStream()) {
        abortRef.current = null;
        streamSessionRef.current = null;
        streamTargetRef.current = null;
        setStreaming(false);
      }
      if (loadEvidence) loadQueryEvidence(
        resolvedSessionId,
        assistantMessageId,
        evidenceGeneration,
      );
      else clearEvidenceGeneration(resolvedSessionId, evidenceGeneration);
    }
  }, [durableEvents.cancel, durableEvents.start]);

  const sendMessage = useCallback(async (rawText: string, interaction?: ChatInteraction): Promise<void> => {
    const text = rawText.trim();
    if (!text || abortRef.current || retryingRef.current || !isDeviceOnline()) return;

    const store = useChatStore.getState();
    if (hasUnresolvedPendingRequest(store)) return;
    const localSessionId = store.activeSessionId ?? store.newSession();
    const pending = useChatStore.getState().sessions.some(
      (session) => session.session_id === localSessionId && session.pending,
    );
    const assistantMessageId = createMessageId('assistant');
    const createdAt = new Date().toISOString();

    useChatStore.getState().addMessage(localSessionId, {
      id: createMessageId('user'),
      role: 'user',
      content: text,
      created_at: createdAt,
    });
    useChatStore.getState().addMessage(localSessionId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      created_at: createdAt,
      interrupted: false,
      recovery: pending ? {
        knownSessionIds: [],
        requestSent: false,
        snapshotReady: false,
        startedAt: createdAt,
        userText: text,
      } : undefined,
      streaming: true,
    });
    await runStream(text, localSessionId, assistantMessageId, pending, interaction);
  }, [runStream]);

  const sendStructuredAction = useCallback(async (action: AgentResponseAction): Promise<void> => {
    if (!isClarificationAction(action)) return;
    await sendMessage(action.params.message, {
      kind: 'clarification_choice',
      source_turn_id: action.source_turn_id,
      candidate_id: action.params.candidate_id,
    });
  }, [sendMessage]);

  const stopGeneration = useCallback(() => {
    const streamController = abortRef.current;
    const streamTarget = streamTargetRef.current;
    if (streamController) {
      if (streamTarget?.controller === streamController) {
        useChatStore.getState().finishMessageActivity(streamTarget.sessionId, streamTarget.messageId, 'cancelled');
      }
      abortRef.current = null;
      streamSessionRef.current = null;
      streamTargetRef.current = null;
      streamGenerationRef.current += 1;
      streamController.abort();
      setStreaming(false);
    }
    if (durableRunsRef.current.size) {
      for (const run of durableRunsRef.current.values()) {
        useChatStore.getState().finishMessageActivity(run.sessionId, run.messageId, 'cancelled');
      }
      durableEvents.cancel();
      durableRunsRef.current.clear();
    }
    if (retryingRef.current) {
      retryAbortRef.current?.abort();
      retryAbortRef.current = null;
      retryPendingRef.current = false;
      retrySessionRef.current = null;
      retryGenerationRef.current += 1;
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }, [durableEvents.cancel]);

  const approvePending = useCallback(async (): Promise<void> => {
    const approval = approvalRef.current;
    if (!approval || approvalSentRef.current || abortRef.current || !isDeviceOnline()) return;
    if (useChatStore.getState().activeSessionId !== approval.sourceSessionId) {
      approvalRef.current = null;
      setPendingApproval(null);
      return;
    }
    approvalSentRef.current = true;
    approvalRef.current = null;
    setPendingApproval(null);
    await sendMessage(`同意执行: ${approval.action}`);
  }, [sendMessage]);

  const cancelPending = useCallback(() => {
    approvalRef.current = null;
    setPendingApproval(null);
  }, []);

  const retryInterruptedMessage = useCallback(async (): Promise<void> => {
    if (abortRef.current || retryingRef.current || !isDeviceOnline()) return;
    const state = useChatStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;

    const messages = state.messagesBySessionId[sessionId] ?? [];
    const interruptedIndex = messages.length - 1;
    const interruptedMessage = messages[interruptedIndex];
    if (interruptedMessage?.role !== 'assistant' || !interruptedMessage.interrupted) return;
    const userMessage = messages.slice(0, interruptedIndex).findLast((message) => message.role === 'user');
    if (!userMessage) return;
    if (durableRunsRef.current.size) {
      durableEvents.cancel();
      durableRunsRef.current.clear();
    }

    const retryGeneration = ++retryGenerationRef.current;
    const retryController = new AbortController();
    const retryIsCurrent = (targetSessionId: string) => (
      retryGeneration === retryGenerationRef.current
      && !retryController.signal.aborted
      && retryingRef.current
      && useChatStore.getState().activeSessionId === targetSessionId
    );
    const beginSending = () => {
      if (
        retryGeneration !== retryGenerationRef.current
        || retryController.signal.aborted
        || !retryingRef.current
      ) return false;
      retryingRef.current = false;
      if (retryAbortRef.current === retryController) retryAbortRef.current = null;
      retryPendingRef.current = false;
      retrySessionRef.current = null;
      setIsRetrying(false);
      return true;
    };

    retryingRef.current = true;
    retryAbortRef.current = retryController;
    retrySessionRef.current = sessionId;
    setIsRetrying(true);
    try {
      const pending = state.sessions.some((session) => session.session_id === sessionId && session.pending);
      retryPendingRef.current = pending;
      if (pending) {
        if (!interruptedMessage.recovery) {
          showToast('未能确认服务端会话，请稍后重试', 'error');
          return;
        }
        if (!interruptedMessage.recovery.requestSent) {
          if (!beginSending()) return;
          await runStream(userMessage.content, sessionId, interruptedMessage.id, true);
          return;
        }
        const recovered = await state.recoverPendingSession(
          sessionId,
          interruptedMessage.recovery,
          retryController.signal,
        );
        if (retryGeneration !== retryGenerationRef.current || !retryingRef.current) return;
        if (recovered.status === 'stale') return;
        if (recovered.status === 'not-found') {
          showToast('未能确认服务端会话，请稍后重试', 'error');
          return;
        }
        if (useChatStore.getState().activeSessionId !== recovered.detail.session_id) return;
        if (hasAssistantReply(recovered.detail.messages, userMessage.content)) return;
      } else {
        await state.loadSessions(retryController.signal);
        if (!retryIsCurrent(sessionId)) return;
        if (!await useChatStore.getState().openSession(sessionId, retryController.signal)) return;
        if (!retryIsCurrent(sessionId)) return;
        const syncedMessages = useChatStore.getState().messagesBySessionId[sessionId] ?? [];
        if (hasAssistantReply(syncedMessages, userMessage.content)) return;
      }
      if (!beginSending()) return;
      await sendMessage(userMessage.content);
    } catch (error) {
      if (retryGeneration === retryGenerationRef.current) {
        showToast(error instanceof Error ? error.message : '对话同步失败，请稍后重试', 'error');
      }
    } finally {
      if (retryGeneration === retryGenerationRef.current) {
        retryingRef.current = false;
        setIsRetrying(false);
      }
      if (retryAbortRef.current === retryController) retryAbortRef.current = null;
      retryPendingRef.current = false;
      if (retrySessionRef.current === sessionId) retrySessionRef.current = null;
    }
  }, [durableEvents.cancel, runStream, sendMessage]);

  useEffect(() => () => {
    const streamController = abortRef.current;
    abortRef.current = null;
    streamSessionRef.current = null;
    streamGenerationRef.current += 1;
    streamController?.abort();
    const retryController = retryAbortRef.current;
    retryAbortRef.current = null;
    retryPendingRef.current = false;
    retrySessionRef.current = null;
    retryController?.abort();
    retryGenerationRef.current += 1;
    retryingRef.current = false;
    if (durableRunsRef.current.size) {
      durableEvents.cancel();
      durableRunsRef.current.clear();
    }
  }, [durableEvents.cancel]);

  const structuredActionSender: { sendStructuredAction?: typeof sendStructuredAction } = { sendStructuredAction };
  return {
    isPendingBlocked,
    isStreaming: streaming || isRetrying,
    pendingApproval,
    approvePending,
    cancelPending,
    retryInterruptedMessage,
    sendMessage,
    ...structuredActionSender,
    stopGeneration,
  };
}

function agentResponseActivityStatus(
  status: AgentResponsePayload['result_status'],
): 'completed' | 'partial' | 'empty' | 'unavailable' | 'failed' {
  return status === 'ok' ? 'completed' : status;
}

function applyAgentRunEvent(sessionId: string, messageId: string, event: AgentRunPublicEvent): void {
  if (event.text) useChatStore.getState().appendMessageContent(sessionId, messageId, event.text);
  const status = activityStatusForRun(event);
  const step = parsePublicAgentActivityStep({
    visibility: 'public',
    step_id: event.stage ?? event.type,
    label: event.label ?? (event.status ? TASK_RUN_STATUS_LABELS[event.status] : '正在研究'),
    ...(event.detail ? { detail: event.detail } : {}),
    status,
    elapsed_ms: 0,
    sequence: event.sequence,
  });
  if (step) useChatStore.getState().mergeMessageActivity(sessionId, messageId, step);
  const terminal = terminalActivityStatus(event);
  if (terminal) useChatStore.getState().finishMessageActivity(sessionId, messageId, terminal);
}

function activityStatusForRun(event: AgentRunPublicEvent): 'running' | 'completed' | 'failed' | 'cancelled' {
  if (event.type === 'failed' || event.status === 'failed') return 'failed';
  if (event.status === 'completed') return 'completed';
  if (event.status === 'cancelled') return 'cancelled';
  return 'running';
}

function terminalActivityStatus(event: AgentRunPublicEvent): 'completed' | 'failed' | 'cancelled' | null {
  const status = activityStatusForRun(event);
  return status === 'running' ? null : status;
}

function shouldLoadQueryEvidence(category: string): boolean {
  return Boolean(category) && category !== 'chat' && category !== 'off_topic';
}

function toolStatus(value: unknown): 'running' | 'completed' | 'failed' {
  return value === 'completed' || value === 'failed' || value === 'running' ? value : 'running';
}

function loadQueryEvidence(
  sessionId: string,
  messageId: string,
  generation: number,
): void {
  void Promise.resolve().then(() => getQueryEvidence(sessionId)).then((connectorQuery) => {
    if (evidenceGenerations.get(sessionId) !== generation) return;
    if (
      connectorQuery.evidence
      || connectorQuery.knowledge_suggestion
      || connectorQuery.export
      || connectorQuery.knowledge_context
    ) {
      useChatStore.getState().setMessageConnectorQuery(sessionId, messageId, connectorQuery);
    }
  }).catch(() => {
    // 查询依据不能影响主回复。
  }).finally(() => {
    clearEvidenceGeneration(sessionId, generation);
  });
}

function clearEvidenceGeneration(sessionId: string, generation: number): void {
  if (evidenceGenerations.get(sessionId) === generation) evidenceGenerations.delete(sessionId);
}

function createMessageId(role: MessageItem['role']): string {
  return `${role}-${Date.now()}-${++localMessageCount}`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function hasAssistantReply(messages: MessageItem[], userText: string): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content === userText) {
      return messages.slice(index + 1).some((laterMessage) => laterMessage.role === 'assistant');
    }
  }
  return false;
}

function hasUnresolvedPendingRequest(state: ReturnType<typeof useChatStore.getState>): boolean {
  const sessionId = state.activeSessionId;
  if (!sessionId || !state.sessions.some((session) => session.session_id === sessionId && session.pending)) {
    return false;
  }
  return state.messagesBySessionId[sessionId]?.some((message) => (
    message.role === 'assistant'
    && message.interrupted
    && Boolean(message.recovery)
  )) ?? false;
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function createAbortError(): Error {
  return Object.assign(new Error('请求已取消'), { name: 'AbortError' });
}
