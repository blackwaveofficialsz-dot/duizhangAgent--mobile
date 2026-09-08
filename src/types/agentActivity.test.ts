import {
  finishAgentActivity,
  mergeAgentActivityStep,
  parseAgentActivity,
  parsePublicAgentActivityStep,
} from './agentActivity';

const publicStep = {
  visibility: 'public',
  step_id: 'query-sales',
  label: '查询销售数据',
  detail: '正在读取日报',
  status: 'running',
  elapsed_ms: 120,
  sequence: 2,
};

describe('agent activity contract', () => {
  it('accepts only safe public steps and rebuilds their public fields', () => {
    expect(parsePublicAgentActivityStep({ ...publicStep, internal_reasoning: 'do not expose' })).toEqual({
      step_id: 'query-sales',
      label: '查询销售数据',
      detail: '正在读取日报',
      status: 'running',
      elapsed_ms: 120,
      sequence: 2,
    });

    for (const invalidStep of [
      { ...publicStep, visibility: 'private' },
      { ...publicStep, step_id: 'x'.repeat(65) },
      { ...publicStep, label: 'x'.repeat(25) },
      { ...publicStep, detail: 'x'.repeat(61) },
      { ...publicStep, elapsed_ms: -1 },
      { ...publicStep, sequence: 1.5 },
      { ...publicStep, status: 'waiting' },
    ]) {
      expect(parsePublicAgentActivityStep(invalidStep)).toBeNull();
    }
  });

  it('accepts only bounded v1 historical activity snapshots and rebuilds them', () => {
    const activity = {
      version: 'v1',
      status: 'completed',
      label: '销售分析完成',
      elapsed_ms: 450,
      steps: [{ ...publicStep, status: 'completed', internal_reasoning: 'do not expose' }],
      scope: ['华北区域'],
      sources: ['销售日报'],
      internal_context: 'do not expose',
    };

    expect(parseAgentActivity(activity)).toEqual({
      version: 'v1',
      status: 'completed',
      label: '销售分析完成',
      elapsed_ms: 450,
      steps: [{
        step_id: 'query-sales',
        label: '查询销售数据',
        status: 'completed',
        elapsed_ms: 120,
        sequence: 1,
      }],
      scope: ['华北区域'],
      sources: ['销售日报'],
    });

    expect(parseAgentActivity({ ...activity, version: 'v2' })).toBeNull();
    expect(parseAgentActivity({ ...activity, steps: Array(7).fill(publicStep) })).toBeNull();
    expect(parseAgentActivity({ ...activity, scope: ['a', 'b', 'c', 'd'] })).toBeNull();
    expect(parseAgentActivity({ ...activity, sources: ['a', 'b', 'c', 'd'] })).toBeNull();
  });

  it.each(['completed', 'partial', 'empty', 'unavailable', 'failed'] as const)(
    'accepts the %s business terminal and server wall-clock total',
    (status) => {
      expect(parseAgentActivity({
        version: 'v1', status, label: `terminal-${status}`, elapsed_ms: 50,
        total_duration_ms: 175,
        steps: [{ ...publicStep, status: 'completed' }],
        scope: ['凤八店'], sources: ['经营销售快照'],
      })).toMatchObject({ status, elapsed_ms: 50, total_duration_ms: 175 });
    },
  );

  it('rejects a malformed server wall-clock total', () => {
    expect(parseAgentActivity({
      version: 'v1', status: 'completed', label: '分析完成', elapsed_ms: 50,
      total_duration_ms: -1, steps: [], scope: [], sources: [],
    })).toBeNull();
  });

  it('merges an existing step without changing its label or sequence and caps the activity at six steps', () => {
    let activity = mergeAgentActivityStep(null, {
      step_id: 'query-sales',
      label: '查询销售数据',
      status: 'running',
      elapsed_ms: 120,
      sequence: 2,
    });
    activity = mergeAgentActivityStep(activity, {
      step_id: 'query-sales',
      label: 'new label must not replace',
      detail: '查询完成',
      status: 'completed',
      elapsed_ms: 200,
      sequence: 99,
    });

    expect(activity.steps).toEqual([{
      step_id: 'query-sales',
      label: '查询销售数据',
      detail: '查询完成',
      status: 'completed',
      elapsed_ms: 200,
      sequence: 2,
    }]);

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      activity = mergeAgentActivityStep(activity, {
        step_id: `step-${sequence}`,
        label: `步骤 ${sequence}`,
        status: 'running',
        elapsed_ms: sequence,
        sequence,
      });
    }
    const capped = mergeAgentActivityStep(activity, {
      step_id: 'step-7',
      label: '第七步',
      status: 'running',
      elapsed_ms: 7,
      sequence: 7,
    });

    expect(capped.steps).toHaveLength(6);
    expect(capped.steps.map((step) => step.step_id)).not.toContain('step-7');
  });

  it('marks a running activity and its running steps terminal', () => {
    const activity = mergeAgentActivityStep(null, {
      step_id: 'query-sales',
      label: '查询销售数据',
      status: 'running',
      elapsed_ms: 120,
      sequence: 1,
    });

    expect(finishAgentActivity(activity, 'interrupted')).toMatchObject({
      status: 'interrupted',
      label: '分析活动已中断',
      steps: [{ status: 'interrupted' }],
    });
  });

  it('lets a parent stream error force a completed activity to failed', () => {
    const completed = finishAgentActivity(mergeAgentActivityStep(null, {
      step_id: 'query-sales', label: '查询销售数据', status: 'completed', elapsed_ms: 20, sequence: 1,
    }), 'completed')!;

    expect(finishAgentActivity(completed, 'failed', true)).toEqual(expect.objectContaining({
      status: 'failed', label: '分析活动失败',
      steps: [expect.objectContaining({ status: 'completed' })],
    }));
  });
});
