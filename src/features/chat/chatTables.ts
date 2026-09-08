import type { AgentResponseColumn, AgentResponsePart } from '@/types/agentResponse';
import type { MessageItem } from '@/types/chat';

export type MarkdownTable = { columns: string[]; rows: string[][]; text: string };
export type MarkdownContentBlock =
  | { type: 'table'; table: MarkdownTable; tableIndex: number }
  | { type: 'text'; text: string };
export type ParsedMarkdownTables = { blocks: MarkdownContentBlock[]; tables: MarkdownTable[]; text: string };
export type AgentTablePart = AgentResponsePart & { columns: AgentResponseColumn[]; kind: 'table'; preview_rows: Array<Record<string, unknown>> };

export function isAgentTablePart(part: AgentResponsePart): part is AgentTablePart {
  return part.kind === 'table' && Array.isArray(part.columns) && Array.isArray(part.preview_rows);
}

export function tablePartToMarkdownTable(part: AgentTablePart): MarkdownTable {
  return {
    columns: part.columns.map((column) => column.label),
    rows: part.preview_rows.map((row) => part.columns.map((column) => formatAgentValue(
      row[column.key], column.format ?? column.data_type, column.unit, column.key,
    ))),
    text: '',
  };
}

export function tableFromMessage(message: MessageItem, tableIndex: number): MarkdownTable | null {
  const tablePart = message.agentResponse?.parts.filter(isAgentTablePart)[tableIndex];
  return tablePart ? tablePartToMarkdownTable(tablePart) : parseMarkdownTables(message.content).tables[tableIndex] ?? null;
}

export function parseMarkdownTable(content: string): MarkdownTable | null {
  const parsed = parseMarkdownTables(content);
  return parsed.tables[0] ? { ...parsed.tables[0], text: parsed.text } : null;
}

export function parseMarkdownTables(content: string): ParsedMarkdownTables {
  const lines = content.split('\n');
  const tables: MarkdownTable[] = [];
  const blocks: MarkdownContentBlock[] = [];
  const textLines: string[] = [];
  const pendingTextLines: string[] = [];
  let index = 0;
  let fence: Fence | null = null;

  const appendText = (line: string) => {
    textLines.push(line);
    pendingTextLines.push(line);
  };
  const flushTextBlock = () => {
    const text = pendingTextLines.join('\n').trim();
    pendingTextLines.length = 0;
    if (text) blocks.push({ text, type: 'text' });
  };

  while (index < lines.length) {
    const marker = fenceMarker(lines[index]);
    if (fence) {
      appendText(lines[index]);
      if (isFenceClose(lines[index], fence)) fence = null;
      index += 1;
      continue;
    }
    if (marker) {
      fence = marker;
      appendText(lines[index]);
      index += 1;
      continue;
    }

    const columns = tableCells(lines[index]);
    if (!columns || !isDivider(lines[index + 1] ?? '', columns.length)) {
      appendText(lines[index]);
      index += 1;
      continue;
    }

    const rows: string[][] = [];
    let end = index + 2;
    while (end < lines.length) {
      if (isTableStart(lines, end)) break;
      const row = tableCells(lines[end]);
      if (!row) break;
      rows.push(normalizeBodyRow(row, columns.length));
      end += 1;
    }

    if (!rows.length) {
      appendText(lines[index]);
      index += 1;
      continue;
    }

    flushTextBlock();
    const table = { columns, rows, text: '' };
    const tableIndex = tables.length;
    tables.push(table);
    blocks.push({ table, tableIndex, type: 'table' });
    index = end;
  }

  flushTextBlock();
  return { blocks, tables, text: textLines.join('\n').trim() };
}

export function formatAgentValue(value: unknown, format?: string, unit?: string, semanticKey?: string): string {
  if (value == null) return '—';
  if (semanticKey === 'comparison_status') {
    if (value === 'comparable') return '可比';
    if (value === 'not_comparable') return '不可比';
    console.warn('[AgentResponse] unsupported comparison state');
    return '未知';
  }
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value === 'string') {
    const numeric = /^-?\d+(?:\.\d+)?$/.test(value);
    if (!unit) return format === 'decimal' && numeric ? groupDecimal(value) : value;
    const normalizedUnit = unit.toLowerCase();
    if (numeric && normalizedUnit === 'ratio') {
      return `${(Number(value) * 100).toFixed(1).replace(/\.0$/, '')}%`;
    }
    const grouped = numeric ? groupDecimal(value) : value;
    if (normalizedUnit === '元/工时') return `${grouped}元/工时`;
    if (normalizedUnit === 'cny') return `¥${grouped}`;
    if (normalizedUnit === 'cny/hour' || normalizedUnit === 'cny_per_hour') return `¥${grouped}/工时`;
    const label = unitLabel(normalizedUnit);
    if (label) return `${grouped}${label}`;
    console.warn('[AgentResponse] unsupported display unit');
    return grouped;
  }
  if (typeof value === 'boolean') return String(value);
  return '—';
}

function groupDecimal(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function unitLabel(unit: string): string | null {
  return ({
    order: '单', store: '家', hour: '小时', period: '期', product: '种', item: '件', person: '人',
  } as Record<string, string>)[unit] ?? null;
}

type Fence = { character: '`' | '~'; length: number };

function fenceMarker(line: string): Fence | null {
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { character: match[1][0] as Fence['character'], length: match[1].length };
}

function isFenceClose(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [...trimmed].every((character) => character === fence.character);
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== '|') continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && trimmed[cursor] === '\\'; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return true;
  }
  return false;
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || !looksLikeTableRow(trimmed)) return null;
  const cells: string[] = [];
  let cell = '';

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character !== '|') {
      cell += character;
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && trimmed[cursor] === '\\'; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 1) {
      cell = `${cell.slice(0, -1)}|`;
      continue;
    }
    cells.push(cell);
    cell = '';
  }
  cells.push(cell);

  if (trimmed.startsWith('|')) cells.shift();
  if (endsWithUnescapedPipe(trimmed)) cells.pop();
  return cells.length >= 1 ? cells : null;
}

function endsWithUnescapedPipe(line: string): boolean {
  if (!line.endsWith('|')) return false;
  let backslashes = 0;
  for (let index = line.length - 2; index >= 0 && line[index] === '\\'; index -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

function isTableStart(lines: string[], index: number): boolean {
  const columns = tableCells(lines[index]);
  return Boolean(columns && isDivider(lines[index + 1] ?? '', columns.length));
}

function tableCells(line: string): string[] | null {
  return splitTableRow(line)?.map(normalizeTableCell) ?? null;
}

function normalizeBodyRow(row: string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, index) => row[index] ?? '');
}

function normalizeTableCell(cell: string): string {
  return cell.trim()
    .replace(/^(\*\*|__)(.+)\1$/, '$2')
    .replace(/^([*_`])(.+)\1$/, '$2');
}

function isDivider(line: string, columns: number): boolean {
  const cells = tableCells(line);
  return Boolean(cells && cells.length === columns && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}
