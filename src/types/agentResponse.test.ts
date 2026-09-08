import { partialSalesAgentResponse, validAgentResponse } from '@/test/agentResponseFixture';
import { parseAgentResponsePayload } from './agentResponse';

const MAX_AGENT_RESPONSE_BYTES = 256 * 1024;

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

describe('parseAgentResponsePayload', () => {
  it('accepts the shared version 1 payload and rejects over-limit tables', () => {
    expect(parseAgentResponsePayload(validAgentResponse)?.task).toBe('labor_efficiency');
    expect(parseAgentResponsePayload({
      ...validAgentResponse,
      parts: [{ ...validAgentResponse.parts[2], preview_rows: Array.from({ length: 51 }, () => ({})) }],
    })).toBeNull();
  });

  it('rejects invalid prompt actions without partially trusting the payload', () => {
    expect(parseAgentResponsePayload({
      ...validAgentResponse,
      actions: [{ kind: 'prompt', label: '错误动作', params: { message: '' } }],
    })).toBeNull();
  });

  it('accepts strict clarification actions and rejects malformed candidates', () => {
    const clarification = {
      action_id: 'sales',
      kind: 'clarify',
      label: '查看经营销售数据',
      source_turn_id: 'turn-1',
      params: { candidate_id: 'analytics:sales_summary', message: '查看经营销售数据' },
    };

    expect(parseAgentResponsePayload({
      ...validAgentResponse,
      parts: [{ kind: 'clarification', message: '请选择要查看的数据' }],
      actions: [clarification],
    })?.actions).toEqual([clarification]);

    for (const action of [
      { ...clarification, source_turn_id: 'turn-other' },
      { ...clarification, params: { candidate_id: '', message: '查看经营销售数据' } },
      { ...clarification, params: { candidate_id: 'analytics:sales_summary', message: '', extra: 'unexpected' } },
    ]) {
      expect(parseAgentResponsePayload({ ...validAgentResponse, actions: [action] })).toBeNull();
    }
  });

  it('accepts partial backend limitations with code and text', () => {
    expect(parseAgentResponsePayload(partialSalesAgentResponse)).toEqual(expect.objectContaining({
      result_status: 'partial',
      limitations: [{ code: 'missing_dates', text: '缺少 1 天快照。' }],
    }));
  });

  it('rejects serialized payloads above 256 KiB while accepting the byte boundary', () => {
    const boundaryBase = { ...validAgentResponse, content: '' };
    const boundary = {
      ...boundaryBase,
      content: 'a'.repeat(MAX_AGENT_RESPONSE_BYTES - serializedBytes(boundaryBase)),
    };

    expect(serializedBytes(boundary)).toBe(MAX_AGENT_RESPONSE_BYTES);
    expect(parseAgentResponsePayload(boundary)).not.toBeNull();
    expect(parseAgentResponsePayload({ ...boundary, content: `${boundary.content}a` })).toBeNull();
    expect(parseAgentResponsePayload({ ...validAgentResponse, content: '中'.repeat(Math.ceil(MAX_AGENT_RESPONSE_BYTES / 3)) })).toBeNull();
  });
});
