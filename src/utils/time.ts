const placeholder = '—';
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/i;
const beijingFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const beijingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function beijingToday(): string {
  return beijingDateFormatter.format(new Date());
}

export function beijingIsoNow(): string {
  const parts = Object.fromEntries(
    beijingFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

export function parseBeijingTimestamp(value: string): number | null {
  const match = dateTimePattern.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00', zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (!isValidDateTime(year, month, day, hour, minute, second)) return null;

  const normalized = value.replace(' ', 'T');
  const timestamp = Date.parse(zone ? normalized : `${normalized}+08:00`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function formatBeijingDateTime(value: string | null | undefined): string {
  if (!value) return placeholder;
  const match = dateTimePattern.exec(value);
  if (!match) return placeholder;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00', zone] = match;
  const values = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = values;

  if (!isValidDateTime(year, month, day, hour, minute, second)) return placeholder;
  if (!zone) return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}`;

  const timestamp = parseBeijingTimestamp(value);
  if (timestamp === null) return placeholder;
  const date = new Date(timestamp);

  const parts = Object.fromEntries(
    beijingFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function isValidDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}
