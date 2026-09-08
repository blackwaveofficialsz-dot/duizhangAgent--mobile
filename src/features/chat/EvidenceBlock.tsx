import { ChevronDown, ChevronUp, Database } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { ConnectorQueryMetadata, QueryEvidence } from '@/types/chat';

type EvidenceBlockProps = { connectorQuery: ConnectorQueryMetadata };

export function EvidenceBlock({ connectorQuery }: EvidenceBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  const evidence = connectorQuery.evidence;
  const knowledge = connectorQuery.knowledge_suggestion;
  const exportInfo = connectorQuery.export;
  const suggestions = connectorQuery.knowledge_context?.suggestions?.filter(Boolean) ?? [];
  const trace = connectorQuery.knowledge_context?.trace ?? [];
  const missing = connectorQuery.knowledge_context?.missing ?? [];
  const hasContent = Boolean(evidence || knowledge || exportInfo?.available || suggestions.length || trace.length || missing.length);
  if (!hasContent) return null;

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityLabel={expanded ? '收起查询依据' : '展开查询依据'}
        accessibilityRole="button"
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
      >
        <Database color={theme.status.info} size={18} strokeWidth={2} />
        <View style={styles.summaryText}>
          <Text style={styles.title}>查询依据</Text>
          <Text numberOfLines={1} style={styles.caption}>{summary(evidence, exportInfo)}</Text>
        </View>
        {expanded ? <ChevronUp color={theme.text.secondary} size={18} /> : <ChevronDown color={theme.text.secondary} size={18} />}
      </Pressable>
      {expanded ? (
        <View style={styles.detail}>
          {evidence ? <EvidenceDetails evidence={evidence} styles={styles} /> : null}
          {knowledge ? <Row label="知识建议" styles={styles} value={`${knowledge.title}${knowledge.content ? `：${knowledge.content}` : ''}`} /> : null}
          {suggestions.length ? <Row label="待补知识" styles={styles} value={suggestions.join('；')} /> : null}
          {trace.length ? <Row label="应用知识" styles={styles} value={trace.join('；')} /> : null}
          {missing.length ? <Row label="缺少知识" styles={styles} value={missing.join('；')} /> : null}
          {exportInfo?.available ? <Row label="导出" styles={styles} value={`可导出 ${exportInfo.total} 条${exportInfo.truncated ? '（当前结果已截断）' : ''}`} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function EvidenceDetails({ evidence, styles }: { evidence: QueryEvidence; styles: ReturnType<typeof createStyles> }) {
  const range = evidence.date_range.from ? `${evidence.date_range.from} 至 ${evidence.date_range.to ?? ''}` : '不限';
  return (
    <>
      <Row label="数据集" styles={styles} value={evidence.dataset_name || '未命名数据集'} />
      <Row label="日期范围" styles={styles} value={range} />
      <Row label="范围" styles={styles} value={evidence.scope || '未限定'} />
      {evidence.fields.length ? <Row label="字段" styles={styles} value={evidence.fields.join('、')} /> : null}
      {evidence.filters.length ? <Row label="筛选" styles={styles} value={evidence.filters.map((item) => `${item.field} ${item.op} ${formatValue(item.value)}`).join('；')} /> : null}
      {evidence.group_by.length ? <Row label="分组" styles={styles} value={evidence.group_by.join('、')} /> : null}
      {evidence.metrics.length ? <Row label="指标" styles={styles} value={evidence.metrics.join('、')} /> : null}
      <Row label="返回行数" styles={styles} value={`${evidence.row_counts.returned} 条${evidence.row_counts.truncated ? '（已截断）' : ''}`} />
      {evidence.warnings.length ? <Row label="警告" styles={styles} value={evidence.warnings.join('；')} /> : null}
    </>
  );
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.row}><Text style={styles.label}>{label}：</Text>{value}</Text>;
}

function summary(evidence: QueryEvidence | null | undefined, exportInfo: ConnectorQueryMetadata['export']): string {
  if (evidence) {
    const range = evidence.date_range.from ? `${evidence.date_range.from} 至 ${evidence.date_range.to ?? ''}` : '不限';
    return `${evidence.dataset_name || '未命名数据集'} · ${range} · ${evidence.row_counts.returned} 条${evidence.row_counts.truncated ? '（已截断）' : ''}`;
  }
  return exportInfo?.available ? `可导出 ${exportInfo.total} 条` : '包含知识建议';
}

function formatValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '已设置';
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: { backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginTop: 8 },
    summary: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
    summaryText: { flex: 1, minWidth: 0 },
    title: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    caption: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, marginTop: 1 },
    detail: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 5, padding: 12 },
    row: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
    label: { color: theme.text.primary, fontWeight: '600' },
    pressed: { opacity: 0.72 },
  });
}
