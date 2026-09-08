import type { MessageItem, SessionDetailResponse } from '@/types/chat';
import type { AgentResponsePayload } from '@/types/agentResponse';

export const validAgentResponse: AgentResponsePayload = {
  version: 1,
  domain: 'analytics',
  task: 'labor_efficiency',
  result_status: 'ok',
  result_id: 'labor-turn-1',
  source_turn_id: 'turn-1',
  content: '凤八店本周实际人效为 82.46 元/工时。',
  parts: [
    { kind: 'summary', metrics: [{ key: 'actual_efficiency', label: '实际人效', value: '82.46', unit: '元/工时' }] },
    { kind: 'insights', items: [{ statement_type: 'fact', text: '实际工时低于排班工时。', evidence_refs: ['labor:2026-W33'] }] },
    {
      kind: 'table',
      title: '门店人效',
      columns: [{ key: 'store_name', label: '门店' }, { key: 'actual_efficiency', label: '实际人效', format: 'decimal' }],
      row_count: 4,
      preview_rows: [{ store_name: '凤八店', actual_efficiency: '82.46' }],
    },
    { kind: 'notice', message: '当前周尚未结束。', severity: 'warning', code: 'current_period' },
  ],
  limitations: [],
  actions: [{
    action_id: 'compare_previous',
    kind: 'prompt',
    label: '对比上期',
    source_turn_id: 'turn-1',
    params: { message: '对比凤八店上一完整周人效' },
  }],
};

export const partialSalesAgentResponse = {
  ...validAgentResponse,
  task: 'sales_summary',
  result_status: 'partial',
  result_id: 'sales-turn-partial',
  content: '本期销售数据缺少 1 天快照。',
  limitations: [{ code: 'missing_dates', text: '缺少 1 天快照。' }],
};

export const agentTableRows = Array.from({ length: 8 }, (_, index) => ({
  store_name: `门店${index + 1}`,
  actual_efficiency: String(80 + index),
}));

export function structuredMessage(rows = agentTableRows, content = '本期人效结果'): MessageItem {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content,
    created_at: '2026-08-21T10:00:00+08:00',
    agentResponse: {
      ...validAgentResponse,
      parts: validAgentResponse.parts.map((part) => (
        part.kind === 'table' ? { ...part, row_count: rows.length, preview_rows: rows } : part
      )),
    },
  };
}

export function sessionDetailWithAgentResponse(): SessionDetailResponse {
  const message = structuredMessage();
  return {
    session_id: 'session-1',
    title: '经营分析',
    messages: [{
      ...message,
      agentResponse: undefined,
      metadata: { agent_response: message.agentResponse, ignored_private_data: 'drop-me' },
    }],
  };
}
