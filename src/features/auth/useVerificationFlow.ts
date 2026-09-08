import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmVerification, requestVerification } from '@/services/api/auth';
import type { VerificationRequest } from '@/services/api/auth';

export type VerificationChannel = VerificationRequest['channel'];
export type VerificationPurpose = VerificationRequest['purpose'];
export type VerificationPhase = 'idle' | 'sending' | 'awaitingCode' | 'confirming' | 'verified' | 'error';

export type VerificationFlowInput = {
  channel: VerificationChannel;
  inviteToken?: string;
  purpose: VerificationPurpose;
  target: string;
};

type VerificationFlowState = {
  challengeId: string | null;
  code: string;
  error: Error | null;
  phase: VerificationPhase;
  resendAfter: number;
  retryAfter: number;
  verificationToken: string | null;
};

const EMPTY_STATE: VerificationFlowState = {
  challengeId: null,
  code: '',
  error: null,
  phase: 'idle',
  resendAfter: 0,
  retryAfter: 0,
  verificationToken: null,
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('验证码请求失败');
}

function retryAfter(value: unknown): number {
  if (!value || typeof value !== 'object' || !('retryAfter' in value)) return 0;
  const seconds = Number(value.retryAfter);
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
}

export function useVerificationFlow(input: VerificationFlowInput) {
  const [state, setState] = useState<VerificationFlowState>(EMPTY_STATE);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const commit = useCallback((next: VerificationFlowState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const update = useCallback((updater: (current: VerificationFlowState) => VerificationFlowState) => {
    const next = updater(stateRef.current);
    commit(next);
    return next;
  }, [commit]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startCooldown = useCallback(() => {
    clearTimer();
    if (stateRef.current.resendAfter <= 0 && stateRef.current.retryAfter <= 0) return;

    timerRef.current = setInterval(() => {
      const next = update((current) => ({
        ...current,
        resendAfter: Math.max(0, current.resendAfter - 1),
        retryAfter: Math.max(0, current.retryAfter - 1),
      }));
      if (next.resendAfter === 0 && next.retryAfter === 0) clearTimer();
    }, 1_000);
  }, [clearTimer, update]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    inFlightRef.current = false;
    clearTimer();
    commit(EMPTY_STATE);
  }, [clearTimer, commit]);

  useEffect(() => {
    mountedRef.current = true;
    reset();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      inFlightRef.current = false;
      clearTimer();
    };
  }, [clearTimer, input.channel, input.inviteToken, input.purpose, input.target, reset]);

  const send = useCallback(async () => {
    if (inFlightRef.current || stateRef.current.resendAfter > 0 || !input.target.trim()) return;

    const requestId = requestRef.current;
    inFlightRef.current = true;
    commit({ ...EMPTY_STATE, phase: 'sending' });
    try {
      const challenge = await requestVerification({
        channel: input.channel,
        ...(input.inviteToken ? { inviteToken: input.inviteToken } : {}),
        purpose: input.purpose,
        target: input.target,
      });
      if (!mountedRef.current || requestRef.current !== requestId) return;

      const next = {
        ...EMPTY_STATE,
        challengeId: challenge.challengeId,
        phase: 'awaitingCode' as const,
        resendAfter: Math.max(0, challenge.resendAfter),
      };
      commit(next);
      startCooldown();
    } catch (value) {
      if (!mountedRef.current || requestRef.current !== requestId) return;

      const seconds = retryAfter(value);
      const error = asError(value);
      commit({ ...EMPTY_STATE, error, phase: 'error', resendAfter: seconds });
      startCooldown();
      throw value;
    } finally {
      if (requestRef.current === requestId) inFlightRef.current = false;
    }
  }, [commit, input.channel, input.inviteToken, input.purpose, input.target, startCooldown]);

  const confirm = useCallback(async (code: string) => {
    const challengeId = stateRef.current.challengeId;
    if (inFlightRef.current || stateRef.current.retryAfter > 0 || !challengeId) return null;

    const requestId = requestRef.current;
    inFlightRef.current = true;
    update((current) => ({ ...current, code, error: null, phase: 'confirming' }));
    try {
      const confirmation = await confirmVerification(challengeId, code);
      if (!mountedRef.current || requestRef.current !== requestId) return null;

      update((current) => ({
        ...current,
        code,
        phase: 'verified',
        verificationToken: confirmation.verificationToken,
      }));
      return confirmation.verificationToken;
    } catch (value) {
      if (!mountedRef.current || requestRef.current !== requestId) return null;

      const seconds = retryAfter(value);
      commit({
        ...EMPTY_STATE,
        challengeId,
        error: asError(value),
        phase: 'error',
        resendAfter: stateRef.current.resendAfter,
        retryAfter: seconds,
      });
      startCooldown();
      throw value;
    } finally {
      if (requestRef.current === requestId) inFlightRef.current = false;
    }
  }, [commit, startCooldown, update]);

  const setCode = useCallback((code: string) => {
    update((current) => ({ ...current, code }));
  }, [update]);

  return { ...state, confirm, reset, send, setCode };
}
