import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/layout/AppHeader';
import { ScreenState } from '@/components/states/ScreenState';
import { getConnectorSyncRunRecords, type ConnectorRecordTable } from '@/services/api/connectors';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { formatBeijingDateTime } from '@/utils/time';

type ConnectorRecordsScreenProps = {
  onBack: () => void;
  runId: string;
};

const pageSizes = [10, 20, 50, 100];

export function ConnectorRecordsScreen({ onBack, runId }: ConnectorRecordsScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const deviceOffline = useNetworkStore((state) => state.status === 'offline');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [table, setTable] = useState<ConnectorRecordTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestRevision, setRequestRevision] = useState(0);
  const requestNumber = useRef(0);
  const activeRunId = useRef(runId);

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    const isCurrent = () => request === requestNumber.current;
    let redirecting = false;
    if (!runId.trim()) {
      setLoading(false);
      setError('缺少同步运行 ID');
      setTable(null);
      return;
    }
    if (deviceOffline) {
      setLoading(false);
      setError(null);
      setTable(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextTable = await getConnectorSyncRunRecords(runId, page, pageSize);
      if (!isCurrent()) return;
      if (
        nextTable.total_pages >= 1
        && (page > nextTable.total_pages || nextTable.page > nextTable.total_pages)
      ) {
        redirecting = true;
        setPage(nextTable.total_pages);
        setRequestRevision((current) => current + 1);
        return;
      }
      setTable(nextTable);
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : '同步结果加载失败，请稍后重试');
    } finally {
      if (isCurrent() && !redirecting) setLoading(false);
    }
  }, [deviceOffline, page, pageSize, requestRevision, runId]);

  useEffect(() => {
    if (activeRunId.current !== runId) {
      activeRunId.current = runId;
      requestNumber.current += 1;
      setPage(1);
      setTable(null);
      setError(null);
      setLoading(Boolean(runId.trim()) && !deviceOffline);
      setRequestRevision((current) => current + 1);
      return;
    }
    void load();
  }, [deviceOffline, load, runId]);
  useEffect(() => () => { requestNumber.current += 1; }, []);

  const cellWidth = (table?.columns.length ?? 0) <= 4 ? 96 : 140;
  const canGoPrevious = Boolean(table && page > 1 && !loading);
  const canGoNext = Boolean(table && page < table.total_pages && !loading);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <AppHeader leadingAction={{ type: 'back', onPress: onBack }} title="同步结果" />
      {deviceOffline ? <ScreenState description="当前离线，无法加载同步结果" state="offline" /> : null}
      {!deviceOffline && loading && !table ? <ScreenState state="loading" /> : null}
      {!deviceOffline && !loading && error ? <ScreenState actionLabel="重新加载" description={error} onAction={() => void load()} state="error" /> : null}
      {!deviceOffline && !loading && !error && table && !table.rows.length ? <ScreenState description={table.message ?? '暂无同步记录'} state="empty" /> : null}
      {!deviceOffline && table && (loading || !error) && table.rows.length ? (
        <View style={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator testID="connector-records-table">
            <FlatList
              data={table.rows}
              keyExtractor={(_, index) => `${page}-${index}`}
              ListHeaderComponent={(
                <View style={styles.row}>
                  {table.columns.map((column) => (
                    <Text key={column.field} style={[styles.headerCell, { width: cellWidth }]}>{column.label}</Text>
                  ))}
                </View>
              )}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  {table.columns.map((column) => (
                    <Text key={column.field} numberOfLines={2} style={[styles.cell, { width: cellWidth }]}>
                      {recordCellText(column.field, item[column.field])}
                    </Text>
                  ))}
                </View>
              )}
              showsVerticalScrollIndicator={false}
            />
          </ScrollView>
          <View style={styles.pagination}>
            <Text style={styles.summary}>共 {table.total} 条，第 {table.page} / {table.total_pages} 页</Text>
            <View style={styles.pageSizes}>
              {pageSizes.map((size) => {
                const selected = size === pageSize;
                return (
                  <Pressable
                    accessibilityLabel={`每页 ${size} 条`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, selected }}
                    disabled={loading}
                    key={size}
                    onPress={() => {
                      setPage(1);
                      setPageSize(size);
                    }}
                    style={[styles.pageSize, selected && styles.pageSizeSelected]}
                  >
                    <Text style={[styles.pageSizeText, selected && styles.pageSizeTextSelected]}>{size}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.pageActions}>
              <Pressable
                accessibilityLabel="上一页"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canGoPrevious }}
                disabled={!canGoPrevious}
                onPress={() => setPage((current) => current - 1)}
                style={[styles.pageAction, !canGoPrevious && styles.pageActionDisabled]}
              >
                <ChevronLeft color={theme.text.primary} size={18} />
                <Text style={styles.pageActionText}>上一页</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="下一页"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canGoNext }}
                disabled={!canGoNext}
                onPress={() => setPage((current) => current + 1)}
                style={[styles.pageAction, !canGoNext && styles.pageActionDisabled]}
              >
                <Text style={styles.pageActionText}>下一页</Text>
                <ChevronRight color={theme.text.primary} size={18} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function recordCellText(field: string, value: string | number | null): string {
  if (value == null) return '-';
  if (field === 'business_time' && typeof value === 'string') return formatBeijingDateTime(value);
  return String(value);
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background.canvas, flex: 1 },
    content: { flex: 1, padding: 16 },
    row: { flexDirection: 'row' },
    headerCell: { backgroundColor: theme.background.subtle, borderBottomColor: theme.border.strong, borderBottomWidth: StyleSheet.hairlineWidth, color: theme.text.primary, fontSize: 13, fontWeight: '600', letterSpacing: 0, padding: 12 },
    cell: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, color: theme.text.secondary, fontSize: 13, letterSpacing: 0, minHeight: 48, padding: 12 },
    pagination: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 12, marginTop: 16, paddingTop: 16 },
    summary: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, textAlign: 'center' },
    pageSizes: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
    pageSize: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, height: 36, justifyContent: 'center', minWidth: 44 },
    pageSizeSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    pageSizeText: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0 },
    pageSizeTextSelected: { color: theme.action.onPrimary, fontWeight: '600' },
    pageActions: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
    pageAction: { alignItems: 'center', flexDirection: 'row', gap: 4, height: 44, justifyContent: 'center', minWidth: 104 },
    pageActionDisabled: { opacity: 0.4 },
    pageActionText: { color: theme.text.primary, fontSize: 14, letterSpacing: 0 },
  });
}
