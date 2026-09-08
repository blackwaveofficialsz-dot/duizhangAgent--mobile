import type { CacheJson } from '@/services/cache/cachePolicy';
import {
  captureOfflineCacheOperationToken,
  clearCachedAnalyticsDailyBucket,
  mergeCachedAnalyticsDelta,
  readCachedAnalyticsDailyBucket,
  readCachedAnalyticsClientDays,
  type AnalyticsChangedDay,
} from '@/services/cache/offlineCache';

export type AnalyticsDeltaEnvelope<T> = {
  changed_days?: AnalyticsChangedDay<T>[];
  unchanged_days?: string[];
};

export type AnalyticsDeltaLoadOptions<T> = {
  cacheScope: string;
  dateFrom: string;
  dateTo: string;
  forceRefresh?: boolean;
  meta?: (response: AnalyticsDeltaEnvelope<T> & Record<string, unknown>) => Record<string, CacheJson> | undefined;
  request(clientDays: Array<{ date: string; version: string }>): Promise<AnalyticsDeltaEnvelope<T> & Record<string, unknown>>;
  signal?: AbortSignal;
};

export type AnalyticsDailyFactV2Response<T> = {
  access_scope_hash: string;
  changed_days: Array<{ date: string; payload: T; version: string }>;
  deleted_days: string[];
  namespace: string;
  params_hash: string;
  reset_required: boolean;
  schema_version: string;
  unchanged_days: string[];
};

export type AnalyticsDailyFactV2LoadOptions<T> = {
  cacheScope: string;
  dateFrom: string;
  dateTo: string;
  forceRefresh?: boolean;
  request(
    clientDays: Array<{ date: string; version: string }>,
    clientAccessScopeHash: string | null,
    range: { dateFrom: string; dateTo: string; forceRefresh: boolean },
  ): Promise<AnalyticsDailyFactV2Response<T>>;
  schemaVersion: string;
  signal?: AbortSignal;
};

export function eachBusinessDate(dateFrom: string, dateTo: string): string[] {
  const from = parseBusinessDate(dateFrom);
  const to = parseBusinessDate(dateTo);
  if (from > to) throw new Error('经营分析日期范围无效');
  if ((to - from) / 86_400_000 > 364) throw new Error('经营分析日期范围不能超过365天');

  const days: string[] = [];
  for (let current = from; current <= to; current += 86_400_000) {
    days.push(new Date(current).toISOString().slice(0, 10));
  }
  return days;
}

export async function loadAnalyticsDailyDelta<T>(options: AnalyticsDeltaLoadOptions<T>): Promise<{
  days: string[];
  entries?: Array<{ date: string; payload: T; version: string }>;
  payloads: T[];
  meta?: Record<string, CacheJson>;
}> {
  const days = eachBusinessDate(options.dateFrom, options.dateTo);
  throwIfAborted(options.signal);
  const cacheOperation = { signal: options.signal, token: captureOfflineCacheOperationToken() };
  if (options.forceRefresh) await clearCachedAnalyticsDailyBucket(options.cacheScope, undefined, cacheOperation);
  throwIfAborted(options.signal);
  const clientDays = options.forceRefresh
    ? []
    : await readCachedAnalyticsClientDays(options.cacheScope, options.dateFrom, options.dateTo, undefined, cacheOperation);
  throwIfAborted(options.signal);
  const response = await options.request(clientDays);
  throwIfAborted(options.signal);
  validateDeltaResponse(response, days, clientDays);
  throwIfAborted(options.signal);
  const bucket = await mergeCachedAnalyticsDelta(
    options.cacheScope,
    response.changed_days === undefined ? [] : response.changed_days,
    options.meta?.(response),
    undefined,
    cacheOperation,
  );
  throwIfAborted(options.signal);
  const entries = days.map((day) => {
    const entry = bucket?.days[day];
    return entry ? { date: day, payload: entry.payload, version: entry.version } : undefined;
  });
  if (!days.length || entries.some((entry) => entry === undefined)) {
    throw new Error('经营分析日缓存不完整');
  }
  const completeEntries = entries as Array<{ date: string; payload: T; version: string }>;
  return {
    days,
    entries: completeEntries,
    payloads: completeEntries.map((entry) => entry.payload),
    meta: bucket?.meta,
  };
}

export async function loadAnalyticsDailyFactsV2<T>(options: AnalyticsDailyFactV2LoadOptions<T>): Promise<{
  days: string[];
  payloads: T[];
}> {
  const days = eachBusinessDate(options.dateFrom, options.dateTo);
  throwIfAborted(options.signal);
  const cacheOperation = { signal: options.signal, token: captureOfflineCacheOperationToken() };
  const scopes = [...new Set(days.map((day) => monthlyScope(options.cacheScope, day)))];
  const buckets = new Map<string, Awaited<ReturnType<typeof readCachedAnalyticsDailyBucket<T>>>>();
  for (const scope of scopes) {
    buckets.set(scope, await readCachedAnalyticsDailyBucket<T>(scope, undefined, cacheOperation));
  }
  const populatedBuckets = [...buckets.values()].filter((bucket) => Object.keys(bucket?.days || {}).length > 0);
  const accessHashes = new Set(
    populatedBuckets
      .map((bucket) => bucket?.meta?.access_scope_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const cacheIdentityValid = populatedBuckets.every((bucket) => (
    bucket?.meta?.schema_version === options.schemaVersion
    && typeof bucket.meta.access_scope_hash === 'string'
    && bucket.meta.access_scope_hash.length > 0
  )) && accessHashes.size <= 1;
  let clientAccessScopeHash = cacheIdentityValid && accessHashes.size === 1 ? [...accessHashes][0] : null;
  if (options.forceRefresh || !cacheIdentityValid) {
    for (const scope of scopes) {
      await clearCachedAnalyticsDailyBucket(scope, undefined, cacheOperation);
      buckets.set(scope, { days: {} });
    }
  }
  const deletedDays = new Set<string>();
  let responseAccessScopeHash: string | null = null;
  const ranges = splitBusinessDateRanges(days, options.forceRefresh ? 31 : days.length);
  for (const rangeDays of ranges) {
    throwIfAborted(options.signal);
    const clientDays = options.forceRefresh ? [] : rangeDays.flatMap((day) => {
      const cached = buckets.get(monthlyScope(options.cacheScope, day))?.days[day];
      return cached ? [{ date: day, version: cached.version }] : [];
    });
    const response = await options.request(clientDays, clientAccessScopeHash, {
      dateFrom: rangeDays[0],
      dateTo: rangeDays[rangeDays.length - 1],
      forceRefresh: Boolean(options.forceRefresh),
    });
    throwIfAborted(options.signal);
    validateV2Response(response, rangeDays, clientDays, options.schemaVersion);
    if (responseAccessScopeHash !== null && response.access_scope_hash !== responseAccessScopeHash) {
      throw new Error('经营分析V2增量协议无效');
    }
    responseAccessScopeHash = response.access_scope_hash;
    clientAccessScopeHash = response.access_scope_hash;

    if (response.reset_required) {
      for (const scope of scopes) {
        await clearCachedAnalyticsDailyBucket(scope, undefined, cacheOperation);
        buckets.set(scope, { days: {} });
      }
      deletedDays.clear();
    }
    response.deleted_days.forEach((day) => deletedDays.add(day));
    const meta: Record<string, CacheJson> = {
      access_scope_hash: response.access_scope_hash,
      namespace: response.namespace,
      params_hash: response.params_hash,
      schema_version: response.schema_version,
    };
    const rangeScopes = [...new Set(rangeDays.map((day) => monthlyScope(options.cacheScope, day)))];
    for (const scope of rangeScopes) {
      const month = scope.slice(-7);
      const changed = response.changed_days.filter((day) => day.date.startsWith(month));
      const deleted = response.deleted_days
        .filter((day) => day.startsWith(month))
        .map((date) => ({ date, payload: null, version: 'deleted' }));
      const updates: AnalyticsChangedDay<T>[] = [...changed, ...deleted];
      if (updates.length) {
        buckets.set(scope, await mergeCachedAnalyticsDelta(scope, updates, meta, undefined, cacheOperation));
      }
    }
  }
  throwIfAborted(options.signal);
  const payloads = days.flatMap((day) => {
    const cached = buckets.get(monthlyScope(options.cacheScope, day))?.days[day];
    if (cached) return [cached.payload];
    if (deletedDays.has(day)) return [];
    throw new Error('经营分析V2日缓存不完整');
  });
  return { days, payloads };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
}

function monthlyScope(cacheScope: string, day: string): string {
  return `${cacheScope}:${day.slice(0, 7)}`;
}

function splitBusinessDateRanges(days: string[], maxDays: number): string[][] {
  const ranges: string[][] = [];
  for (let index = 0; index < days.length; index += maxDays) ranges.push(days.slice(index, index + maxDays));
  return ranges;
}

function validateV2Response<T>(
  response: AnalyticsDailyFactV2Response<T>,
  days: string[],
  clientDays: Array<{ date: string; version: string }>,
  schemaVersion: string,
): void {
  if (
    !response
    || response.schema_version !== schemaVersion
    || typeof response.namespace !== 'string'
    || typeof response.params_hash !== 'string'
    || typeof response.access_scope_hash !== 'string'
    || typeof response.reset_required !== 'boolean'
    || !Array.isArray(response.changed_days)
    || !Array.isArray(response.unchanged_days)
    || !Array.isArray(response.deleted_days)
  ) {
    throw new Error('经营分析V2增量协议无效');
  }
  const requested = new Set(days);
  const client = new Set(clientDays.map((day) => day.date));
  const resolved = new Set<string>();
  for (const changed of response.changed_days) {
    if (!changed || typeof changed.date !== 'string' || typeof changed.version !== 'string' || changed.payload === undefined || !requested.has(changed.date) || resolved.has(changed.date)) {
      throw new Error('经营分析V2增量协议无效');
    }
    resolved.add(changed.date);
  }
  for (const unchanged of response.unchanged_days) {
    if (typeof unchanged !== 'string' || !requested.has(unchanged) || !client.has(unchanged) || resolved.has(unchanged)) {
      throw new Error('经营分析V2增量协议无效');
    }
    resolved.add(unchanged);
  }
  for (const deleted of response.deleted_days) {
    if (typeof deleted !== 'string' || !requested.has(deleted) || resolved.has(deleted)) {
      throw new Error('经营分析V2增量协议无效');
    }
    resolved.add(deleted);
  }
  if (resolved.size !== requested.size) throw new Error('经营分析V2增量协议无效');
}

function validateDeltaResponse<T>(
  response: AnalyticsDeltaEnvelope<T>,
  days: string[],
  clientDays: Array<{ date: string; version: string }>,
): void {
  const requestedDays = new Set(days);
  const changedDays = response.changed_days === undefined ? [] : response.changed_days;
  const unchangedDays = response.unchanged_days === undefined ? [] : response.unchanged_days;
  if (!Array.isArray(changedDays) || !Array.isArray(unchangedDays)) throw new Error('经营分析增量协议无效');

  const changedDates = new Set<string>();
  for (const changedDay of changedDays) {
    if (
      !changedDay
      || typeof changedDay.date !== 'string'
      || typeof changedDay.version !== 'string'
      || !Object.prototype.hasOwnProperty.call(changedDay, 'payload')
      || changedDay.payload === undefined
      || !requestedDays.has(changedDay.date)
      || changedDates.has(changedDay.date)
    ) {
      throw new Error('经营分析增量协议无效');
    }
    changedDates.add(changedDay.date);
  }

  const clientDates = new Set(clientDays.map((day) => day.date));
  const unchangedDates = new Set<string>();
  for (const unchangedDay of unchangedDays) {
    if (typeof unchangedDay !== 'string' || !requestedDays.has(unchangedDay) || !clientDates.has(unchangedDay) || changedDates.has(unchangedDay) || unchangedDates.has(unchangedDay)) {
      throw new Error('经营分析增量协议无效');
    }
    unchangedDates.add(unchangedDay);
  }
  if (changedDates.size + unchangedDates.size !== requestedDays.size || [...requestedDays].some((day) => !changedDates.has(day) && !unchangedDates.has(day))) {
    throw new Error('经营分析增量协议无效');
  }
}

function parseBusinessDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('经营分析日期格式无效');
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('经营分析日期格式无效');
  }
  return timestamp;
}
