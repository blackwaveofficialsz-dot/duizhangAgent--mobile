import type { ChatSession } from '@/types/chat';
import { formatBeijingDateTime } from '@/utils/time';

export type SessionGroup = {
  label: '今天' | '过去 7 天' | '更早';
  sessions: ChatSession[];
};

const labels = ['今天', '过去 7 天', '更早'] as const;

export function groupSessions(sessions: ChatSession[], now = new Date()): SessionGroup[] {
  const today = beijingDate(now);
  const grouped = new Map<SessionGroup['label'], ChatSession[]>();

  for (const session of sessions) {
    const date = formatBeijingDateTime(session.updated_at).slice(0, 10);
    const daysAgo = calendarDayDifference(today, date);
    const label = daysAgo === 0 ? '今天' : daysAgo > 0 && daysAgo <= 7 ? '过去 7 天' : '更早';
    const entries = grouped.get(label) ?? [];
    entries.push(session);
    grouped.set(label, entries);
  }

  return labels.flatMap((label) => {
    const entries = grouped.get(label);
    return entries ? [{ label, sessions: entries }] : [];
  });
}

function beijingDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarDayDifference(today: string, date: string): number {
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  return Math.round((Date.UTC(todayYear, todayMonth - 1, todayDay) - Date.UTC(year, month - 1, day)) / 86_400_000);
}
