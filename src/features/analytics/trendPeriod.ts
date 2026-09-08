export type TrendGranularity = 'day' | 'week' | 'month';

export type TrendMovingAverageMeta = {
  field: string;
  label: string;
  window: number;
  available: boolean;
  available_periods: number;
};

export type TrendRange = {
  dateFrom: string;
  dateTo: string;
  includeCurrent: boolean;
};

export type DetailPeriodOption = {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
};

export function trendPointStatusText(point?: { in_progress?: boolean; missing?: boolean }): string | null {
  const statuses = [
    point?.in_progress ? '进行中，截至昨日' : null,
    point?.missing ? '数据不完整' : null,
  ].filter(Boolean);
  return statuses.length ? statuses.join(' · ') : null;
}

export function defaultTrendRange(granularity: TrendGranularity, todayYmd: string): TrendRange {
  const today = parseDate(todayYmd);
  if (granularity === 'week') {
    const end = addDays(startOfIsoWeek(today), -1);
    return {
      dateFrom: formatDate(startOfIsoWeek(addDays(end, -28))),
      dateTo: formatDate(end),
      includeCurrent: false,
    };
  }
  if (granularity === 'month') {
    const end = addDays(startOfMonth(today), -1);
    return {
      dateFrom: formatDate(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 4, 1))),
      dateTo: formatDate(end),
      includeCurrent: false,
    };
  }
  return {
    dateFrom: formatDate(addDays(today, -5)),
    dateTo: formatDate(addDays(today, -1)),
    includeCurrent: false,
  };
}

export function buildDetailPeriodOptions(
  granularity: TrendGranularity,
  dateFrom: string,
  dateTo: string,
): DetailPeriodOption[] {
  const rangeStart = parseDate(dateFrom);
  const rangeEnd = parseDate(dateTo);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd < rangeStart) return [];

  const options: DetailPeriodOption[] = [];
  let cursor = granularity === 'week'
    ? startOfIsoWeek(rangeStart)
    : granularity === 'month'
      ? startOfMonth(rangeStart)
      : rangeStart;

  while (cursor <= rangeEnd) {
    const naturalEnd = granularity === 'week'
      ? endOfIsoWeek(cursor)
      : granularity === 'month'
        ? endOfMonth(cursor)
        : cursor;
    const periodStart = cursor < rangeStart ? rangeStart : cursor;
    const periodEnd = naturalEnd > rangeEnd ? rangeEnd : naturalEnd;
    const startYmd = formatDate(periodStart);
    const endYmd = formatDate(periodEnd);
    options.push({
      key: granularity === 'month' ? startYmd.slice(0, 7) : startYmd,
      label: granularity === 'month'
        ? `${startYmd.slice(0, 4)}年${startYmd.slice(5, 7)}月`
        : granularity === 'week'
          ? `${startYmd} 至 ${endYmd}`
          : startYmd,
      dateFrom: startYmd,
      dateTo: endYmd,
    });
    cursor = granularity === 'week'
      ? addDays(cursor, 7)
      : granularity === 'month'
        ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
        : addDays(cursor, 1);
  }

  return options;
}

export function normalizeTrendRange(
  granularity: TrendGranularity,
  dateFrom: string,
  dateTo: string,
  includeCurrent: boolean,
  todayYmd: string,
): [string, string] {
  const today = parseDate(todayYmd);
  const yesterday = addDays(today, -1);
  let start = parseDate(dateFrom);
  let end = parseDate(dateTo);

  if (granularity === 'week') {
    start = startOfIsoWeek(start);
    end = endOfIsoWeek(end);
    const latest = includeCurrent ? yesterday : addDays(startOfIsoWeek(today), -1);
    if (end > latest) end = latest;
  } else if (granularity === 'month') {
    start = startOfMonth(start);
    end = endOfMonth(end);
    const latest = includeCurrent ? yesterday : addDays(startOfMonth(today), -1);
    if (end > latest) end = latest;
  } else if (end > yesterday) {
    end = yesterday;
  }

  if (granularity !== 'day' && end < start) {
    start = granularity === 'week' ? startOfIsoWeek(end) : startOfMonth(end);
  }
  return [formatDate(start), formatDate(end)];
}

export function toggleCurrentPeriod(
  granularity: TrendGranularity,
  range: Pick<TrendRange, 'dateFrom' | 'dateTo'>,
  includeCurrent: boolean,
  todayYmd: string,
): TrendRange {
  if (granularity === 'day') {
    const [, dateTo] = normalizeTrendRange('day', range.dateFrom, range.dateTo, includeCurrent, todayYmd);
    return { ...range, dateTo, includeCurrent };
  }

  const today = parseDate(todayYmd);
  const currentStart = granularity === 'week' ? startOfIsoWeek(today) : startOfMonth(today);
  const currentEnd = parseDate(range.dateTo);
  const end = includeCurrent
    ? addDays(today, -1)
    : currentEnd < currentStart
      ? currentEnd
      : addDays(currentStart, -1);
  return { ...range, dateTo: formatDate(end), includeCurrent };
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function startOfIsoWeek(value: Date): Date {
  const result = new Date(value);
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function endOfIsoWeek(value: Date): Date {
  return addDays(startOfIsoWeek(value), 6);
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}
