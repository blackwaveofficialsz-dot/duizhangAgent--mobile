import { act, renderHook } from '@testing-library/react-native';
import { getAuthCapabilities } from '@/services/api/auth';
import { useAuthCapabilities } from './useAuthCapabilities';

jest.mock('@/services/api/auth', () => ({ getAuthCapabilities: jest.fn() }));

const mockGetAuthCapabilities = getAuthCapabilities as jest.MockedFunction<typeof getAuthCapabilities>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('useAuthCapabilities', () => {
  beforeEach(() => mockGetAuthCapabilities.mockReset());

  it('exposes the server capabilities after loading', async () => {
    const request = deferred<Awaited<ReturnType<typeof getAuthCapabilities>>>();
    mockGetAuthCapabilities.mockReturnValue(request.promise);
    const { result, unmount } = await renderHook(() => useAuthCapabilities());

    expect(result.current).toMatchObject({ status: 'loading', capabilities: null });
    await act(async () => {
      request.resolve({
        verificationEnabled: true,
        codeLoginEnabled: true,
        codeLoginRevealUnknownContact: false,
        passwordResetEnabled: true,
        contactManagementEnabled: true,
        registerVerificationRequired: true,
      });
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({
      status: 'ready', capabilities: { verificationEnabled: true, codeLoginEnabled: true },
    });
    await unmount();
  });

  it('keeps password mode available by exposing a capability loading error', async () => {
    const request = deferred<Awaited<ReturnType<typeof getAuthCapabilities>>>();
    mockGetAuthCapabilities.mockReturnValue(request.promise);
    const { result, unmount } = await renderHook(() => useAuthCapabilities());

    await act(async () => {
      request.reject(new Error('network unavailable'));
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ status: 'error', capabilities: null });
    await unmount();
  });

  it('ignores a capabilities response that completes after unmount', async () => {
    const request = deferred<Awaited<ReturnType<typeof getAuthCapabilities>>>();
    mockGetAuthCapabilities.mockReturnValue(request.promise);
    const { result, unmount } = await renderHook(() => useAuthCapabilities());

    await unmount();
    await act(async () => {
      request.resolve({
        verificationEnabled: true,
        codeLoginEnabled: true,
        codeLoginRevealUnknownContact: false,
        passwordResetEnabled: true,
        contactManagementEnabled: true,
        registerVerificationRequired: true,
      });
      await Promise.resolve();
    });

    expect(result.current).toMatchObject({ status: 'loading', capabilities: null });
  });
});
