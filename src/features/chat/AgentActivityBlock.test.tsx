import { fireEvent, render } from '@testing-library/react-native';
import type { AgentActivity } from '@/types/chat';
import { AgentActivityBlock } from './AgentActivityBlock';

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

describe('AgentActivityBlock', () => {
  it('uses an accessible disclosure and limits expanded activity to six steps', async () => {
    const activity = {
      version: 'v1' as const,
      status: 'completed' as const,
      label: '分析活动已完成',
      elapsed_ms: 6000,
      steps: Array.from({ length: 7 }, (_, index) => ({
        step_id: `step-${index + 1}`,
        label: `分析步骤 ${index + 1}`,
        status: 'completed' as const,
        elapsed_ms: 1000,
        sequence: index + 1,
      })),
      scope: ['凤八店'],
      sources: ['销售日快照'],
    };
    const screen = await render(<AgentActivityBlock activity={activity} testID="agent-activity" />);

    const toggle = screen.getByRole('button', { name: '展开分析活动' });
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(toggle);

    expect(screen.getByText('分析步骤 6')).toBeTruthy();
    expect(screen.queryByText('分析步骤 7')).toBeNull();
    expect(screen.getByRole('button', { name: '收起分析活动' }).props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('does not announce elapsed-only heartbeats but announces step and status changes', async () => {
    const screen = await render(<AgentActivityBlock activity={runningActivity} testID="agent-activity" />);
    const liveRegionTexts = () => liveRegionNodes(screen.toJSON()).map(renderedText);

    expect(liveRegionTexts()).toEqual(['正在分析', '读取销售快照']);
    await screen.rerender(
      <AgentActivityBlock
        activity={{
          ...runningActivity,
          elapsed_ms: 2400,
          steps: [{ ...runningActivity.steps[0], elapsed_ms: 2400 }, runningActivity.steps[1]],
        }}
        testID="agent-activity"
      />,
    );
    expect(liveRegionTexts()).toEqual(['正在分析', '读取销售快照']);
    expect(nodesWithText(screen.toJSON(), '2.4 秒')).toEqual([
      expect.objectContaining({ props: expect.not.objectContaining({ accessibilityLiveRegion: expect.anything() }) }),
    ]);

    await screen.rerender(
      <AgentActivityBlock
        activity={{
          ...runningActivity,
          elapsed_ms: 2600,
          steps: [
            { ...runningActivity.steps[0], status: 'completed', elapsed_ms: 2400 },
            { ...runningActivity.steps[1], status: 'running', elapsed_ms: 200 },
          ],
        }}
        testID="agent-activity"
      />,
    );
    expect(liveRegionTexts()).toEqual(['正在分析', '整理分析结论']);

    await screen.rerender(
      <AgentActivityBlock
        activity={{
          ...runningActivity,
          status: 'failed',
          label: '分析活动失败',
          steps: runningActivity.steps.map((step) => ({ ...step, status: 'failed' })),
        }}
        testID="agent-activity"
      />,
    );
    expect(liveRegionTexts()).toEqual(['分析失败', '分析活动失败']);
  });

  it.each([
    ['completed', '分析活动已完成'],
    ['partial', '分析结果不完整'],
    ['empty', '暂无匹配数据'],
    ['unavailable', '数据暂不可用'],
    ['failed', '分析活动失败'],
  ] as const)('shows a truthful %s terminal with the server total', async (status, label) => {
    const activity = {
      ...runningActivity,
      status,
      label,
      elapsed_ms: 50,
      total_duration_ms: 175,
      steps: runningActivity.steps.map((step) => ({ ...step, status: 'completed' as const, elapsed_ms: 25 })),
    } as unknown as AgentActivity;
    const screen = await render(<AgentActivityBlock activity={activity} testID="agent-activity" />);

    expect(screen.getByText(/0\.2 秒/)).toBeTruthy();
    if (status !== 'completed') expect(screen.getByText(label)).toBeTruthy();
    if (status === 'failed' || status === 'unavailable') expect(screen.queryByText(/已完成/)).toBeNull();
  });
});

type RenderedNode = {
  children?: Array<RenderedNode | string> | null;
  props?: Record<string, unknown>;
};

function liveRegionNodes(node: RenderedNode | Array<RenderedNode | string> | string | null): RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap(liveRegionNodes);
  if (!node || typeof node === 'string') return [];
  return [
    ...(node.props?.accessibilityLiveRegion === 'polite' ? [node] : []),
    ...liveRegionNodes(node.children ?? null),
  ];
}

function nodesWithText(node: RenderedNode | Array<RenderedNode | string> | string | null, text: string): RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => nodesWithText(child, text));
  if (!node || typeof node === 'string') return [];
  return [
    ...(renderedText(node) === text ? [node] : []),
    ...nodesWithText(node.children ?? null, text),
  ];
}

function renderedText(node: RenderedNode): string {
  return (node.children ?? []).map((child) => typeof child === 'string' ? child : renderedText(child)).join('');
}
