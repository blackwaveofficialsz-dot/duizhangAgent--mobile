import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

type Props = {
  dateFrom: string;
  dateTo: string;
  maxDate: string;
  onChange: (dateFrom: string, dateTo: string) => void;
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function AnalyticsCalendar({ dateFrom, dateTo, maxDate, onChange }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [month, setMonth] = useState(() => monthKey(dateTo || maxDate));
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const cells = useMemo(() => monthCells(month), [month]);
  const nextDisabled = month >= monthKey(maxDate);

  const selectDate = (date: string) => {
    if (date > maxDate) return;
    if (!selectionStart || date < selectionStart) {
      setSelectionStart(date);
      onChange(date, date);
      return;
    }
    onChange(selectionStart, date);
    setSelectionStart(null);
  };

  return <View style={styles.container} testID="analytics-calendar">
    <View style={styles.header}>
      <Pressable accessibilityLabel="上个月" accessibilityRole="button" onPress={() => setMonth(shiftMonth(month, -1))} style={styles.iconButton}>
        <ChevronLeft color={theme.text.primary} size={18} />
      </Pressable>
      <Text style={styles.month}>{month.slice(0, 4)}年{Number(month.slice(5))}月</Text>
      <Pressable accessibilityLabel="下个月" accessibilityRole="button" accessibilityState={{ disabled: nextDisabled }} disabled={nextDisabled} onPress={() => setMonth(shiftMonth(month, 1))} style={[styles.iconButton, nextDisabled && styles.disabled]}>
        <ChevronRight color={theme.text.primary} size={18} />
      </Pressable>
    </View>
    <View style={styles.grid}>
      {WEEKDAYS.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
      {cells.map((date, index) => {
        if (!date) return <View key={`blank-${index}`} style={styles.cell} />;
        const disabled = date > maxDate;
        const edge = date === dateFrom || date === dateTo;
        const inRange = date >= dateFrom && date <= dateTo;
        return <View key={date} style={[styles.cell, inRange && styles.rangeCell]}>
          <Pressable
            accessibilityLabel={`选择日期 ${date}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: edge }}
            disabled={disabled}
            onPress={() => selectDate(date)}
            style={[styles.day, edge && styles.daySelected]}
          >
            <Text style={[styles.dayText, disabled && styles.disabledText, edge && styles.dayTextSelected]}>{Number(date.slice(-2))}</Text>
          </Pressable>
        </View>;
      })}
    </View>
  </View>;
}

function monthCells(month: string): Array<string | null> {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  ];
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, padding: 8 },
    header: { alignItems: 'center', flexDirection: 'row', height: 40, justifyContent: 'space-between' },
    iconButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
    disabled: { opacity: 0.4 },
    month: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    weekday: { color: theme.text.muted, fontSize: 11, letterSpacing: 0, lineHeight: 28, textAlign: 'center', width: '14.2857%' },
    cell: { alignItems: 'center', height: 38, justifyContent: 'center', width: '14.2857%' },
    rangeCell: { backgroundColor: theme.background.subtle },
    day: { alignItems: 'center', borderRadius: 8, height: 34, justifyContent: 'center', width: 34 },
    daySelected: { backgroundColor: theme.action.primary },
    dayText: { color: theme.text.primary, fontSize: 13, letterSpacing: 0 },
    dayTextSelected: { color: theme.action.onPrimary, fontWeight: '600' },
    disabledText: { color: theme.text.muted },
  });
}
