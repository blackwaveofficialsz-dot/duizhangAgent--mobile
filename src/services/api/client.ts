import { fetch as expoFetch } from 'expo/fetch';
import { readRuntimeConfig } from '@/config/env';
import {
  AccessTokenSnapshot,
  clearAccessToken,
  getAccessTokenSnapshot,
  isCurrentAccessToken,
  shouldRefreshAccessToken,
} from '@/services/auth/accessToken';

type ApiErrorBody = {
  detail?: unknown;
  error_code?: unknown;
  message?: unknown;
  retry_after?: unknown;
};

export type ApiRequestOptions = {
  auth?: boolean;
};

export type ApiStreamResponse = {
  body: ReadableStream<Uint8Array> | null;
};

type RequestContext = {
  accessTokenSnapshot: AccessTokenSnapshot;
  controller: AbortController;
  init: RequestInit;
  release: () => void;
};

type UnauthorizedHandler = (() => void) | null;
type RefreshSessionHandler = (() => Promise<boolean>) | null;

export const NETWORK_ERROR_MESSAGE = '无法连接服务器，请检查网络或服务状态';

export class ApiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

const activeControllers = new Set<AbortController>();
let unauthorizedHandler: UnauthorizedHandler = null;
let refreshSessionHandler: RefreshSessionHandler = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

export function setRefreshSessionHandler(handler: RefreshSessionHandler): void {
  refreshSessionHandler = handler;
}

export function cancelActiveRequests(): void {
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const context = createRequestContext(init, options);
  try {
    await refreshBeforeRequestIfNeeded(context, options);
    let response = await fetchResponse(path, context);
    response = await retryAfterUnauthorized(path, response, context, options);
    await assertSuccessful(response, options, context);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    context.release();
  }
}

export async function apiStream(path: string, init: RequestInit = {}): Promise<ApiStreamResponse> {
  const options: ApiRequestOptions = {};
  const context = createRequestContext(init, options);
  let response: Response;
  try {
    await refreshBeforeRequestIfNeeded(context, options);
    response = await fetchResponse(path, context);
    response = await retryAfterUnauthorized(path, response, context, options);
    await assertSuccessful(response, options, context);
  } catch (error) {
    context.release();
    throw error;
  }

  if (!response.body) {
    context.release();
    return { body: null };
  }

  return { body: wrapStreamBody(response.body, context) };
}

function createRequestContext(init: RequestInit, options: ApiRequestOptions): RequestContext {
  const controller = new AbortController();
  const headers = new Headers(init.headers);
  const accessTokenSnapshot = getAccessTokenSnapshot();
  if (options.auth !== false && accessTokenSnapshot.token) {
    headers.set('Authorization', `Bearer ${accessTokenSnapshot.token}`);
  }

  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  activeControllers.add(controller);
  let released = false;
  return {
    accessTokenSnapshot,
    controller,
    init: { ...init, headers, signal: controller.signal },
    release: () => {
      if (released) return;
      released = true;
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
      activeControllers.delete(controller);
    },
  };
}

async function fetchResponse(path: string, context: RequestContext): Promise<Response> {
  const { apiUrl } = readRuntimeConfig();
  try {
    return await expoFetch(`${apiUrl}${path}`, context.init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(NETWORK_ERROR_MESSAGE);
  }
}

async function refreshBeforeRequestIfNeeded(
  context: RequestContext,
  options: ApiRequestOptions,
): Promise<void> {
  if (options.auth === false || !shouldRefreshAccessToken(context.accessTokenSnapshot.token)) return;
  const refreshed = await refreshSessionHandler?.();
  if (refreshed) applyCurrentAccessToken(context, options);
}

async function retryAfterUnauthorized(
  path: string,
  response: Response,
  context: RequestContext,
  options: ApiRequestOptions,
): Promise<Response> {
  if (
    response.status !== 401
    || options.auth === false
    || !isCurrentAccessToken(context.accessTokenSnapshot)
    || !refreshSessionHandler
  ) return response;

  const refreshed = await refreshSessionHandler();
  if (!refreshed) return response;
  applyCurrentAccessToken(context, options);
  return fetchResponse(path, context);
}

function applyCurrentAccessToken(context: RequestContext, options: ApiRequestOptions): void {
  context.accessTokenSnapshot = getAccessTokenSnapshot();
  const headers = new Headers(context.init.headers);
  headers.delete('Authorization');
  if (options.auth !== false && context.accessTokenSnapshot.token) {
    headers.set('Authorization', `Bearer ${context.accessTokenSnapshot.token}`);
  }
  context.init = { ...context.init, headers };
}

async function assertSuccessful(
  response: Response,
  options: ApiRequestOptions,
  context: RequestContext,
): Promise<void> {
  if (response.ok) return;

  const error = await readError(response);
  if (
    response.status === 401
    && options.auth !== false
    && isCurrentAccessToken(context.accessTokenSnapshot)
  ) {
    clearAccessToken();
    unauthorizedHandler?.();
  }
  throw new ApiHttpError(error.message, response.status, error.code, error.retryAfter);
}

async function readError(response: Response): Promise<{
  message: string;
  code?: string;
  retryAfter?: number;
}> {
  const fallback = `请求失败（${response.status}）`;
  const retryAfterHeader = nonNegativeNumber(response.headers.get('Retry-After'));
  try {
    const body = (await response.json()) as ApiErrorBody;
    return {
      message: readableMessage(body.detail) || readableMessage(body.message) || fallback,
      code: readableMessage(body.error_code) ?? undefined,
      retryAfter: nonNegativeNumber(body.retry_after) ?? retryAfterHeader ?? undefined,
    };
  } catch {
    return { message: fallback, retryAfter: retryAfterHeader ?? undefined };
  }
}

function readableMessage(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function wrapStreamBody(
  sourceBody: ReadableStream<Uint8Array>,
  context: RequestContext,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let finished = false;
  let readerReleased = false;

  const releaseContext = () => {
    context.controller.signal.removeEventListener('abort', abortStream);
    context.release();
  };
  const releaseReader = () => {
    if (readerReleased || !reader) return;
    readerReleased = true;
    reader.releaseLock();
  };
  const cancelSource = (reason: unknown) => (
    reader ? reader.cancel(reason) : sourceBody.cancel(reason)
  );
  const abortStream = () => {
    if (finished) return;
    finished = true;
    const error = createAbortError();
    streamController?.error(error);
    releaseContext();
    void cancelSource(error).catch(() => undefined).finally(releaseReader);
  };
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      streamController = controller;
    },
    pull: async (controller) => {
      try {
        reader ??= sourceBody.getReader();
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          finished = true;
          controller.close();
          releaseContext();
          releaseReader();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        if (finished) return;
        finished = true;
        controller.error(error);
        releaseContext();
        releaseReader();
      }
    },
    cancel: (reason) => {
      if (finished) return;
      finished = true;
      releaseContext();
      void cancelSource(reason).catch(() => undefined).finally(releaseReader);
    },
  }, { highWaterMark: 0 });
  context.controller.signal.addEventListener('abort', abortStream, { once: true });
  if (context.controller.signal.aborted) abortStream();

  return body;
}

function createAbortError(): Error {
  return Object.assign(new Error('请求已取消'), { name: 'AbortError' });
}
