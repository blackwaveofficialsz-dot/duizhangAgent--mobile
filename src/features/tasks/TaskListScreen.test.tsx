import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { listTasks } from '@/services/api/tasks';
import { useNetworkStore } from '@/services/network/networkStore';
import type { TaskRecord } from '@/types/task';
import { TaskListScreen } from './TaskListScreen';
import { useTaskStore } from './taskStore';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('lucide-react-native', () => {
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;
  return { CheckCircle2: Icon, CircleAlert: Icon, Clock3: Icon, Database: Icon, LoaderCircle: Icon, RefreshCw: Icon };
});
jest.mock('@/services/api/tasks', () => ({ listTasks: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  getOfflineCacheIdentity: jest.fn(() => null),
  getOfflineCacheRepositories: jest.fn(),
  runCurrentCacheOperation: jest.fn(() => Promise.resolve(null)),
}));

const mockListTasks = jest.mocked(listTasks);
const completedTask: TaskRecord = {
  id: 'row-1',
  tenant_id: 'tenant',
  user_id: 'user',
  session_id: 'tenant:session',
  task_type: 'reconciliation',
  status: 'completed',
  task_id: 'task-1',
  celery_task_id: null,
  meta: { task_name: '7 月对账' },
  created_at: '2026-07-16T15:00:00+08:00',
  updated_at: '2026-07-16T15:01:00+08:00',
  completed_at: '2026-07-16T15:01:00+08:00',
};
const failedFileTask: TaskRecord = {
  ...completedTask,
  id: 'row-failed-file',
  task_id: 'task-failed-file',
  task_type: 'file_parsing',
  status: 'failed',
  meta: { task_name: '失败文件任务' },
};
const failedConnectorTask: TaskRecord = {
  ...completedTask,
  id: 'row-failed-connector',
  task_id: 'task-failed-connector',
  task_type: 'connector_sync',
  status: 'failed',
  meta: { task_name: '失败连接器任务' },
};
const waitingResearchTask: TaskRecord = {
  ...completedTask,
  id: 'row-waiting-research',
  task_id: 'research-1',
  task_type: 'research',
  status: 'running',
  meta: { run_status: 'waiting_for_approval' },
};

describe('TaskListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTaskStore.getState().stopPolling();
    useTaskStore.setState({
      error: null,
      filters: {},
      isForeground: true,
      isOffline: false,
      status: 'idle',
      tasks: [],
    });
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    useNetworkStore.setState({ status: 'online' });
  });

  afterEach(() => useTaskStore.getState().stopPolling());

  it('requests tasks with the selected status and task type', async () => {
    mockListTasks
      .mockResolvedValueOnce([completedTask])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const screen = await render(<TaskListScreen />);
    await waitFor(() => expect(mockListTasks).toHaveBeenCalledWith({ limit: 100 }));
    await screen.findByText('7 月对账');
    expect(screen.queryByText('任务')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: '状态筛选：失败' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockListTasks).toHaveBeenLastCalledWith({ limit: 100, status: 'failed' }));
    await screen.findByText('暂无内容');
    expect(screen.getByRole('button', { name: '状态筛选：全部' })).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: '类型筛选：文件解析' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockListTasks).toHaveBeenLastCalledWith({
      limit: 100,
      status: 'failed',
      taskType: 'file_parsing',
    }));
    await waitFor(() => expect(useTaskStore.getState().status).toBe('idle'));
  });

  it('applies status and type locally when the server ignores task filters', async () => {
    const unfilteredResponse = [completedTask, failedFileTask, failedConnectorTask];
    mockListTasks.mockResolvedValue(unfilteredResponse);
    const screen = await render(<TaskListScreen />);
    await screen.findByText('7 月对账');

    await act(async () => fireEvent.press(screen.getByRole('button', { name: '状态筛选：失败' })));
    await waitFor(() => expect(mockListTasks).toHaveBeenLastCalledWith({ limit: 100, status: 'failed' }));
    expect(await screen.findByText('失败文件任务')).toBeTruthy();
    expect(screen.getByText('失败连接器任务')).toBeTruthy();
    expect(screen.queryByText('7 月对账')).toBeNull();
    expect(screen.getByRole('button', { name: '状态筛选：失败' }).props.accessibilityState)
      .toMatchObject({ selected: true });

    await act(async () => fireEvent.press(screen.getByRole('button', { name: '类型筛选：文件解析' })));
    await waitFor(() => expect(mockListTasks).toHaveBeenLastCalledWith({
      limit: 100,
      status: 'failed',
      taskType: 'file_parsing',
    }));
    expect(await screen.findByText('失败文件任务')).toBeTruthy();
    expect(screen.queryByText('失败连接器任务')).toBeNull();
    expect(screen.getByRole('button', { name: '类型筛选：文件解析' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('opens a cached task detail while offline', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    mockListTasks.mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));
    useTaskStore.setState({ isOffline: true, tasks: [completedTask] });
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<TaskListScreen />);
    fireEvent.press(await screen.findByRole('button', { name: '查看任务：7 月对账' }));

    expect(push).toHaveBeenCalledWith({ pathname: '/tasks/[taskId]', params: { taskId: 'task-1' } });
  });

  it('keeps refresh and filters enabled after a temporary cache fallback', async () => {
    mockListTasks.mockResolvedValue([completedTask]);
    useTaskStore.setState({ isOffline: true, tasks: [completedTask] });

    const screen = await render(<TaskListScreen />);
    await screen.findByText('7 月对账');

    expect(screen.getByRole('button', { name: '刷新任务' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByRole('button', { name: '状态筛选：失败' }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('disables refresh and filters when an open task list loses connectivity', async () => {
    mockListTasks.mockResolvedValue([completedTask]);
    const screen = await render(<TaskListScreen />);
    await screen.findByText('7 月对账');

    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '刷新任务' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: '状态筛选：失败' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows the service error on the first failed list load', async () => {
    mockListTasks.mockRejectedValue(new Error('任务列表无权访问'));

    const screen = await render(<TaskListScreen />);

    expect(await screen.findByText('任务列表无权访问')).toBeTruthy();
  });

  it('offers Research Agent filtering and persisted research status labels', async () => {
    mockListTasks.mockResolvedValue([waitingResearchTask]);
    const screen = await render(<TaskListScreen />);

    expect(await screen.findByRole('button', { name: '查看任务：Research Agent' })).toBeTruthy();
    expect(screen.getByText('等待审批')).toBeTruthy();
    expect(screen.getByRole('button', { name: '类型筛选：Research Agent' })).toBeTruthy();
  });
});
