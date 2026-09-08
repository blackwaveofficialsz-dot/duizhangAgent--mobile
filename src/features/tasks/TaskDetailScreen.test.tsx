import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import { getTask, retryTaskFiles } from '@/services/api/tasks';
import { downloadAndShareReport } from '@/services/files/downloadReport';
import { useNetworkStore } from '@/services/network/networkStore';
import type { TaskRecord } from '@/types/task';
import { TaskDetailScreen } from './TaskDetailScreen';
import { useTaskStore } from './taskStore';

jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));
jest.mock('lucide-react-native', () => {
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;
  return {
    ArrowLeft: Icon,
    CheckCircle2: Icon,
    CircleAlert: Icon,
    Clock3: Icon,
    Database: Icon,
    Download: Icon,
    LoaderCircle: Icon,
    RefreshCw: Icon,
  };
});
jest.mock('@/services/api/tasks', () => ({
  getTask: jest.fn(),
  listTasks: jest.fn(),
  retryTaskFiles: jest.fn(),
}));
jest.mock('@/services/files/downloadReport', () => ({ downloadAndShareReport: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  getOfflineCacheIdentity: jest.fn(() => null),
  getOfflineCacheRepositories: jest.fn(),
}));

const failedTask: TaskRecord = {
  id: 'row-failed',
  tenant_id: 'tenant',
  user_id: 'user',
  session_id: 'tenant:session',
  task_type: 'file_parsing',
  status: 'failed',
  task_id: 'task-failed',
  celery_task_id: null,
  meta: {
    agent_message: '处理失败',
    error: '工作表缺少金额列',
    retryable_files: [{ filename: '订单.xlsx' }],
  },
  created_at: '2026-07-16T15:00:00+08:00',
  updated_at: '2026-07-16T15:01:00+08:00',
  completed_at: '2026-07-16T15:01:00+08:00',
};

const completedTask: TaskRecord = {
  ...failedTask,
  id: 'row-completed',
  task_id: 'task-completed',
  task_type: 'finance_report',
  status: 'completed',
  meta: { download_url: '/api/v1/reports/download/report-1', task_name: '7 月对账' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('TaskDetailScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as NativeEventSubscription);
    useTaskStore.getState().stopPolling();
    useTaskStore.setState({ error: null, isOffline: false, status: 'idle', tasks: [] });
    useNetworkStore.setState({ status: 'online' });
  });

  it('shows the backend failure reason and retry only for retryable file parsing', async () => {
    jest.mocked(getTask).mockResolvedValue(failedTask);

    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);

    await waitFor(() => expect(screen.getAllByText('工作表缺少金额列')).toHaveLength(2));
    expect(screen.getByText('处理失败')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试失败文件' })).toBeTruthy();
  });

  it('keeps the shared navigation bar visible while loading and after an error', async () => {
    const pending = deferred<TaskRecord>();
    jest.mocked(getTask).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('任务不存在或无权访问'));
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="missing" />);

    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
    await act(async () => pending.resolve(failedTask));
    await screen.findAllByText('工作表缺少金额列');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '刷新' })));
    expect(await screen.findByText('任务不存在或无权访问')).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
  });

  it('retries visible failed files and reloads trusted task state', async () => {
    jest.mocked(getTask)
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce({ ...failedTask, status: 'pending' });
    jest.mocked(retryTaskFiles).mockResolvedValue({ ok: true, retry_files: 1, task_id: 'task-failed' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);

    await act(async () => {
      fireEvent.press(await screen.findByRole('button', { name: '重试失败文件' }));
    });

    await waitFor(() => expect(retryTaskFiles).toHaveBeenCalledWith('task-failed'));
    expect(showToast).toHaveBeenCalledWith('已重新提交 1 个文件', 'success');
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('shares a completed report through the report service', async () => {
    jest.mocked(getTask).mockResolvedValue(completedTask);
    jest.mocked(downloadAndShareReport).mockResolvedValue();
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);

    await act(async () => {
      fireEvent.press(await screen.findByRole('button', { name: '下载并分享报告' }));
    });

    await waitFor(() => expect(downloadAndShareReport).toHaveBeenCalledWith('/api/v1/reports/download/report-1'));
  });

  it('passes the connector sync run id to the records callback', async () => {
    const onOpenRecords = jest.fn();
    jest.mocked(getTask).mockResolvedValue({
      ...completedTask,
      task_id: 'task-connector',
      task_type: 'connector_sync',
      meta: { connector_sync_run_id: 'run-connector' },
    });
    const screen = await render(
      <TaskDetailScreen onBack={jest.fn()} onOpenRecords={onOpenRecords} taskId="task-connector" />,
    );

    fireEvent.press(await screen.findByRole('button', { name: '查看同步结果' }));

    expect(onOpenRecords).toHaveBeenCalledWith('run-connector');
  });

  it('uses cached detail and disables refresh and sharing while offline', async () => {
    useTaskStore.setState({ isOffline: true, tasks: [completedTask] });
    useNetworkStore.setState({ status: 'offline' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);

    expect(await screen.findByText('当前为离线状态，刷新、重试和分享暂不可用')).toBeTruthy();
    const refresh = screen.getByRole('button', { name: '刷新' });
    const share = screen.getByRole('button', { name: '下载并分享报告' });
    expect(refresh.props.accessibilityState).toMatchObject({ disabled: true });
    expect(share.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(refresh);
    fireEvent.press(share);
    expect(getTask).not.toHaveBeenCalled();
    expect(downloadAndShareReport).not.toHaveBeenCalled();
  });

  it('keeps retry visible but disabled while offline', async () => {
    useTaskStore.setState({ isOffline: true, tasks: [failedTask] });
    useNetworkStore.setState({ status: 'offline' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);

    const retry = await screen.findByRole('button', { name: '重试失败文件' });
    expect(retry.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(retry);
    expect(retryTaskFiles).not.toHaveBeenCalled();
  });

  it('keeps retry disabled before connectivity is confirmed', async () => {
    jest.mocked(getTask).mockResolvedValue(failedTask);
    useNetworkStore.setState({ status: 'unknown' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);

    const retry = await screen.findByRole('button', { name: '重试失败文件' });
    expect(retry.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(retry);
    expect(retryTaskFiles).not.toHaveBeenCalled();
  });

  it('uses cached detail and blocks actions immediately when the device is offline', async () => {
    useTaskStore.setState({ isOffline: false, tasks: [completedTask] });
    useNetworkStore.setState({ status: 'offline' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);

    expect(await screen.findByText('当前为离线状态，刷新、重试和分享暂不可用')).toBeTruthy();
    expect(getTask).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '刷新' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('refreshes cached detail when the device is online after a temporary fallback', async () => {
    useTaskStore.setState({ isOffline: true, tasks: [completedTask] });
    jest.mocked(getTask).mockResolvedValue({ ...completedTask, status: 'running' });

    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);

    await waitFor(() => expect(getTask).toHaveBeenCalledWith('task-completed'));
    expect(await screen.findByText('执行中')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新' }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('keeps the newest trusted detail when concurrent requests resolve out of order', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove: jest.fn() } as NativeEventSubscription;
    });
    const older = deferred<TaskRecord>();
    const newer = deferred<TaskRecord>();
    jest.mocked(getTask).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);

    await act(async () => listener?.('active'));
    newer.resolve({ ...failedTask, status: 'running' });
    await screen.findByText('执行中');
    older.resolve(failedTask);
    await older.promise;

    expect(screen.getByText('执行中')).toBeTruthy();
    expect(screen.queryByText('失败')).toBeNull();
  });

  it('clears the previous detail when taskId changes and the next load fails', async () => {
    jest.mocked(getTask)
      .mockResolvedValueOnce(completedTask)
      .mockRejectedValueOnce(new Error('新任务不存在'));
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);
    await screen.findAllByText('7 月对账');

    await screen.rerender(<TaskDetailScreen onBack={jest.fn()} taskId="task-missing" />);

    expect(await screen.findByText('新任务不存在')).toBeTruthy();
    expect(screen.queryAllByText('7 月对账')).toHaveLength(0);
  });

  it('does not reload the previous task when retry finishes after taskId changes', async () => {
    const pendingRetry = deferred<{ ok: boolean; retry_files: number; task_id: string }>();
    jest.mocked(getTask)
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce(completedTask);
    jest.mocked(retryTaskFiles).mockReturnValueOnce(pendingRetry.promise);
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: '重试失败文件' })));
    await waitFor(() => expect(retryTaskFiles).toHaveBeenCalledWith('task-failed'));

    await screen.rerender(<TaskDetailScreen onBack={jest.fn()} taskId="task-completed" />);
    await screen.findAllByText('7 月对账');
    await act(async () => pendingRetry.resolve({ ok: true, retry_files: 1, task_id: 'task-failed' }));
    await pendingRetry.promise;

    expect(getTask).toHaveBeenCalledTimes(2);
    expect(getTask).toHaveBeenNthCalledWith(1, 'task-failed');
    expect(getTask).toHaveBeenNthCalledWith(2, 'task-completed');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows the service error on the first failed load', async () => {
    jest.mocked(getTask).mockRejectedValue(new Error('任务不存在或无权访问'));

    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="missing" />);

    expect(await screen.findByText('任务不存在或无权访问')).toBeTruthy();
  });

  it('reloads trusted task state when the app returns to the foreground', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, nextListener) => {
      listener = nextListener;
      return { remove } as NativeEventSubscription;
    });
    jest.mocked(getTask)
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce({ ...failedTask, status: 'pending' });
    const screen = await render(<TaskDetailScreen onBack={jest.fn()} taskId="task-failed" />);
    await screen.findAllByText('工作表缺少金额列');

    await act(async () => listener?.('active'));

    await waitFor(() => expect(getTask).toHaveBeenCalledTimes(2));
    await screen.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
