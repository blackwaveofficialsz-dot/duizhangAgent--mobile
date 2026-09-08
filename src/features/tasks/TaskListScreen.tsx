import { AppState, type AppStateStatus, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { ScreenState } from '@/components/states/ScreenState';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatBeijingDateTime } from '@/utils/time';
import { useTaskStore } from './taskStore';
import { TaskCard } from './TaskCard';

const STATUS_FILTERS = [
  { label: '全部', value: undefined },
  { label: '等待中', value: 'pending' },
  { label: '进行中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
] as const;
const TYPE_FILTERS = [
  { label: '全部', value: undefined },
  { label: '文件解析', value: 'file_parsing' },
  { label: '对账', value: 'reconciliation' },
  { label: '连接器同步', value: 'connector_sync' },
  { label: '财务报表', value: 'finance_report' },
  { label: '人事同步', value: 'hr_sync' },
  { label: '工资表', value: 'salary_report' },
  { label: 'Research Agent', value: 'research' },
] as const;
const TASK_LIST_POLL_OWNER = 'task-list';

export function TaskListScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const { error, filters, isOffline: cacheOffline, lastSyncedAt, refresh, setFilters, setForeground, startPolling, status, stopPolling, tasks } = useTaskStore();
  const usingCache = cacheOffline || deviceOffline;
  const refreshTasks = useCallback(() => { if (!deviceOffline) void refresh(); }, [deviceOffline, refresh]);
  const filterTasks = useCallback((nextFilters: typeof filters) => {
    if (deviceOffline) return;
    setFilters(nextFilters);
    void refresh();
  }, [deviceOffline, refresh, setFilters]);

  useEffect(() => {
    void refresh();
    startPolling(TASK_LIST_POLL_OWNER);
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const isForeground = nextState === 'active';
      setForeground(isForeground);
      if (isForeground) void refresh();
    });
    return () => {
      subscription.remove();
      stopPolling(TASK_LIST_POLL_OWNER);
    };
  }, [refresh, setForeground, startPolling, stopPolling]);

  if (!tasks.length && (status === 'loading' || status === 'refreshing')) {
    return <ScreenState state="loading" />;
  }
  if (!tasks.length && status === 'error') {
    return <ScreenState actionLabel="重新加载" description={error ?? undefined} onAction={refreshTasks} state="error" />;
  }
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={tasks}
      keyExtractor={(task) => task.task_id ?? task.id}
      ListHeaderComponent={(
        <View style={styles.header}>
          <View>
            <Text style={styles.subheading}>{usingCache ? `离线查看 · 上次同步 ${formatBeijingDateTime(lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null)}` : '处理状态与可下载报告'}</Text>
          </View>
          <Pressable
            accessibilityLabel="刷新任务"
            accessibilityRole="button"
            accessibilityState={{ disabled: deviceOffline }}
            disabled={deviceOffline}
            onPress={refreshTasks}
            style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}
          >
            <RefreshCw color={theme.text.primary} size={20} strokeWidth={1.8} />
          </Pressable>
          <View style={styles.filters}>
            <FilterRow
              disabled={deviceOffline}
              label="状态"
              onChange={(nextStatus) => filterTasks({ ...filters, status: nextStatus })}
              options={STATUS_FILTERS}
              selected={filters.status}
              styles={styles}
            />
            <FilterRow
              disabled={deviceOffline}
              label="类型"
              onChange={(taskType) => filterTasks({ ...filters, taskType })}
              options={TYPE_FILTERS}
              selected={filters.taskType}
              styles={styles}
            />
          </View>
        </View>
      )}
      ListEmptyComponent={<ScreenState state="empty" />}
      refreshControl={(
        <RefreshControl
          colors={[theme.status.info]}
          enabled={!deviceOffline}
          onRefresh={refreshTasks}
          refreshing={status === 'refreshing'}
          tintColor={theme.status.info}
        />
      )}
      renderItem={({ item }) => (
        <TaskCard
          onPress={() => router.push({ pathname: '/tasks/[taskId]', params: { taskId: item.task_id ?? item.id } })}
          task={item}
        />
      )}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListFooterComponent={error ? <Text style={styles.error}>{error}</Text> : null}
    />
  );
}

type FilterStyles = ReturnType<typeof createStyles>;

function FilterRow({ disabled, label, onChange, options, selected, styles }: {
  disabled: boolean;
  label: string;
  onChange: (value?: string) => void;
  options: ReadonlyArray<{ label: string; value?: string }>;
  selected?: string;
  styles: FilterStyles;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView contentContainerStyle={styles.filterOptions} horizontal showsHorizontalScrollIndicator={false}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              accessibilityLabel={`${label}筛选：${option.label}`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: isSelected }}
              disabled={disabled}
              key={option.value ?? 'all'}
              onPress={() => onChange(option.value)}
              style={[styles.filterOption, isSelected && styles.filterOptionSelected]}
            >
              <Text style={[styles.filterOptionText, isSelected && styles.filterOptionTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    list: { flexGrow: 1, padding: 16 },
    header: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 },
    subheading: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    refresh: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    filters: { gap: 8, marginTop: 14, width: '100%' },
    filterRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44 },
    filterLabel: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, width: 30 },
    filterOptions: { gap: 6, paddingRight: 4 },
    filterOption: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
    filterOptionSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    filterOptionText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    filterOptionTextSelected: { color: theme.action.onPrimary, fontWeight: '600' },
    separator: { height: 10 },
    error: { color: theme.status.danger, fontSize: 13, letterSpacing: 0, paddingTop: 12, textAlign: 'center' },
    pressed: { opacity: 0.62 },
  });
}
