import { act, fireEvent, render } from '@testing-library/react-native';
import type { TaskRecord } from '@/types/task';
import { TaskCard } from './TaskCard';
import { TaskDetailContent } from './TaskDetailContent';
import { taskDownloadInfo, taskOutputText, taskStage, visibleTaskMetaEntries } from './taskPresentation';

jest.mock('lucide-react-native', () => {
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;
  return {
    CheckCircle2: Icon,
    CircleAlert: Icon,
    Clock3: Icon,
    Database: Icon,
    Download: Icon,
    LoaderCircle: Icon,
    RefreshCw: Icon,
  };
});

const completedTask: TaskRecord = {
  id: 'row-completed',
  tenant_id: 'tenant',
  user_id: 'user',
  session_id: 'tenant:session',
  task_type: 'reconciliation',
  status: 'completed',
  task_id: 'task-completed',
  celery_task_id: 'celery-1',
  meta: { task_name: '7 月对账', summary: '已完成 31 家门店对账', period: '2026-07' },
  created_at: '2026-07-16T15:00:00+08:00',
  updated_at: '2026-07-16T16:00:00+08:00',
  completed_at: '2026-07-16T16:00:00+08:00',
};

const complexTask: TaskRecord = {
  ...completedTask,
  meta: { ...completedTask.meta, stats: { exact: Array.from({ length: 9 }, (_, index) => `门店 ${index + 1}`) } },
};

const activeStage = {
  code: 'sql_matching',
  label: '正在批量匹配',
  detail: '按交易日期执行 SQL 匹配',
  current: 3,
  total: 7,
  started_at: '2026-07-16T15:58:55+08:00',
};

function activeTask(status: 'pending' | 'running' | 'retrying', stage: unknown = activeStage): TaskRecord {
  return {
    ...completedTask,
    status,
    completed_at: null,
    meta: { stage },
  };
}

const requiredProps = {
  actioning: false,
  deviceOffline: false,
  onDownload: jest.fn(),
  onOpenRecords: jest.fn(),
  onRetry: jest.fn(),
  retryBlocked: false,
};

describe('TaskDetailContent', () => {
  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['pending', 'running', 'retrying'] as const)('strictly parses a valid stage for %s tasks', (status) => {
    expect(taskStage(activeTask(status))).toEqual(activeStage);
  });

  it('falls back when stage metadata is malformed or the task is terminal', async () => {
    expect(taskStage(activeTask('running', { ...activeStage, current: 8 }))).toBeNull();
    expect(taskStage(activeTask('running', { ...activeStage, started_at: 'not-a-time' }))).toBeNull();
    expect(taskStage({ ...activeTask('running'), status: 'completed' })).toBeNull();

    const screen = await render(<TaskCard task={activeTask('running', { label: '不应展示' })} />);
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.queryByText('不应展示')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('uses persisted research run status before the generic task status in list and detail output', async () => {
    const task: TaskRecord = {
      ...activeTask('running'),
      task_type: 'research',
      meta: { run_status: 'completed', stage: activeStage },
    };

    expect(taskStage(task)).toBeNull();
    expect(taskOutputText(task)).toBe('任务已完成。');

    const screen = await render(<TaskCard task={task} />);
    expect(screen.getByText('研究完成')).toBeTruthy();
    expect(screen.queryByText('正在批量匹配')).toBeNull();
    await act(async () => screen.unmount());

    const detail = await render(<TaskDetailContent {...requiredProps} task={task} />);
    expect(detail.getByText('研究完成')).toBeTruthy();
    expect(detail.queryByText('正在批量匹配')).toBeNull();
  });

  it('shows stage detail and accessible progress in the task list card', async () => {
    const screen = await render(<TaskCard task={activeTask('running')} />);

    expect(screen.getByText('正在批量匹配')).toBeTruthy();
    expect(screen.getByText('按交易日期执行 SQL 匹配')).toBeTruthy();
    expect(screen.getByText('3 / 7')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
      min: 0,
      max: 7,
      now: 3,
      text: '3 / 7',
    });
  });

  it('shows retrying stage detail and accessible progress in task details', async () => {
    const screen = await render(<TaskDetailContent {...requiredProps} task={activeTask('retrying')} />);

    expect(screen.getByText('重试中')).toBeTruthy();
    expect(screen.getByText('正在批量匹配')).toBeTruthy();
    expect(screen.getByText('按交易日期执行 SQL 匹配')).toBeTruthy();
    expect(screen.getByText('3 / 7')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
      min: 0,
      max: 7,
      now: 3,
      text: '3 / 7',
    });
  });

  it('refreshes elapsed time every ten seconds and clears the timer on unmount', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T16:00:00+08:00'));
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    const screen = await render(<TaskCard task={activeTask('running')} />);

    expect(screen.getByText('已耗时 1 分 5 秒')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('已耗时 1 分 15 秒')).toBeTruthy();

    await act(async () => screen.unmount());
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('does not invent elapsed time or start a timer without started_at', async () => {
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    const { started_at: _startedAt, ...stageWithoutStart } = activeStage;
    const screen = await render(<TaskDetailContent {...requiredProps} task={activeTask('pending', stageWithoutStart)} />);

    expect(screen.getByText('正在批量匹配')).toBeTruthy();
    expect(screen.queryByText(/已耗时/)).toBeNull();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('shows web task detail sections without hidden metadata', async () => {
    const task = {
      ...completedTask,
      meta: {
        task_name: '7 月对账',
        summary: '已完成 31 家门店对账',
        period: '2026-07',
        download_url: '/api/v1/hidden',
        artifact_id: 'hidden-id',
        stats: { exact: 28, review: 3 },
      },
    };
    const screen = await render(<TaskDetailContent {...requiredProps} task={task} />);

    expect(screen.getAllByText('7 月对账')).toHaveLength(2);
    expect(screen.getAllByText('已完成 31 家门店对账')).toHaveLength(2);
    expect(screen.getByText('任务 ID')).toBeTruthy();
    expect(screen.getByText('Celery ID')).toBeTruthy();
    expect(screen.getByText('stats')).toBeTruthy();
    expect(screen.queryByText('download_url')).toBeNull();
    expect(screen.queryByText('artifact_id')).toBeNull();
  });

  it('expands and collapses long structured metadata', async () => {
    const screen = await render(<TaskDetailContent {...requiredProps} task={complexTask} />);

    await act(async () => fireEvent.press(screen.getByRole('button', { name: '展开 stats' })));

    expect(screen.getByRole('button', { name: '收起 stats' })).toBeTruthy();
  });

  it('keeps web output, file, and visible metadata rules', () => {
    expect(taskOutputText({ ...completedTask, status: 'running' })).toBe('任务正在处理中，完成后这里会展示输出数据。');
    expect(taskOutputText(completedTask)).toBe('已完成 31 家门店对账');
    expect(taskDownloadInfo(completedTask)).toEqual({ filename: 'reconcile_2026_07.xlsx', path: '/api/v1/reconcile/export/2026-07' });
    expect(visibleTaskMetaEntries({ ...completedTask, meta: { download_url: '/api/v1/hidden', artifact_id: 'hidden-id', stats: 1 } })).toEqual([['stats', 1]]);
  });

  it.each([
    ['waiting_for_data', '等待补充资料'],
    ['waiting_for_approval', '等待审批'],
    ['needs_review', '待人工复核'],
    ['cancelled', '研究已取消'],
  ] as const)('renders research %s output explicitly', async (runStatus, expected) => {
    const task: TaskRecord = {
      ...completedTask,
      task_type: 'research',
      meta: { summary: '不应显示的完成摘要', run_status: runStatus },
    };

    expect(taskOutputText(task)).toBe(expected);
    const screen = await render(<TaskDetailContent {...requiredProps} task={task} />);
    expect(screen.getAllByText(expected)).toHaveLength(2);
  });

  it('matches web download rules by task type', () => {
    expect(taskDownloadInfo({
      ...completedTask,
      status: 'running',
      task_type: 'finance_report',
      meta: { download_url: '/api/v1/reports/download/finance-1' },
    })).toEqual({ filename: '财务报表.xlsx', path: '/api/v1/reports/download/finance-1' });
    expect(taskDownloadInfo({
      ...completedTask,
      task_type: 'connector_sync',
      meta: { download_url: '/api/v1/reports/download/not-a-report' },
    })).toBeNull();
  });

  it('opens connector records with the task run id', async () => {
    const onOpenRecords = jest.fn();
    const screen = await render(
      <TaskDetailContent
        {...requiredProps}
        onOpenRecords={onOpenRecords}
        task={{ ...completedTask, task_type: 'connector_sync', meta: { connector_sync_run_id: 'run-1' } }}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: '查看同步结果' }));

    expect(onOpenRecords).toHaveBeenCalledWith('run-1');
  });
});
