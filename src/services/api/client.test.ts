import {
  apiRequest,
  apiStream,
  cancelActiveRequests,
  setRefreshSessionHandler,
  setUnauthorizedHandler,
} from './client';
import { fetch as expoFetch } from 'expo/fetch';
import { parseSse } from '@/services/sse/parseSse';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/services/auth/accessToken';

async function readStreamText(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

describe('API client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AUTH_MODE = 'legacy';
    clearAccessToken();
    cancelActiveRequests();
    setRefreshSessionHandler(null);
    setUnauthorizedHandler(null);
  });

  it('uses expo fetch so response bodies remain readable streams on native', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: ready\n\n', { status: 200 }),
    );

    const response = await apiStream('/api/v1/chat');
    await expect(readStreamText(response.body!)).resolves.toBe('data: ready\n\n');

    expect(expoFetch).toHaveBeenCalledTimes(1);
  });

  it('exposes only the readable body to streaming callers', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: narrow\n\n', { status: 200 }),
    );

    const response = await apiStream('/api/v1/chat');

    expect(Object.keys(response)).toEqual(['body']);
    expect((response as unknown as { clone?: unknown }).clone).toBeUndefined();
    await expect(readStreamText(response.body!)).resolves.toBe('data: narrow\n\n');
  });

  it('preserves HTTP status for streaming error classification', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '暂时不可用' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiStream('/api/v1/agent-runs/events')).rejects.toMatchObject({
      message: '暂时不可用',
      status: 503,
    });
  });

  it('releases a streaming request after body consumption completes', async () => {
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return Promise.resolve(new Response('complete', { status: 200 }));
    });

    const response = await apiStream('/api/v1/chat');
    await expect(readStreamText(response.body!)).resolves.toBe('complete');
    cancelActiveRequests();

    expect(requestSignal?.aborted).toBe(false);
  });

  it('cancels the native source and releases context before the first wrapped pull', async () => {
    const cancelSource = jest.fn();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        cancel: cancelSource,
      }), { status: 200 }));
    });
    const response = await apiStream('/api/v1/chat');

    await response.body!.cancel('unused');
    cancelActiveRequests();

    expect(cancelSource).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);
  });

  it('cancels the stream source when the external signal aborts', async () => {
    const externalController = new AbortController();
    const cancelSource = jest.fn();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel: cancelSource,
      }), { status: 200 }));
    });
    const response = await apiStream('/api/v1/chat', { signal: externalController.signal });
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1]) });
    const pendingRead = reader.read();

    externalController.abort();

    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelSource).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    cancelActiveRequests();
    jest.restoreAllMocks();
  });

  it('automatically attaches the in-memory Bearer token to business requests', async () => {
    setAccessToken('access-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await apiRequest('/api/v1/tasks', { headers: { 'X-Request-ID': 'request-1' } });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('X-Request-ID')).toBe('request-1');
  });

  it('can explicitly omit authentication for login', async () => {
    setAccessToken('stale-token');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: 'new-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await apiRequest('/api/v1/auth/login', {}, { auth: false });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('clears the token and notifies the session when a business request returns 401', async () => {
    setAccessToken('expired-token');
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '登录状态已失效' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiRequest('/api/v1/tasks')).rejects.toThrow('登录状态已失效');

    expect(getAccessToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('refreshes the access token once and retries after a business 401', async () => {
    setAccessToken('expired-token');
    setRefreshSessionHandler(jest.fn().mockImplementation(async () => {
      setAccessToken('fresh-token');
      return true;
    }));
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get('Authorization') === 'Bearer fresh-token') {
        return Promise.resolve(new Response(JSON.stringify({ items: ['ok'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: '登录状态已失效' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    await expect(apiRequest('/api/v1/tasks')).resolves.toEqual({ items: ['ok'] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('fresh-token');
  });

  it('does not let a stale 401 clear a newer authenticated session', async () => {
    setAccessToken('old-token');
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    let resolveFetch: ((response: Response) => void) | undefined;
    jest.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const oldRequest = apiRequest('/api/v1/tasks');
    await Promise.resolve();
    setAccessToken('new-token');
    resolveFetch?.(new Response(JSON.stringify({ detail: '旧会话已失效' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(oldRequest).rejects.toThrow('旧会话已失效');
    expect(getAccessToken()).toBe('new-token');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('cancels an in-flight request without converting it to a network error', async () => {
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });

    const request = apiRequest('/api/v1/tasks');
    await Promise.resolve();
    cancelActiveRequests();

    expect(requestSignal?.aborted).toBe(true);
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the request abortable while the response body is being parsed', async () => {
    let requestSignal: AbortSignal | undefined;
    let resolveBody: ((value: { items: never[] }) => void) | undefined;
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => {
          markBodyStarted?.();
          return new Promise((resolve) => { resolveBody = resolve; });
        },
      } as Response);
    });

    const request = apiRequest<{ items: never[] }>('/api/v1/tasks');
    await bodyStarted;
    cancelActiveRequests();

    expect(requestSignal?.aborted).toBe(true);
    resolveBody?.({ items: [] });
    await expect(request).resolves.toEqual({ items: [] });
  });

  it('keeps a streaming response abortable until logout', async () => {
    let streamSignal: AbortSignal | undefined;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      streamSignal = init?.signal || undefined;
      return Promise.resolve(new Response('data: ready\n\n', { status: 200 }));
    });
    setAccessToken('access-token');

    await apiStream('/api/v1/chat', { method: 'POST' });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);

    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(streamSignal?.aborted).toBe(false);
    cancelActiveRequests();
    expect(streamSignal?.aborted).toBe(true);
  });

  it('releases a streaming request when DONE cancels a source that stays open', async () => {
    const cancelSource = jest.fn();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      requestSignal = init?.signal || undefined;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        },
        cancel: cancelSource,
      }), { status: 200 }));
    });
    const response = await apiStream('/api/v1/chat');

    for await (const _event of parseSse(response.body!)) {
      // Consume through DONE.
    }
    cancelActiveRequests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cancelSource).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);
  });

  it('terminates the returned stream and discards queued events on logout', async () => {
    const encodedEvent = new TextEncoder().encode('data: stale\n\n');
    const cancelSource = jest.fn().mockRejectedValue(new Error('source cancel failed'));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(encodedEvent),
        cancel: cancelSource,
      }), { status: 200 }),
    );

    const response = await apiStream('/api/v1/chat');
    const reader = response.body!.getReader();
    cancelActiveRequests();

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelSource).toHaveBeenCalledTimes(1);
  });

  it('uses the backend message when detail is absent', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '当前操作不可用' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiRequest('/api/v1/tasks')).rejects.toThrow('当前操作不可用');
  });

  it('keeps the backend error code and retry-after for an auth flow', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error_code: 'contact_not_registered',
        detail: '该联系方式尚未注册',
        retry_after: 23,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
      }),
    );

    await expect(apiRequest('/api/v1/auth/verifications', { method: 'POST' }, { auth: false }))
      .rejects.toEqual(expect.objectContaining({
        message: '该联系方式尚未注册',
        status: 404,
        code: 'contact_not_registered',
        retryAfter: 23,
      }));
  });

  it('converts native network failures into an actionable Chinese error', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(apiRequest('/api/v1/tasks')).rejects.toThrow(
      '无法连接服务器，请检查网络或服务状态',
    );
  });
});
