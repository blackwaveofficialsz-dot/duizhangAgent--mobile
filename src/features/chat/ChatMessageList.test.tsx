import { act, fireEvent, render } from '@testing-library/react-native';
import { agentTableRows, structuredMessage, validAgentResponse } from '@/test/agentResponseFixture';
import type { AgentActivity } from '@/types/chat';
import { ChatMessageList, createScrollScheduler } from './ChatMessageList';

const messages = [
  { id: 'user-1', role: 'user', content: '你好', created_at: '2026-07-16T10:00:00+08:00' },
  { id: 'assistant-1', role: 'assistant', content: '你好，有什么可以帮你？', created_at: '2026-07-16T10:00:01+08:00' },
];

const completedActivity = {
  version: 'v1' as const,
  status: 'completed' as const,
  label: '分析活动已完成',
  elapsed_ms: 1800,
  steps: [
    { step_id: 'scope', label: '确认门店范围', status: 'completed' as const, elapsed_ms: 800, sequence: 1 },
    { step_id: 'sales', label: '读取销售快照', detail: '凤八店', status: 'completed' as const, elapsed_ms: 1000, sequence: 2 },
  ],
  scope: ['凤八店', '最近 7 天'],
  sources: ['销售日快照'],
};

const runningActivity: AgentActivity = {
  version: 'v1',
  status: 'running',
  label: '读取销售快照',
  elapsed_ms: 1000,
  steps: [
    { step_id: 'sales', label: '读取销售快照', status: 'running', elapsed_ms: 1000, sequence: 1 },
    { step_id: 'summary', label: '整理分析结论', status: 'running', elapsed_ms: 0, sequence: 2 },
  ],
  scope: ['凤八店'],
  sources: ['销售日快照'],
};

describe('ChatMessageList', () => {
  it('lets the message list shrink when keyboard avoidance reduces the available height', async () => {
    const screen = await render(<ChatMessageList messages={messages} onRetry={jest.fn()} />);

    expect(screen.getByTestId('chat-message-list')).toHaveStyle({ flex: 1 });
  });

  it('aligns user messages right and Agent messages left', async () => {
    const screen = await render(<ChatMessageList messages={messages} onRetry={jest.fn()} />);

    expect(screen.getByTestId('message-user-1')).toHaveStyle({ alignSelf: 'flex-end' });
    expect(screen.getByTestId('message-assistant-1')).toHaveStyle({ alignSelf: 'flex-start' });
  });

  it('renders validated structured summary and table parts without parsing metadata', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-structured',
          role: 'assistant',
          content: '销售汇总已生成',
          created_at: '2026-08-18T10:00:00+08:00',
          agentResponse: {
            ...validAgentResponse,
            parts: [
              { kind: 'summary', title: '凤八店销售汇总', metrics: [{ key: 'net_revenue', label: '净实收', value: '97011.75', unit: 'CNY' }] },
              {
                kind: 'table',
                title: '按天销售明细',
                table_id: 'daily_sales',
                row_count: 2,
                columns: [{ key: 'biz_date', label: '日期' }, { key: 'net_revenue', label: '净实收', unit: 'CNY' }],
                preview_rows: [{ biz_date: '2026-08-16', net_revenue: '97011.75' }],
              },
            ],
          },
        }]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText('凤八店销售汇总')).toBeTruthy();
    expect(screen.getAllByText('¥97,011.75')).toHaveLength(2);
    expect(screen.getByText('按天销售明细')).toBeTruthy();
    expect(screen.getByText('2 行')).toBeTruthy();
    expect(screen.getByText('2026-08-16')).toBeTruthy();
  });

  it('forwards structured clarification choices as hidden interactions', async () => {
    const onPrompt = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-clarification',
          role: 'assistant',
          content: '请选择要查看的数据',
          created_at: '2026-08-24T10:00:00+08:00',
          agentResponse: {
            ...validAgentResponse,
            parts: [{ kind: 'clarification', message: '请选择要查看的数据' }],
            actions: [{
              action_id: 'sales',
              kind: 'clarify',
              label: '查看经营销售数据',
              source_turn_id: 'turn-1',
              params: { candidate_id: 'analytics:sales_summary', message: '查看经营销售数据' },
            }],
          },
        }]}
        onPrompt={onPrompt}
        onRetry={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '查看经营销售数据' }));
    expect(onPrompt).toHaveBeenCalledWith('查看经营销售数据', {
      kind: 'clarification_choice',
      source_turn_id: 'turn-1',
      candidate_id: 'analytics:sales_summary',
    });
  });

  it('shows three structured table rows by default, expands and collapses the preview', async () => {
    const screen = await render(
      <ChatMessageList messages={[structuredMessage(agentTableRows)]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    expect(screen.getByText('门店3')).toBeTruthy();
    expect(screen.queryByText('门店4')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '展开表格' }));
    expect(screen.getByText('门店8')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '收起表格' }));
    expect(screen.queryByText('门店4')).toBeNull();
  });

  it('keeps an expanded structured table open while streaming content updates', async () => {
    const view = await render(
      <ChatMessageList messages={[{ ...structuredMessage(agentTableRows, '第一段'), streaming: true }]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    await fireEvent.press(view.getByRole('button', { name: '展开表格' }));
    view.rerender(
      <ChatMessageList messages={[{ ...structuredMessage(agentTableRows, '第一段第二段'), streaming: true }]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    expect(view.getByRole('button', { name: '收起表格' })).toBeTruthy();
  });

  it('keeps an expanded table after switching away from and back to its session', async () => {
    const message = structuredMessage(agentTableRows);
    const view = await render(
      <ChatMessageList messages={[message]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    await fireEvent.press(view.getByRole('button', { name: '展开表格' }));
    await act(async () => {
      view.rerender(<ChatMessageList messages={[]} onPrompt={jest.fn()} onRetry={jest.fn()} />);
    });
    await act(async () => {
      view.rerender(<ChatMessageList messages={[message]} onPrompt={jest.fn()} onRetry={jest.fn()} />);
    });

    expect(view.getByRole('button', { name: '收起表格' })).toBeTruthy();
  });

  it('does not add an empty bubble beside a complete structured response', async () => {
    const message = structuredMessage(agentTableRows);
    const screen = await render(
      <ChatMessageList messages={[message]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    expect(screen.queryByTestId(`message-${message.id}-text-0`)).toBeNull();
    expect(screen.getByTestId(`message-${message.id}`).children).toHaveLength(1);
  });

  it('keeps a completed activity collapsed above its visible structured answer', async () => {
    const message = { ...structuredMessage(), activity: completedActivity };
    const screen = await render(
      <ChatMessageList messages={[message]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    expect(screen.getByText('已完成 2 项分析活动 · 1.8 秒')).toBeTruthy();
    expect(screen.queryByText('确认门店范围')).toBeNull();
    expect(screen.getAllByText('实际人效')).not.toHaveLength(0);
    expect(screen.queryByText('正在回复...')).toBeNull();
    const activity = screen.getByTestId(`agent-activity-${message.id}`);
    const answer = screen.getByTestId(`message-${message.id}-answer`);
    expect(activity.parent).toBe(answer.parent);
    expect(activity.parent?.children.indexOf(activity)).toBeLessThan(activity.parent?.children.indexOf(answer) ?? -1);
  });

  it.each(['completed', 'failed'] as const)('keeps the real answer ordered after an expanded activity becomes %s', async (status) => {
    const message = {
      ...messages[1],
      id: 'assistant-activity-transition',
      content: '凤八店销售结论保持可见',
      activity: runningActivity,
    };
    const screen = await render(<ChatMessageList messages={[message]} onRetry={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: '展开分析活动' }));
    expect(screen.getByText('整理分析结论')).toBeTruthy();

    await screen.rerender(
      <ChatMessageList
        messages={[{
          ...message,
          activity: {
            ...runningActivity,
            status,
            label: status === 'completed' ? '分析活动已完成' : '分析活动失败',
            steps: runningActivity.steps.map((step) => ({ ...step, status })),
          },
        }]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '展开分析活动' }).props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText('整理分析结论')).toBeNull();
    expect(screen.getByText('凤八店销售结论保持可见')).toBeTruthy();
    const activity = screen.getByTestId('agent-activity-assistant-activity-transition');
    const answer = screen.getByTestId('message-assistant-activity-transition-answer');
    expect(activity.parent).toBe(answer.parent);
    expect(activity.parent?.children.indexOf(activity)).toBeLessThan(activity.parent?.children.indexOf(answer) ?? -1);
  });

  it('expands activity steps without changing the independently expanded structured table', async () => {
    const message = { ...structuredMessage(agentTableRows), activity: completedActivity };
    const screen = await render(
      <ChatMessageList messages={[message]} onPrompt={jest.fn()} onRetry={jest.fn()} />,
    );

    const activityToggle = screen.getByRole('button', { name: '展开分析活动' });
    expect(activityToggle.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(activityToggle);
    expect(screen.getByText('确认门店范围')).toBeTruthy();
    expect(screen.getByText('范围：凤八店 · 最近 7 天')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起分析活动' }).props.accessibilityState).toMatchObject({ expanded: true });

    await fireEvent.press(screen.getByRole('button', { name: '展开表格' }));
    expect(screen.getByText('门店8')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '收起分析活动' }));
    expect(screen.getByText('门店8')).toBeTruthy();
  });

  it.each([
    ['running', '正在分析'],
    ['failed', '分析失败'],
    ['cancelled', '已停止'],
    ['interrupted', '连接中断'],
  ] as const)('renders an explicit %s activity status', async (status, label) => {
    const screen = await render(
      <ChatMessageList
        messages={[{
          ...messages[1],
          activity: { ...completedActivity, status, steps: [{ ...completedActivity.steps[0], status }], elapsed_ms: 1000 },
        }]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeTruthy();
  });

  it('keeps the legacy loader only when an empty assistant reply has no activity', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[
          { ...messages[1], id: 'assistant-with-activity', content: '', streaming: true, activity: { ...completedActivity, status: 'running' } },
          { ...messages[1], id: 'assistant-without-activity', content: '', streaming: true },
        ]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getAllByText('正在回复...')).toHaveLength(1);
    expect(screen.getByTestId('agent-activity-assistant-with-activity')).toBeTruthy();
  });

  it('throttles streaming scroll requests without animation', () => {
    jest.useFakeTimers();
    const scrollToEnd = jest.fn();
    const scheduler = createScrollScheduler(scrollToEnd);

    try {
      scheduler.schedule(false);
      scheduler.schedule(false);
      scheduler.schedule(false);
      jest.advanceTimersByTime(32);

      expect(scrollToEnd).toHaveBeenCalledTimes(1);
      expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });

      scheduler.schedule(true);
      jest.advanceTimersByTime(32);
      expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    } finally {
      scheduler.cancel();
      jest.useRealTimers();
    }
  });

  it('shows an explicit retry action for an interrupted reply', async () => {
    const onRetry = jest.fn();
    const screen = await render(
      <ChatMessageList
        messages={[...messages, { ...messages[1], id: 'assistant-2', interrupted: true }]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('回复中断')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '重试中断的消息' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry for an interrupted reply while offline', async () => {
    const onRetry = jest.fn();
    const screen = await render(
      <ChatMessageList
        isRetryDisabled
        messages={[...messages, { ...messages[1], id: 'assistant-2', interrupted: true }]}
        onRetry={onRetry}
      />,
    );

    const retry = screen.getByRole('button', { name: '重试中断的消息' });
    expect(retry.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps an older interruption marked without offering a stale retry', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[
          { ...messages[1], id: 'assistant-interrupted', interrupted: true },
          { ...messages[1], id: 'assistant-complete', interrupted: false },
        ]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText('回复中断')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试中断的消息' })).toBeNull();
  });

  it('renders a safe tool summary without raw control-event data', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[
          {
            id: 'tool-1',
            role: 'tool_call',
            content: '',
            created_at: '2026-07-16T10:00:00+08:00',
            toolCall: {
              name: '查询订单',
              description: '按日期汇总订单',
              status: 'running',
              arguments: 'SELECT secret_token FROM orders',
            },
          } as never,
        ]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText('查询订单')).toBeTruthy();
    expect(screen.getByText('按日期汇总订单')).toBeTruthy();
    expect(screen.getByLabelText('工具调用：查询订单，运行中')).toHaveStyle({
      borderLeftColor: '#19A58E',
      borderLeftWidth: 3,
    });
    expect(screen.queryByText(/secret_token/)).toBeNull();
  });

  it('renders historical query evidence, a task link, and a table summary', async () => {
    const onOpenTask = jest.fn();
    const screen = await render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-query',
            role: 'assistant',
            content: '查询结果：\n\n| 日期 | 金额 |\n| --- | ---: |\n| 2026-07-01 | 120 |\n| 2026-07-02 | 240 |\n| 2026-07-03 | 360 |\n| 2026-07-04 | 480 |',
            created_at: '2026-07-16T10:00:00+08:00',
            task_id: 'task-42',
            metadata: {
              connector_query: {
                evidence: {
                  dataset_name: '订单明细',
                  date_range: { from: '2026-07-01', to: '2026-07-04' },
                  scope: 'all',
                  fields: ['日期', '金额'],
                  filters: [{ field: '状态', op: 'equals', value: '已完成' }],
                  group_by: ['日期'],
                  metrics: ['金额求和'],
                  knowledge_entries: [],
                  row_counts: { returned: 4, truncated: true },
                  warnings: ['结果已截断'],
                },
                knowledge_suggestion: { title: '补充字段说明', content: '请补充状态字段含义' },
                export: { available: true, total: 12, returned: 4, truncated: true, dataset_name: '订单明细' },
                knowledge_context: { suggestions: ['状态字段需要说明'] },
                raw_token: 'history-secret-token',
              },
            },
          } as never,
        ]}
        onOpenTask={onOpenTask}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText(/订单明细/)).toBeTruthy();
    expect(screen.getByText(/2 列.*4 行/)).toBeTruthy();
    expect(screen.getByText('查询依据')).toBeTruthy();
    expect(screen.queryByText('状态')).toBeNull();
    expect(screen.queryByText(/history-secret-token/)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: '展开查询依据' }));
    expect(screen.getByText(/状态 equals 已完成/)).toBeTruthy();
    expect(screen.getByText(/补充字段说明/)).toBeTruthy();
    expect(screen.getByText(/可导出 12 条/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '查看关联任务' }));
    expect(onOpenTask).toHaveBeenCalledWith('task-42');
    expect(screen.queryByTestId('table-scroll-assistant-query')).toBeNull();
  });

  it('normalizes partial historical metadata without rendering unknown sensitive fields', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-partial-evidence',
            role: 'assistant',
            content: '已完成查询',
            created_at: '2026-07-16T10:00:00+08:00',
            metadata: {
              connector_query: {
                evidence: {
                  dataset_name: '部分订单数据',
                  date_range: null,
                  fields: 'not-an-array',
                  filters: { invalid: true },
                  row_counts: null,
                  warnings: null,
                  private_token: 'metadata-secret',
                },
                knowledge_context: {
                  suggestions: ['补充字段定义'],
                  trace: [{ title: '已应用门店规则', token: 'trace-secret' }],
                  missing: [{ name: '缺少渠道映射', secret: 'missing-secret' }],
                  headers: { Authorization: 'header-secret' },
                },
              },
            },
          } as never,
        ]}
        onRetry={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '展开查询依据' }));
    expect(screen.getAllByText(/部分订单数据/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0 条/).length).toBeGreaterThan(0);
    expect(screen.getByText(/补充字段定义/)).toBeTruthy();
    expect(screen.getByText(/已应用门店规则/)).toBeTruthy();
    expect(screen.getByText(/缺少渠道映射/)).toBeTruthy();
    expect(screen.queryByText(/secret|Authorization/)).toBeNull();
  });

  it('opens a dedicated page instead of expanding a long table in the conversation', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => `| 第${index + 1}行 | ${index + 1} |`).join('\n');
    const onOpenTable = jest.fn();
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-long-table',
          role: 'assistant',
          content: `| 名称 | 数值 |\n| --- | ---: |\n${rows}`,
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onOpenTable={onOpenTable}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('table-scroll-assistant-long-table')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '打开完整表格' }));
    expect(onOpenTable).toHaveBeenCalledWith('assistant-long-table', 0);
  });

  it('removes every long table from a report bubble and opens the selected table', async () => {
    const onOpenTable = jest.fn();
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-multiple-tables',
          role: 'assistant',
          content: [
            '经营分析报告',
            '',
            '#### 门店表现',
            '| 门店 | 净实收 |',
            '| --- | ---: |',
            '| 第一店 | 100 |',
            '| 第二店 | 200 |',
            '| 第三店 | 300 |',
            '| 第一张第四行 | 400 |',
            '',
            '#### 产品结构',
            '| 产品 | 销量 |',
            '| --- | ---: |',
            '| 产品一 | 10 |',
            '| 产品二 | 20 |',
            '| 产品三 | 30 |',
            '| 第二张第四行 | 40 |',
            '',
            '建议关注变化。',
          ].join('\n'),
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onOpenTable={onOpenTable}
        onRetry={jest.fn()}
      />,
    );

    const links = screen.getAllByRole('button', { name: '打开完整表格' });
    expect(links).toHaveLength(2);
    expect(screen.queryByText(/第一张第四行/)).toBeNull();
    expect(screen.queryByText(/第二张第四行/)).toBeNull();

    await fireEvent.press(links[1]);
    expect(onOpenTable).toHaveBeenCalledWith('assistant-multiple-tables', 1);
  });

  it('treats a four-row table as a dedicated-page result', async () => {
    const onOpenTable = jest.fn();
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-four-row-table',
          role: 'assistant',
          content: '| 名称 | 数值 |\n| --- | ---: |\n| 一 | 1 |\n| 二 | 2 |\n| 三 | 3 |\n| 四 | 4 |',
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onOpenTable={onOpenTable}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('table-scroll-assistant-four-row-table')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '打开完整表格' }));
    expect(onOpenTable).toHaveBeenCalledWith('assistant-four-row-table', 0);
  });

  it('keeps a three-row table compact in the conversation', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-small-table',
          role: 'assistant',
          content: '| 名称 | 数值 |\n| --- | ---: |\n| 一 | 1 |\n| 二 | 2 |\n| 三 | 3 |',
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByTestId('table-scroll-assistant-small-table')).toHaveStyle({ height: 176 });
  });

  it('keeps a concise summary table with markdown emphasis inline', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-summary-table',
          role: 'assistant',
          content: '| 月份 | 订单数 | 实收金额 |\n| --- | ---: | ---: |\n| 2026-06 | 13,082 | 231,340.75 |\n| **合计** | 13,082 | **231,340.75** |',
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByTestId('table-scroll-assistant-summary-table')).toHaveStyle({ height: 132 });
    expect(screen.queryByRole('button', { name: '打开完整表格' })).toBeNull();
    expect(screen.getByText('合计')).toBeTruthy();
    expect(screen.queryByText('**合计**')).toBeNull();
  });

  it('opens a dedicated page when a three-row table has multi-line cells', async () => {
    const onOpenTable = jest.fn();
    const detail = '门店经营数据说明'.repeat(2);
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-wrapping-table',
          role: 'assistant',
          content: `| 门店 | 餐段 | 备注 |\n| --- | --- | --- |\n| ${detail} | ${detail} | ${detail} |\n| ${detail} | ${detail} | ${detail} |\n| ${detail} | ${detail} | ${detail} |`,
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onOpenTable={onOpenTable}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('table-scroll-assistant-wrapping-table')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '打开完整表格' }));
    expect(onOpenTable).toHaveBeenCalledWith('assistant-wrapping-table', 0);
  });

  it('opens a dedicated page when a short table contains oversized cell content', async () => {
    const onOpenTable = jest.fn();
    const longDescription = '这是非常长的商品说明，用于验证少量行列但内容很长的表格不会撑高聊天页面。'.repeat(8);
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-dense-table',
          role: 'assistant',
          content: `| 商品 | 说明 |\n| --- | --- |\n| 套餐 A | ${longDescription} |\n| 套餐 B | ${longDescription} |`,
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onOpenTable={onOpenTable}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('table-scroll-assistant-dense-table')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '打开完整表格' }));
    expect(onOpenTable).toHaveBeenCalledWith('assistant-dense-table', 0);
  });

  it('keeps narrative sections beside their original tables', async () => {
    const screen = await render(
      <ChatMessageList
        messages={[{
          id: 'assistant-ordered-tables',
          role: 'assistant',
          content: [
            '经营概览',
            '| 门店 | 金额 |',
            '| --- | ---: |',
            '| 茅坡店 | 120 |',
            '产品结构',
            '| 产品 | 销量 |',
            '| --- | ---: |',
            '| 肉夹馍 | 10 |',
            '经营建议',
          ].join('\n'),
          created_at: '2026-07-16T10:00:00+08:00',
        }]}
        onRetry={jest.fn()}
      />,
    );

    const message = screen.getByTestId('message-assistant-ordered-tables');
    expect(message.children.map((child) => typeof child === 'string' ? child : child.props.testID).filter(Boolean)).toEqual([
      'message-assistant-ordered-tables-text-0',
      'message-assistant-ordered-tables-table-0',
      'message-assistant-ordered-tables-text-2',
      'message-assistant-ordered-tables-table-1',
      'message-assistant-ordered-tables-text-4',
    ]);
  });

});
