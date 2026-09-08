import { act } from '@testing-library/react-native';
import type { TaskRecord } from '@/types/task';
import { listTasks } from '@/services/api/tasks';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { getOfflineCacheIdentity, getOfflineCacheRepositories, runCurrentCacheOperation } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import { useTaskStore } from './taskStore';

jest.mock('@/services/api/tasks', () => ({ listTasks: jest.fn() }), { virtual: true });
jest.mock('@/services/cache/offlineCache', () => ({
  getOfflineCacheIdentity: jest.fn(),
  getOfflineCacheRepositories: jest.fn(),
  runCurrentCacheOperation: jest.fn(),
}));

const mockListTasks = listTasks as jest.MockedFunction<typeof listTasks>;
const mockGetOfflineCacheIdentity = getOfflineCacheIdentity as jest.MockedFunction<typeof getOfflineCacheIdentity>;
const mockGetOfflineCacheRepositories = getOfflineCacheRepositories as jest.MockedFunction<typeof getOfflineCacheRepositories>;
const mockRunCurrentCacheOperation = runCurrentCacheOperation as jest.MockedFunction<typeof runCurrentCacheOperation>;

const pendingTask: TaskRecord = {
  id: 'row-1',
  tenant_id: 'tenant',
  user_id: 'user',
  session_id: 'tenant:session',
  task_type: 'file_parsing',
  status: 'pending',
  task_id: 'task-1',
  celery_task_id: null,
  meta: null,
  created_at: '2026-07-16T15:00:00+08:00',
  updated_at: '2026-07-16T15:00:00+08:00',
  completed_at: null,
};

describe('taskStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockListTasks.mockReset();
    mockGetOfflineCacheIdentity.mockReturnValue(null);
    mockGetOfflineCacheRepositories.mockReset();
    mockRunCurrentCacheOperation.mockReset();
    mockRunCurrentCacheOperation.mockImplementation(async (operation) => {
      const identity = mockGetOfflineCacheIdentity();
      if (!identity) return null;
      return operation(await mockGetOfflineCacheRepositories(), identity);
    });
    useTaskStore.getState().stopPolling();
    useTaskStore.setState({ error: null, filters: {}, isForeground: true, isOffline: false, status: 'idle', tasks: [] });
    useNetworkStore.setState({ status: 'online' });
  });

  afterEach(() => {
    useTaskStore.getState().stopPolling();
    jest.useRealTimers();
  });

  it('only polls active tasks while the app is in the foreground', async () => {
    mockListTasks
      .mockResolvedValueOnce([pendingTask])
      .mockResolvedValueOnce([{ ...pendingTask, status: 'completed', completed_at: '2026-07-16T15:01:00+08:00' }]);

    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling();

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockListTasks).toHaveBeenCalledTimes(2);

    useTaskStore.getState().setForeground(false);
    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });
    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });

  it('starts polling when active tasks arrive after polling was enabled', async () => {
    mockListTasks
      .mockResolvedValueOnce([pendingTask])
      .mockResolvedValueOnce([{ ...pendingTask, status: 'completed', completed_at: '2026-07-16T15:01:00+08:00' }]);

    useTaskStore.getState().startPolling();
    await useTaskStore.getState().refresh();

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });

  it('keeps active research polling when the task list owner unmounts', async () => {
    mockListTasks.mockResolvedValue([{
      ...pendingTask,
      task_type: 'research',
      status: 'running',
      meta: { run_status: 'running' },
    }]);
    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling('task-list');
    useTaskStore.getState().startPolling('research:run-1');

    useTaskStore.getState().stopPolling('task-list');
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockListTasks).toHaveBeenCalledTimes(2);
    useTaskStore.getState().stopPolling('research:run-1');
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });

  it('keeps polling while a task is retrying', async () => {
    mockListTasks
      .mockResolvedValueOnce([{ ...pendingTask, status: 'retrying' }])
      .mockResolvedValueOnce([{ ...pendingTask, status: 'completed', completed_at: '2026-07-16T15:01:00+08:00' }]);

    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling();
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });

  it('passes the selected status and task type to every refresh', async () => {
    mockListTasks.mockResolvedValue([]);

    useTaskStore.getState().setFilters({ status: 'failed', taskType: 'file_parsing' });
    await useTaskStore.getState().refresh();

    expect(mockListTasks).toHaveBeenCalledWith({
      limit: 100,
      status: 'failed',
      taskType: 'file_parsing',
    });
  });

  it('keeps the last trusted task list when refresh fails', async () => {
    mockListTasks
      .mockResolvedValueOnce([pendingTask])
      .mockRejectedValueOnce(new Error('无法连接服务器'));

    await useTaskStore.getState().refresh();
    await useTaskStore.getState().refresh();

    expect(useTaskStore.getState()).toMatchObject({
      error: '无法连接服务器',
      status: 'error',
      tasks: [pendingTask],
    });
  });

  it('uses the current user cache only when the network is unavailable', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    const read = jest.fn().mockResolvedValue([{
      id: 'cached-row', task_id: 'cached-task', task_type: 'reconciliation', status: 'completed',
      created_at: '2026-07-16T15:00:00+08:00', updated_at: '2026-07-16T15:05:00+08:00', completed_at: '2026-07-16T15:05:00+08:00',
    }]);
    mockGetOfflineCacheIdentity.mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    mockGetOfflineCacheRepositories.mockResolvedValue({
      tasks: { lastSyncedAt: jest.fn().mockResolvedValue(cachedAt), read, save: jest.fn() },
    } as never);
    mockListTasks.mockRejectedValue(new Error(NETWORK_ERROR_MESSAGE));

    await useTaskStore.getState().refresh();

    expect(read).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, expect.any(Number));
    expect(useTaskStore.getState()).toMatchObject({
      isOffline: true,
      lastSyncedAt: cachedAt,
      status: 'idle',
      tasks: [expect.objectContaining({ id: 'cached-row', meta: { cached: true }, tenant_id: 'tenant-1', user_id: 'user-1' })],
    });
  });

  it('keeps current-user task details in memory when the network goes offline', async () => {
    const read = jest.fn().mockResolvedValue([]);
    mockGetOfflineCacheIdentity.mockReturnValue({ tenantId: 'tenant', userId: 'user' });
    mockGetOfflineCacheRepositories.mockResolvedValue({
      tasks: { lastSyncedAt: jest.fn(), read, save: jest.fn() },
    } as never);
    mockListTasks
      .mockResolvedValueOnce([{ ...pendingTask, meta: { download_url: '/api/v1/reports/download/report-1' } }])
      .mockRejectedValueOnce(new Error(NETWORK_ERROR_MESSAGE));

    await useTaskStore.getState().refresh();
    await useTaskStore.getState().refresh();

    expect(read).not.toHaveBeenCalled();
    expect(useTaskStore.getState()).toMatchObject({
      isOffline: true,
      status: 'idle',
      tasks: [expect.objectContaining({
        meta: { cached: true, download_url: '/api/v1/reports/download/report-1' },
        tenant_id: 'tenant',
        user_id: 'user',
      })],
    });
  });

  it('reads the current user cache without starting a request when the device is offline', async () => {
    const cachedAt = Date.parse('2026-07-16T15:05:00+08:00');
    const read = jest.fn().mockResolvedValue([{
      id: 'cached-row', task_id: 'cached-task', task_type: 'reconciliation', status: 'completed',
      created_at: '2026-07-16T15:00:00+08:00', updated_at: '2026-07-16T15:05:00+08:00', completed_at: '2026-07-16T15:05:00+08:00',
    }]);
    mockGetOfflineCacheIdentity.mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    mockGetOfflineCacheRepositories.mockResolvedValue({
      tasks: { lastSyncedAt: jest.fn().mockResolvedValue(cachedAt), read, save: jest.fn() },
    } as never);
    mockListTasks.mockResolvedValue([pendingTask]);
    useNetworkStore.setState({ status: 'offline' });

    await useTaskStore.getState().refresh();

    expect(mockListTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState()).toMatchObject({ isOffline: true, lastSyncedAt: cachedAt });
  });

  it('preserves the allowlisted research run status from offline cache', async () => {
    const read = jest.fn().mockResolvedValue([{
      id: 'cached-research', task_id: 'run-1', task_type: 'research', status: 'running',
      meta: { run_status: 'needs_review' },
      created_at: '2026-07-16T15:00:00+08:00', updated_at: '2026-07-16T15:05:00+08:00', completed_at: null,
    }]);
    mockGetOfflineCacheIdentity.mockReturnValue({ tenantId: 'tenant-1', userId: 'user-1' });
    mockGetOfflineCacheRepositories.mockResolvedValue({
      tasks: { lastSyncedAt: jest.fn().mockResolvedValue(Date.now()), read, save: jest.fn() },
    } as never);
    useNetworkStore.setState({ status: 'offline' });

    await useTaskStore.getState().refresh();

    expect(useTaskStore.getState().tasks[0]).toEqual(expect.objectContaining({
      meta: { cached: true, run_status: 'needs_review' },
    }));
  });

  it('does not restore or cache an old user response after the store is reset', async () => {
    let resolveTasks!: (tasks: TaskRecord[]) => void;
    mockGetOfflineCacheIdentity.mockReturnValue({ tenantId: 'tenant-new', userId: 'user-new' });
    mockListTasks.mockReturnValue(new Promise((resolve) => { resolveTasks = resolve; }));

    const refresh = useTaskStore.getState().refresh();
    useTaskStore.getState().reset();
    resolveTasks([pendingTask]);
    await refresh;

    expect(useTaskStore.getState()).toMatchObject({
      error: null,
      filters: {},
      isOffline: false,
      lastSyncedAt: null,
      status: 'idle',
      tasks: [],
    });
    expect(mockRunCurrentCacheOperation).not.toHaveBeenCalled();
  });
});
