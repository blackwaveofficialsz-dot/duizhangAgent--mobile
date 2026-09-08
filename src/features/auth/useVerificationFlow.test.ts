import { act, renderHook } from '@testing-library/react-native';
import { confirmVerification, requestVerification } from '@/services/api/auth';
import { useVerificationFlow } from './useVerificationFlow';

jest.mock('@/services/api/auth', () => ({
  confirmVerification: jest.fn(),
  requestVerification: jest.fn(),
}));

const mockConfirmVerification = confirmVerification as jest.MockedFunction<typeof confirmVerification>;
const mockRequestVerification = requestVerification as jest.MockedFunction<typeof requestVerification>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('useVerificationFlow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockConfirmVerification.mockReset();
    mockRequestVerification.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('clears challenge, code and token when the target changes', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 60,
    });
    mockConfirmVerification.mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 600 });
    const { result, rerender, unmount } = await renderHook<ReturnType<typeof useVerificationFlow>, { target: string }>(
      ({ target }) => useVerificationFlow({ channel: 'email', purpose: 'login', target }),
      { initialProps: { target: 'a@example.com' } },
    );

    await act(async () => { await result.current.send(); });
    await act(async () => { await result.current.confirm('123456'); });
    await act(async () => { rerender({ target: 'b@example.com' }); });

    expect(result.current).toMatchObject({
      challengeId: null, code: '', verificationToken: null, phase: 'idle', resendAfter: 0,
    });
    await act(async () => { await unmount(); });
  });

  it('releases the resend timer on unmount', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 60,
    });
    const { result, unmount } = await renderHook(() => useVerificationFlow({
      channel: 'email', purpose: 'login', target: 'a@example.com',
    }));

    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    await act(async () => { await result.current.send(); });
    await unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('uses the server retry_after cooldown after a structured send error', async () => {
    const error = Object.assign(new Error('slow down'), { code: 'rate_limited', retryAfter: 30 });
    mockRequestVerification.mockRejectedValue(error);
    const { result, unmount } = await renderHook(() => useVerificationFlow({
      channel: 'email', purpose: 'login', target: 'a@example.com',
    }));

    const send = result.current.send;
    let received: unknown;
    await act(async () => {
      try {
        await send();
      } catch (value) {
        received = value;
      }
    });

    expect(received).toBe(error);
    expect(result.current).toMatchObject({ phase: 'error', error, resendAfter: 30 });
    await unmount();
  });

  it('uses retry_after after a failed confirmation and clears the entered code', async () => {
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const error = Object.assign(new Error('wait before retrying'), { code: 'rate_limited', retryAfter: 30 });
    mockConfirmVerification.mockRejectedValue(error);
    const { result, unmount } = await renderHook(() => useVerificationFlow({
      channel: 'email', purpose: 'login', target: 'a@example.com',
    }));

    await act(async () => { await result.current.send(); });
    let received: unknown;
    await act(async () => {
      try {
        await result.current.confirm('123456');
      } catch (value) {
        received = value;
      }
    });

    expect(received).toBe(error);
    expect(result.current).toMatchObject({
      challengeId: 'challenge-1', code: '', error, phase: 'error', resendAfter: 0, retryAfter: 30, verificationToken: null,
    });
    await act(async () => { await result.current.confirm('123456'); });
    expect(mockConfirmVerification).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('invalidates the previous challenge, code and token as soon as resend starts', async () => {
    mockRequestVerification.mockResolvedValueOnce({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    mockConfirmVerification.mockResolvedValue({ verificationToken: 'one-time-token', expiresIn: 600 });
    const resend = deferred<Awaited<ReturnType<typeof requestVerification>>>();
    mockRequestVerification.mockReturnValueOnce(resend.promise);
    const { result, unmount } = await renderHook(() => useVerificationFlow({
      channel: 'email', purpose: 'register', target: 'a@example.com', inviteToken: 'invite-token',
    }));

    await act(async () => { await result.current.send(); });
    await act(async () => { await result.current.confirm('123456'); });
    let pendingResend!: Promise<void>;
    await act(async () => {
      pendingResend = result.current.send();
      await Promise.resolve();
    });

    expect(result.current).toMatchObject({
      challengeId: null, code: '', phase: 'sending', verificationToken: null,
    });
    await act(async () => {
      resend.resolve({ challengeId: 'challenge-2', message: 'sent', expiresIn: 300, resendAfter: 0 });
      await pendingResend;
    });
    await unmount();
  });

  it('suppresses duplicate confirmations and stale completions after reset', async () => {
    const request = deferred<Awaited<ReturnType<typeof requestVerification>>>();
    mockRequestVerification.mockReturnValue(request.promise);
    const { result, unmount } = await renderHook(() => useVerificationFlow({
      channel: 'email', purpose: 'login', target: 'a@example.com',
    }));

    const send = result.current.send;
    let firstSend!: Promise<void>;
    let secondSend!: Promise<void>;
    act(() => {
      firstSend = send();
      secondSend = send();
    });

    expect(mockRequestVerification).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0 });
      await firstSend;
      await secondSend;
    });

    const staleRequest = deferred<Awaited<ReturnType<typeof requestVerification>>>();
    mockRequestVerification.mockReturnValue(staleRequest.promise);
    let staleSend!: Promise<void>;
    act(() => { staleSend = result.current.send(); });
    act(() => result.current.reset());
    await act(async () => {
      staleRequest.resolve({ challengeId: 'stale-challenge', message: 'sent', expiresIn: 300, resendAfter: 60 });
      await staleSend;
    });

    expect(result.current).toMatchObject({ challengeId: null, phase: 'idle', resendAfter: 0 });

    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-1', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const confirmation = deferred<Awaited<ReturnType<typeof confirmVerification>>>();
    mockConfirmVerification.mockReturnValueOnce(confirmation.promise);

    await act(async () => { await result.current.send(); });
    let firstConfirm!: Promise<string | null>;
    let duplicateConfirm!: Promise<string | null>;
    act(() => {
      firstConfirm = result.current.confirm('123456');
      duplicateConfirm = result.current.confirm('123456');
    });
    expect(mockConfirmVerification).toHaveBeenCalledTimes(1);
    await act(async () => {
      confirmation.resolve({ verificationToken: 'one-time-token', expiresIn: 600 });
      await firstConfirm;
      await duplicateConfirm;
    });

    act(() => result.current.reset());
    mockRequestVerification.mockResolvedValue({
      challengeId: 'challenge-2', message: 'sent', expiresIn: 300, resendAfter: 0,
    });
    const resetConfirmation = deferred<Awaited<ReturnType<typeof confirmVerification>>>();
    mockConfirmVerification.mockReturnValueOnce(resetConfirmation.promise);
    await act(async () => { await result.current.send(); });
    let resetConfirm!: Promise<string | null>;
    act(() => { resetConfirm = result.current.confirm('123456'); });
    act(() => result.current.reset());
    await act(async () => {
      resetConfirmation.resolve({ verificationToken: 'stale-token', expiresIn: 600 });
      await expect(resetConfirm).resolves.toBeNull();
    });
    expect(result.current).toMatchObject({
      challengeId: null, code: '', phase: 'idle', verificationToken: null,
    });

    await unmount();
  });
});
