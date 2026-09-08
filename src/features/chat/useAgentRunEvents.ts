import { useCallback, useEffect, useRef } from 'react';
import { AgentRunStreamError, streamAgentRunEvents } from '@/services/api/agentRuns';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import type {
  AgentRunEventEnvelope,
  AgentRunCleanupReason,
  AgentRunEventHandlers,
  AgentRunPublicEvent,
  AgentRunStatus,
} from '@/types/agentRun';

const TERMINAL_STATUSES = new Set<AgentRunStatus>(['completed', 'failed', 'cancelled']);
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 10_000;

export function useAgentRunEvents() {
  const runsRef = useRef(new Map<string, {
    controller: AbortController;
    handlers: AgentRunEventHandlers;
  }>());

  const cleanup = useCallback((runId: string, reason: AgentRunCleanupReason) => {
    const run = runsRef.current.get(runId);
    if (!run) return;
    runsRef.current.delete(runId);
    run.controller.abort();
    run.handlers.onCleanup?.(reason);
  }, []);

  const start = useCallback((runId: string, handlers: AgentRunEventHandlers) => {
    cleanup(runId, 'replaced');
    const controller = new AbortController();
    runsRef.current.set(runId, { controller, handlers });

    void (async () => {
      let lastSequence = 0;
      let reconnectMs = INITIAL_RECONNECT_MS;
      try {
        while (!controller.signal.aborted) {
          let received = false;
          try {
            for await (const envelope of streamAgentRunEvents(runId, lastSequence, controller.signal)) {
              if (controller.signal.aborted || envelope.sequence <= lastSequence) continue;
              let publicEvent: AgentRunPublicEvent;
              try {
                publicEvent = toPublicEvent(envelope);
                await handlers.onEvent(publicEvent);
              } catch {
                break;
              }
              lastSequence = envelope.sequence;
              received = true;
              if (isTerminal(publicEvent)) {
                cleanup(runId, 'terminal');
                return;
              }
            }
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return;
            if (!isRetryable(error)) {
              cleanup(runId, 'interrupted');
              return;
            }
          }
          if (controller.signal.aborted) return;
          if (received) reconnectMs = INITIAL_RECONNECT_MS;
          await abortableDelay(reconnectMs, controller.signal);
          reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
        }
      } finally {
        if (runsRef.current.get(runId)?.controller === controller) {
          cleanup(runId, 'interrupted');
        }
      }
    })();
  }, [cleanup]);

  const cancel = useCallback((runId?: string) => {
    const runIds = runId ? [runId] : [...runsRef.current.keys()];
    for (const id of runIds) cleanup(id, 'interrupted');
  }, [cleanup]);
  useEffect(() => cancel, [cancel]);

  return { start, cancel };
}

function toPublicEvent(envelope: AgentRunEventEnvelope): AgentRunPublicEvent {
  const data = envelope.data;
  const event: AgentRunPublicEvent = { sequence: envelope.sequence, type: envelope.type };
  if (typeof data.stage === 'string') event.stage = data.stage;
  if (typeof data.label === 'string') event.label = data.label;
  if (typeof data.detail === 'string') event.detail = data.detail;
  if (
    (envelope.type === 'status' || envelope.type === 'final' || envelope.type === 'failed')
    && isRunStatus(data.status)
  ) event.status = data.status;
  if (envelope.type === 'final') {
    if (typeof data.text === 'string') event.text = data.text;
    else if (typeof data.content === 'string') event.text = data.content;
  }
  return event;
}

function isRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && [
    'queued', 'running', 'validating', 'waiting_for_data', 'waiting_for_approval',
    'needs_review', 'completed', 'failed', 'cancelled',
  ].includes(value);
}

function isTerminal(event: AgentRunPublicEvent): boolean {
  return event.type === 'final'
    || event.type === 'failed'
    || (
      event.type === 'status'
      && (
        (event.status !== undefined && TERMINAL_STATUSES.has(event.status))
        || (isRunStatus(event.stage) && TERMINAL_STATUSES.has(event.stage))
      )
    );
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AgentRunStreamError) return error.retryable;
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.message === NETWORK_ERROR_MESSAGE) return true;
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && typeof error.status === 'number'
    && error.status >= 500;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
