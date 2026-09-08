import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { isClarificationAction, type AgentResponseAction, type AgentResponsePayload, type ClarificationAction } from '@/types/agentResponse';
import { formatAgentValue, isAgentTablePart, tablePartToMarkdownTable } from './chatTables';

type Props = {
  expandedTableKeys: ReadonlySet<string>;
  messageId: string;
  onAction?: (action: AgentResponseAction) => Promise<void>;
  onOpenTable?: (messageId: string, tableIndex: number) => void;
  onPrompt: (message: string) => Promise<void>;
  onToggleTable: (key: string) => void;
  promptDisabled: boolean;
  response: AgentResponsePayload;
};

const INLINE_ROW_LIMIT = 50;
const RESULT_STATUS_LABELS: Partial<Record<AgentResponsePayload['result_status'], string>> = {
  partial: '结果不完整',
  empty: '暂无可用数据',
  unavailable: '数据暂不可用',
  failed: '分析失败',
};

export function StructuredResponseRenderer({
  expandedTableKeys,
  messageId,
  onAction,
  onOpenTable,
  onPrompt,
  onToggleTable,
  promptDisabled,
  response,
}: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const payloadActionsBlocked = response.result_status === 'failed' || response.result_status === 'unavailable';
  const prompts = response.actions.filter(isPromptAction);
  const clarificationActions = response.actions.filter((action) => isClarificationAction(action, response.source_turn_id));
  let tableIndex = 0;

  const sendPrompt = (action: AgentResponseAction, message: string) => {
    if (promptDisabled || payloadActionsBlocked || pendingPromptId) return;
    setPendingPromptId(action.action_id);
    void Promise.resolve().then(() => onPrompt(message)).catch(() => {
      // useChatStream owns error Toast feedback for prompt sends.
    }).finally(() => setPendingPromptId(null));
  };

  const sendClarification = (action: ClarificationAction) => {
    if (promptDisabled || payloadActionsBlocked || pendingPromptId || !onAction) return;
    setPendingPromptId(action.action_id);
    void Promise.resolve().then(() => onAction(action)).catch(() => {
      // useChatStream owns error Toast feedback for clarification sends.
    }).finally(() => setPendingPromptId(null));
  };

  return (
    <View accessibilityLabel="结构化查询结果" style={styles.container}>
      {RESULT_STATUS_LABELS[response.result_status] ? <Text accessibilityRole="alert" style={styles.message}>{RESULT_STATUS_LABELS[response.result_status]}</Text> : null}
      {response.parts.map((part, index) => {
        if (part.kind === 'summary') {
          return (
            <View key={`summary-${index}`} style={styles.part}>
              {part.title ? <Text style={styles.title}>{part.title}</Text> : null}
              {part.metrics?.length ? <View style={styles.metrics}>{part.metrics.map((metric) => (
                <View key={metric.key} style={styles.metric}>
                  <Text style={styles.metricLabel}>{metric.label ?? metric.key}</Text>
                  <Text style={styles.metricValue}>{formatAgentValue(metric.value, undefined, metric.unit)}</Text>
                </View>
              ))}</View> : null}
            </View>
          );
        }
        if (part.kind === 'insights') {
          return (
            <View key={`insights-${index}`} style={styles.part}>
              {part.title ? <Text style={styles.title}>{part.title}</Text> : null}
              {part.items?.map((item) => <Text key={`${item.statement_type}-${item.text}`} style={styles.message}>{item.text}</Text>)}
            </View>
          );
        }
        if (isAgentTablePart(part)) {
          const currentTableIndex = tableIndex;
          tableIndex += 1;
          return (
            <StructuredTable
              expanded={expandedTableKeys.has(`${messageId}:${currentTableIndex}`)}
              key={`table-${part.table_id ?? index}`}
              messageId={messageId}
              onOpenTable={onOpenTable}
              onToggleTable={onToggleTable}
              part={part}
              styles={styles}
              tableIndex={currentTableIndex}
            />
          );
        }
        if (part.kind === 'notice') {
          return (
            <View key={`notice-${part.code ?? index}`} style={styles.part}>
              {part.title ? <Text style={styles.title}>{part.title}</Text> : null}
              {part.message ? <Text accessibilityRole="alert" style={styles.message}>{part.message}</Text> : null}
            </View>
          );
        }
        if (part.kind === 'clarification' && part.message) {
          return (
            <View key={`clarification-${index}`} style={styles.part}>
              <Text style={styles.message}>{part.message}</Text>
              {clarificationActions.length ? <View style={styles.prompts}>{clarificationActions.map((action) => {
                const disabled = promptDisabled || payloadActionsBlocked || pendingPromptId !== null || !onAction;
                return (
                  <Pressable
                    accessibilityLabel={action.label}
                    accessibilityRole="button"
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    key={action.action_id}
                    onPress={() => sendClarification(action)}
                    style={({ pressed }) => [styles.clarificationButton, disabled && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.promptText}>{action.label}</Text>
                  </Pressable>
                );
              })}</View> : null}
            </View>
          );
        }
        console.warn('[AgentResponse] unsupported response part');
        return null;
      })}
      {prompts.length ? <View style={styles.prompts}>{prompts.map((action) => {
        const message = promptMessage(action);
        const disabled = promptDisabled || payloadActionsBlocked || pendingPromptId !== null || !message;
        return (
          <Pressable
            accessibilityLabel={action.label}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            key={action.action_id}
            onPress={() => message && sendPrompt(action, message)}
            style={({ pressed }) => [styles.promptButton, disabled && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.promptText}>{action.label}</Text>
          </Pressable>
        );
      })}</View> : null}
    </View>
  );
}

function StructuredTable({ expanded, messageId, onOpenTable, onToggleTable, part, styles, tableIndex }: {
  expanded: boolean;
  messageId: string;
  onOpenTable?: (messageId: string, tableIndex: number) => void;
  onToggleTable: (key: string) => void;
  part: Parameters<typeof tablePartToMarkdownTable>[0];
  styles: ReturnType<typeof createStyles>;
  tableIndex: number;
}) {
  const table = tablePartToMarkdownTable(part);
  const key = `${messageId}:${tableIndex}`;
  const rows = expanded ? table.rows.slice(0, INLINE_ROW_LIMIT) : table.rows.slice(0, 3);
  const canToggle = table.rows.length > 3;
  return (
    <View style={styles.part}>
      {part.title ? <Text style={styles.title}>{part.title}</Text> : null}
      <Text style={styles.rowCount}>{part.row_count ?? table.rows.length} 行</Text>
      <ScrollView horizontal style={styles.table}>
        <View>
          <View style={[styles.tableRow, styles.headerRow]}>{table.columns.map((column) => <Text key={column} numberOfLines={1} style={[styles.tableCell, styles.headerCell]}>{column}</Text>)}</View>
          {rows.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.map((cell, cellIndex) => <Text key={`${cellIndex}-${cell}`} numberOfLines={1} style={styles.tableCell}>{cell}</Text>)}</View>)}
        </View>
      </ScrollView>
      {canToggle ? <Pressable accessibilityLabel={expanded ? '收起表格' : '展开表格'} accessibilityRole="button" onPress={() => onToggleTable(key)} style={styles.tableAction}><Text style={styles.tableActionText}>{expanded ? '收起表格' : '展开表格'}</Text></Pressable> : null}
      {onOpenTable ? <Pressable accessibilityLabel="打开完整表格" accessibilityRole="button" onPress={() => onOpenTable(messageId, tableIndex)} style={styles.tableAction}><Text style={styles.tableActionText}>打开完整表格</Text></Pressable> : null}
    </View>
  );
}

function isPromptAction(action: AgentResponseAction): boolean {
  return action.kind === 'prompt' && Boolean(promptMessage(action));
}

function promptMessage(action: AgentResponseAction): string | null {
  const value = action.params?.message;
  return typeof value === 'string' && value.trim() ? value : null;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 10, marginTop: 8, padding: 10 },
    part: { gap: 6 },
    title: { color: theme.text.primary, fontSize: 15, fontWeight: '700', letterSpacing: 0, lineHeight: 22 },
    message: { color: theme.text.secondary, fontSize: 14, letterSpacing: 0, lineHeight: 21 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    metric: { minWidth: 108 },
    metricLabel: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 18 },
    metricValue: { color: theme.text.primary, fontSize: 16, fontWeight: '700', letterSpacing: 0, lineHeight: 23 },
    rowCount: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 18 },
    table: { flexGrow: 0 },
    tableRow: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 38 },
    headerRow: { backgroundColor: theme.background.surface },
    tableCell: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 18, padding: 8, width: 112 },
    headerCell: { color: theme.text.primary, fontWeight: '700' },
    tableAction: { alignItems: 'flex-start', minHeight: 36, justifyContent: 'center' },
    tableActionText: { color: theme.action.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    promptButton: { borderColor: theme.action.primary, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
    clarificationButton: { borderColor: theme.action.primary, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
    promptText: { color: theme.action.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.62 },
  });
}
