import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { ConnectorQueryMetadata, KnowledgeContext, MessageItem, QueryEvidence, QueryExportInfo } from '@/types/chat';
import { EvidenceBlock } from './EvidenceBlock';
import { AgentActivityBlock } from './AgentActivityBlock';
import { ChatDefaultOverview } from './ChatDefaultOverview';
import { TaskMessageBlock } from './TaskMessageBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { parseMarkdownTables, type MarkdownTable } from './chatTables';
import { StructuredResponseRenderer } from './StructuredResponseRenderer';
import { isClarificationAction, type AgentResponseAction, type ChatInteraction } from '@/types/agentResponse';

type ChatMessageListProps = {
  messages: MessageItem[];
  onRetry: () => void;
  isRetryDisabled?: boolean;
  onOpenAlerts?: () => void;
  onOpenOrders?: () => void;
  onOpenTask?: (taskId: string) => void;
  onOpenTable?: (messageId: string, tableIndex: number) => void;
  onPrompt?: (message: string, interaction?: ChatInteraction) => Promise<void>;
  promptDisabled?: boolean;
};

const INLINE_TABLE_MAX_COLUMNS = 3;
const INLINE_TABLE_MAX_ROWS = 3;
const INLINE_TABLE_MAX_CELL_WEIGHT = 7.5;
const INLINE_TABLE_MAX_CHARACTERS = 280;
const INLINE_TABLE_ROW_HEIGHT = 44;

export function ChatMessageList({
  isRetryDisabled = false,
  messages,
  onOpenAlerts,
  onOpenOrders,
  onOpenTable,
  onOpenTask,
  onPrompt,
  onRetry,
  promptDisabled = false,
}: ChatMessageListProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const listRef = useRef<FlatList<MessageItem>>(null);
  const scrollScheduler = useMemo(() => createScrollScheduler(
    (options) => listRef.current?.scrollToEnd(options),
  ), []);
  const lastMessage = messages[messages.length - 1];
  const retryMessageId = lastMessage?.interrupted ? lastMessage.id : null;
  const [expandedTableKeys, setExpandedTableKeys] = useState<Set<string>>(() => new Set());

  const toggleTable = (key: string) => setExpandedTableKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const onStructuredAction = async (action: AgentResponseAction): Promise<void> => {
    if (!onPrompt || !isClarificationAction(action)) throw new Error('invalid clarification action');
    await onPrompt(action.params.message, {
      kind: 'clarification_choice',
      source_turn_id: action.source_turn_id,
      candidate_id: action.params.candidate_id,
    });
  };

  useEffect(() => () => scrollScheduler.cancel(), [scrollScheduler]);

  return (
    <FlatList
      contentContainerStyle={[styles.list, !messages.length && styles.emptyList]}
      data={messages}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(message) => message.id}
      ListEmptyComponent={(
        <ChatDefaultOverview
          onOpenAlerts={onOpenAlerts}
          onOpenOrders={onOpenOrders}
          onPrompt={onPrompt}
          promptDisabled={promptDisabled || !onPrompt}
        />
      )}
      onContentSizeChange={() => scrollScheduler.schedule(!lastMessage?.streaming)}
      ref={listRef}
      style={styles.container}
      testID="chat-message-list"
      renderItem={({ item }) => {
        if (item.role === 'tool_call' && item.toolCall) {
          return <ToolCallBlock toolCall={item.toolCall} />;
        }
        const user = item.role === 'user';
        const parsedTables = user || item.agentResponse ? null : parseMarkdownTables(item.content);
        const contentBlocks = user
          ? [{ text: item.content, type: 'text' as const }]
          : parsedTables?.blocks ?? [];
        const structured = !user && Boolean(item.agentResponse);
        const connectorQuery = getConnectorQueryMetadata(item.metadata);
        const answer = (
          <>
            {structured && item.agentResponse ? (
              <>
                {item.streaming && item.content ? (
                  <View style={styles.agentBubble} testID={`message-${item.id}-text-0`}><Text style={styles.messageText}>{item.content}</Text></View>
                ) : null}
                <StructuredResponseRenderer
                  expandedTableKeys={expandedTableKeys}
                  messageId={item.id}
                  onAction={onStructuredAction}
                  onOpenTable={onOpenTable}
                  onPrompt={onPrompt ?? emptyPrompt}
                  onToggleTable={toggleTable}
                  promptDisabled={promptDisabled || !onPrompt}
                  response={item.agentResponse}
                />
              </>
            ) : contentBlocks.map((block, blockIndex) => block.type === 'text' ? (
              <View key={`${item.id}-text-${blockIndex}`} style={[styles.bubble, user ? styles.userBubble : styles.agentBubble]} testID={`message-${item.id}-text-${blockIndex}`}>
                <Text style={[styles.messageText, user && styles.userText]}>{block.text}</Text>
              </View>
            ) : (
              <TableResultBlock key={`${item.id}-table-${block.tableIndex}`} messageId={item.id} onOpenTable={onOpenTable} table={block.table} tableIndex={block.tableIndex} />
            ))}
            {((!structured && !contentBlocks.length) || item.interrupted) ? (
              <View style={[styles.bubble, user ? styles.userBubble : styles.agentBubble]}>
                {!contentBlocks.length && item.streaming && !item.activity ? <Text style={styles.streamingText}>正在回复...</Text> : null}
                {item.interrupted ? (
                  <View style={styles.interrupted}>
                    <Text accessibilityRole="alert" style={styles.interruptedText}>回复中断</Text>
                    {item.id === retryMessageId ? (
                      <Pressable
                        accessibilityLabel="重试中断的消息"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isRetryDisabled }}
                        disabled={isRetryDisabled}
                        onPress={onRetry}
                        style={({ pressed }) => [styles.retryButton, isRetryDisabled && styles.retryDisabled, pressed && styles.pressed]}
                      >
                        <Text style={styles.retryText}>重试</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        );
        return (
          <View
            style={[styles.message, user ? styles.userMessage : styles.agentMessage]}
            testID={`message-${item.id}`}
          >
            {!user && item.activity ? (
              <View style={styles.assistantTurn}>
                <AgentActivityBlock activity={item.activity} testID={`agent-activity-${item.id}`} />
                <View testID={`message-${item.id}-answer`}>{answer}</View>
              </View>
            ) : answer}
            {!user && item.task_id && onOpenTask ? <TaskMessageBlock onOpen={onOpenTask} taskId={item.task_id} /> : null}
            {!user && connectorQuery ? <EvidenceBlock connectorQuery={connectorQuery} /> : null}
          </View>
        );
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}

const emptyPrompt = async (_message: string, _interaction?: ChatInteraction): Promise<void> => {};

type ScrollScheduler = {
  cancel: () => void;
  schedule: (animated: boolean) => void;
};

export function createScrollScheduler(
  scrollToEnd: (options: { animated: boolean }) => void,
): ScrollScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingAnimated = true;
  return {
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingAnimated = true;
    },
    schedule: (animated) => {
      pendingAnimated = timer ? pendingAnimated && animated : animated;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const nextAnimated = pendingAnimated;
        pendingAnimated = true;
        scrollToEnd({ animated: nextAnimated });
      }, 32);
    },
  };
}

function TableResultBlock({ messageId, onOpenTable, table, tableIndex }: { messageId: string; onOpenTable?: (messageId: string, tableIndex: number) => void; table: MarkdownTable; tableIndex: number }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createTableStyles(theme), [theme]);
  const displayInline = canDisplayInline(table);
  return (
    <View style={[styles.block, displayInline && styles.inlineBlock]} testID={`message-${messageId}-table-${tableIndex}`}>
      <Text style={styles.summary}>{table.columns.length} 列 · {table.rows.length} 行</Text>
      {displayInline ? <TableGrid table={table} testID={`table-scroll-${messageId}`} styles={styles} /> : null}
      {!displayInline ? table.rows.slice(0, 3).map((row, index) => <Text key={`${messageId}-${index}`} numberOfLines={1} style={styles.preview}>{row.join(' · ')}</Text>) : null}
      {!displayInline && onOpenTable ? <Pressable accessibilityLabel="打开完整表格" accessibilityRole="button" onPress={() => onOpenTable(messageId, tableIndex)} style={styles.button}><Text style={styles.buttonText}>打开完整表格</Text></Pressable> : null}
    </View>
  );
}

function TableGrid({ table, testID, styles }: { table: MarkdownTable; testID: string; styles: ReturnType<typeof createTableStyles> }) {
  return (
    <ScrollView horizontal style={[styles.inlineTable, { height: inlineTableHeight(table) }]} testID={testID}>
      <View>
        <View style={[styles.tableRow, styles.headerRow]}>{table.columns.map((column) => <Text key={column} numberOfLines={1} style={[styles.cell, styles.headerCell]}>{column}</Text>)}</View>
        {table.rows.map((row, index) => <View key={`${testID}-${index}`} style={styles.tableRow}>{row.map((cell, cellIndex) => <Text key={`${cellIndex}-${cell}`} numberOfLines={1} style={styles.cell}>{cell}</Text>)}</View>)}
      </View>
    </ScrollView>
  );
}

function canDisplayInline(table: MarkdownTable): boolean {
  if (table.columns.length > INLINE_TABLE_MAX_COLUMNS || table.rows.length > INLINE_TABLE_MAX_ROWS) return false;
  const cells = [...table.columns, ...table.rows.flat()];
  return cells.every((cell) => inlineCellWeight(cell) <= INLINE_TABLE_MAX_CELL_WEIGHT)
    && cells.join('').length <= INLINE_TABLE_MAX_CHARACTERS;
}

function inlineCellWeight(cell: string): number {
  return [...cell].reduce((total, character) => total + (character.charCodeAt(0) > 0x7f ? 1 : 0.6), 0);
}

function inlineTableHeight(table: MarkdownTable): number {
  return (table.rows.length + 1) * INLINE_TABLE_ROW_HEIGHT;
}

function getConnectorQueryMetadata(metadata: unknown): ConnectorQueryMetadata | null {
  const connectorQuery = record(metadata)?.connector_query;
  const source = record(connectorQuery);
  if (!source) return null;
  const evidence = normalizeEvidence(source.evidence);
  const knowledgeSuggestion = normalizeKnowledgeSuggestion(source.knowledge_suggestion);
  const exportInfo = normalizeExport(source.export);
  const knowledgeContext = normalizeKnowledgeContext(source.knowledge_context);
  return evidence || knowledgeSuggestion || exportInfo?.available || knowledgeContext
    ? { evidence, knowledge_suggestion: knowledgeSuggestion, export: exportInfo, knowledge_context: knowledgeContext }
    : null;
}

function normalizeEvidence(value: unknown): QueryEvidence | null {
  const source = record(value);
  if (!source) return null;
  const dateRange = record(source.date_range);
  const rowCounts = record(source.row_counts);
  return {
    dataset_name: text(source.dataset_name),
    date_range: { from: nullableText(dateRange?.from), to: nullableText(dateRange?.to) },
    scope: text(source.scope),
    fields: labels(source.fields),
    filters: Array.isArray(source.filters) ? source.filters.flatMap((item) => {
      const filter = record(item);
      return filter ? [{ field: text(filter.field) || '条件', op: text(filter.op) || '匹配', value: filter.value }] : [];
    }) : [],
    group_by: labels(source.group_by),
    metrics: labels(source.metrics),
    knowledge_entries: labels(source.knowledge_entries),
    row_counts: { returned: count(rowCounts?.returned), truncated: rowCounts?.truncated === true },
    warnings: labels(source.warnings),
  };
}

function normalizeKnowledgeSuggestion(value: unknown): ConnectorQueryMetadata['knowledge_suggestion'] {
  const source = record(value);
  if (!source) return null;
  const title = text(source.title);
  const content = text(source.content);
  return title || content ? { title, content } : null;
}

function normalizeExport(value: unknown): QueryExportInfo | null {
  const source = record(value);
  if (!source) return null;
  return {
    available: source.available === true,
    total: count(source.total),
    returned: count(source.returned),
    truncated: source.truncated === true,
    dataset_name: text(source.dataset_name),
  };
}

function normalizeKnowledgeContext(value: unknown): KnowledgeContext | null {
  const source = record(value);
  if (!source) return null;
  const context = { suggestions: labels(source.suggestions), trace: labels(source.trace), missing: labels(source.missing) };
  return context.suggestions.length || context.trace.length || context.missing.length ? context : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function labels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const primitive = text(item);
    if (primitive) return primitive;
    const source = record(item);
    return text(source?.title) || text(source?.name) || text(source?.content) || text(source?.category) || text(source?.kind) || (source ? '已提供' : '');
  }).filter(Boolean);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function createTableStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: { marginTop: 8 },
    inlineBlock: { backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
    summary: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    preview: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 20, marginTop: 3 },
    button: { alignItems: 'flex-start', justifyContent: 'center', minHeight: 44 },
    buttonText: { color: theme.action.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
    inlineTable: { flexGrow: 0 },
    tableRow: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 44 },
    headerRow: { backgroundColor: theme.background.subtle },
    cell: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 18, padding: 8, width: 112 },
    headerCell: { color: theme.text.primary, fontWeight: '700' },
  });
}


function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    list: {
      flexGrow: 1,
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    emptyList: {
      justifyContent: 'flex-start',
    },
    message: {
      maxWidth: '84%',
    },
    userMessage: {
      alignSelf: 'flex-end',
    },
    agentMessage: {
      alignSelf: 'flex-start',
    },
    assistantTurn: {
      gap: 8,
    },
    bubble: {
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    userBubble: {
      backgroundColor: theme.action.primary,
    },
    agentBubble: {
      backgroundColor: theme.background.surface,
      borderColor: theme.border.default,
      borderWidth: StyleSheet.hairlineWidth,
    },
    messageText: {
      color: theme.text.primary,
      fontSize: 16,
      letterSpacing: 0,
      lineHeight: 24,
    },
    userText: {
      color: theme.action.onPrimary,
    },
    streamingText: {
      color: theme.text.muted,
      fontSize: 14,
      letterSpacing: 0,
      lineHeight: 22,
    },
    interrupted: {
      alignItems: 'center',
      borderTopColor: theme.border.default,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      marginTop: 8,
      paddingTop: 8,
    },
    interruptedText: {
      color: theme.status.danger,
      fontSize: 13,
      letterSpacing: 0,
    },
    retryButton: {
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    retryDisabled: {
      opacity: 0.45,
    },
    retryText: {
      color: theme.action.primary,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 0,
    },
    pressed: {
      opacity: 0.62,
    },
  });
}
