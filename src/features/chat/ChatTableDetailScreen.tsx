import { ArrowLeft } from 'lucide-react-native';
import { useMemo } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenState } from '@/components/states/ScreenState';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { MarkdownTable } from './chatTables';

type Props = { onClose: () => void; table: MarkdownTable | null };
const COMPACT_CELL_WIDTH = 96;
const DEFAULT_CELL_WIDTH = 140;

export function ChatTableDetailScreen({ onClose, table }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!table) return <ScreenState actionLabel="返回对话" onAction={onClose} state="empty" />;
  const cellWidth = table.columns.length <= 4 ? COMPACT_CELL_WIDTH : DEFAULT_CELL_WIDTH;
  const tableWidth = Math.max(320, table.columns.length * cellWidth);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回对话" accessibilityRole="button" onPress={onClose} style={styles.backButton}>
          <ArrowLeft color={theme.text.primary} size={20} />
        </Pressable>
        <View style={styles.heading}><Text style={styles.title}>表格结果</Text><Text style={styles.meta}>{table.columns.length} 列 · {table.rows.length} 行</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.horizontalContent} directionalLockEnabled horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles.horizontal} testID="table-detail-horizontal">
        <FlatList
          data={table.rows}
          initialNumToRender={20}
          keyExtractor={(_, index) => String(index)}
          ListHeaderComponent={<TableRow cellWidth={cellWidth} cells={table.columns} header styles={styles} />}
          maxToRenderPerBatch={20}
          nestedScrollEnabled
          renderItem={({ item }) => <TableRow cellWidth={cellWidth} cells={item} styles={styles} />}
          showsVerticalScrollIndicator
          style={[styles.list, { width: tableWidth }]}
          testID="table-detail-list"
          windowSize={7}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function TableRow({ cellWidth, cells, header = false, styles }: { cellWidth: number; cells: string[]; header?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={[styles.row, header && styles.headerRow]}>{cells.map((cell, index) => <Text key={`${index}-${cell}`} style={[styles.cell, { width: cellWidth }, header && styles.headerCell]}>{cell || '-'}</Text>)}</View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.background.canvas, flex: 1 },
    header: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 56, paddingRight: 16 },
    backButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 52 },
    heading: { flex: 1 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '400', letterSpacing: 0 },
    meta: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 2 },
    horizontal: { flex: 1 },
    horizontalContent: { alignItems: 'stretch', flexGrow: 1 },
    list: { flex: 1 },
    row: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 48 },
    headerRow: { backgroundColor: theme.background.subtle },
    cell: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 10 },
    headerCell: { color: theme.text.primary, fontWeight: '600' },
  });
}
