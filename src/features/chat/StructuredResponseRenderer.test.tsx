import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { structuredMessage, validAgentResponse } from '@/test/agentResponseFixture';
import { tableFromMessage } from './chatTables';
import { StructuredResponseRenderer } from './StructuredResponseRenderer';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  const rejected = new Promise<T>((_resolve, next) => { reject = next; });
  return { promise, rejected, resolve, reject };
}

describe('StructuredResponseRenderer', () => {
  it('renders summary insights notice and prompt actions natively', async () => {
    const onPrompt = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onPrompt={onPrompt}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={validAgentResponse}
      />,
    );

    expect(screen.getAllByText('实际人效')).toHaveLength(2);
    expect(screen.getByText('实际工时低于排班工时。')).toBeTruthy();
    expect(screen.getByText('当前周尚未结束。')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '对比上期' }));
    await waitFor(() => expect(onPrompt).toHaveBeenCalledWith('对比凤八店上一完整周人效'));
  });

  it('maps backend unit codes to Chinese labels', async () => {
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onPrompt={jest.fn()}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={{
          ...validAgentResponse,
          parts: [{
            kind: 'summary',
            title: '销售汇总',
            metrics: [
              { key: 'order_count', label: '订单数', value: '38017', unit: 'order' },
              { key: 'store_count', label: '统计门店数', value: '12', unit: 'store' },
            ],
          }],
        }}
      />,
    );

    expect(screen.getByText('38,017单')).toBeTruthy();
    expect(screen.getByText('12家')).toBeTruthy();
  });

  it('formats transitional metric units without leaking unknown codes', async () => {
    const diagnostic = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onPrompt={jest.fn()}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={{
          ...validAgentResponse,
          parts: [
            { kind: 'summary', metrics: [
              { key: 'legacy-cny', value: '-12345.67', unit: 'CNY' },
              { key: 'cny', value: '12345.67', unit: 'cny' },
              { key: 'legacy-hour', value: '82.46', unit: 'CNY/hour' },
              { key: 'hour-rate', value: '82.46', unit: 'cny_per_hour' },
              { key: 'ratio', value: '0.092', unit: 'ratio' },
              { key: 'period', value: '3', unit: 'period' },
            ] },
            { kind: 'summary', metrics: [
              { key: 'product', value: '10', unit: 'product' },
              { key: 'item', value: '1234', unit: 'item' },
              { key: 'person', value: '12', unit: 'person' },
              { key: 'unknown-unit', value: '7', unit: 'secret_internal_unit' },
            ] },
          ],
          actions: [],
        }}
      />,
    );

    for (const text of ['¥-12,345.67', '¥12,345.67', '¥82.46/工时', '9.2%', '3期', '10种', '1,234件', '12人', '7']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(/secret_internal/)).toBeNull();
    expect(diagnostic).toHaveBeenCalled();
    expect(diagnostic.mock.calls.flat().join(' ')).not.toContain('secret_internal');
  });

  it.each([
    ['partial', '结果不完整', false],
    ['empty', '暂无可用数据', false],
    ['unavailable', '数据暂不可用', true],
    ['failed', '分析失败', true],
  ] as const)('renders %s parts and applies the correct payload action gate', async (status, banner, blocked) => {
    const onPrompt = jest.fn().mockResolvedValue(undefined);
    const onAction = jest.fn().mockResolvedValue(undefined);
    const response = {
      ...validAgentResponse,
      result_status: status,
      parts: [
        { kind: 'summary', title: '可用事实', metrics: [{ key: 'orders', value: '2', unit: 'order' }] },
        { kind: 'clarification', message: '请选择范围' },
      ],
      actions: [
        { action_id: 'prompt', kind: 'prompt', label: '继续分析', source_turn_id: 'turn-1', params: { message: '继续分析' } },
        { action_id: 'clarify', kind: 'clarify', label: '选择门店', source_turn_id: 'turn-1', params: { candidate_id: 'analytics:sales_summary', message: '选择门店' } },
      ],
    };
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onAction={onAction}
        onPrompt={onPrompt}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={response}
      />,
    );

    expect(screen.getByText(banner)).toBeTruthy();
    expect(screen.getByText('可用事实')).toBeTruthy();
    expect(screen.getByRole('button', { name: '继续分析' }).props.accessibilityState).toMatchObject({ disabled: blocked });
    expect(screen.getByRole('button', { name: '选择门店' }).props.accessibilityState).toMatchObject({ disabled: blocked });
    await fireEvent.press(screen.getByRole('button', { name: '继续分析' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店' }));
    expect(onPrompt).toHaveBeenCalledTimes(blocked ? 0 : 1);
    expect(onAction).toHaveBeenCalledTimes(blocked ? 0 : 1);
  });

  it('disables prompts during another stream and after the first press', async () => {
    const pending = deferred<void>();
    const onPrompt = jest.fn(() => pending.promise);
    const baseProps = {
      expandedTableKeys: new Set<string>(),
      messageId: 'assistant-1',
      onToggleTable: jest.fn(),
      promptDisabled: false,
      response: validAgentResponse,
    };
    const view = await render(<StructuredResponseRenderer {...baseProps} onPrompt={onPrompt} />);

    await fireEvent.press(view.getByRole('button', { name: '对比上期' }));
    expect(view.getByRole('button', { name: '对比上期' }).props.accessibilityState).toMatchObject({ disabled: true });
    view.rerender(<StructuredResponseRenderer {...baseProps} onPrompt={onPrompt} promptDisabled />);
    expect(view.getByRole('button', { name: '对比上期' }).props.accessibilityState).toMatchObject({ disabled: true });
    pending.resolve();
  });

  it('sends a clarification candidate with source turn binding', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const response = {
      ...validAgentResponse,
      parts: [{ kind: 'clarification', message: '请选择要查看的数据' }],
      actions: [{
        action_id: 'sales',
        kind: 'clarify',
        label: '查看经营销售数据',
        source_turn_id: 'turn-1',
        params: { candidate_id: 'analytics:sales_summary', message: '查看经营销售数据' },
      }],
    };
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onAction={onAction}
        onPrompt={jest.fn().mockResolvedValue(undefined)}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={response}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '查看经营销售数据' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'clarify',
      source_turn_id: 'turn-1',
    }));
  });

  it('disables every clarification candidate while one is sending and restores them after failure', async () => {
    const pending = deferred<void>();
    const onAction = jest.fn(() => pending.rejected);
    const response = {
      ...validAgentResponse,
      parts: [{ kind: 'clarification', message: '请选择要查看的数据' }],
      actions: [
        { action_id: 'sales', kind: 'clarify', label: '查看销售', source_turn_id: 'turn-1', params: { candidate_id: 'analytics:sales_summary', message: '查看销售' } },
        { action_id: 'labor', kind: 'clarify', label: '查看人效', source_turn_id: 'turn-1', params: { candidate_id: 'analytics:labor_efficiency', message: '查看人效' } },
      ],
    };
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set()}
        messageId="assistant-1"
        onAction={onAction}
        onPrompt={jest.fn().mockResolvedValue(undefined)}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={response}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '查看销售' }));
    expect(screen.getByRole('button', { name: '查看销售' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: '查看人效' }).props.accessibilityState).toMatchObject({ disabled: true });

    pending.reject(new Error('send failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: '查看销售' }).props.accessibilityState).toMatchObject({ disabled: false }));
  });

  it('uses the table ordinal for expand state and the full-table callback', async () => {
    const message = structuredMessage();
    const onOpenTable = jest.fn();
    const screen = await render(
      <StructuredResponseRenderer
        expandedTableKeys={new Set(['assistant-1:0'])}
        messageId={message.id}
        onOpenTable={onOpenTable}
        onPrompt={jest.fn().mockResolvedValue(undefined)}
        onToggleTable={jest.fn()}
        promptDisabled={false}
        response={message.agentResponse!}
      />,
    );

    expect(screen.getByRole('button', { name: '收起表格' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '打开完整表格' }));
    expect(onOpenTable).toHaveBeenCalledWith(message.id, 0);
    expect(tableFromMessage(message, onOpenTable.mock.calls[0][1])?.rows).toHaveLength(8);
  });
});
