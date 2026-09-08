import { act } from '@testing-library/react-native';
import { listTasks } from '@/services/api/tasks';
import { useNetworkStore } from '@/services/network/networkStore';
import type { TaskRecord } from '@/types/task';
import { taskRunStatus } from '@/types/task';
import { useTaskStore } from '../taskStore';

jest.mock('@/services/api/tasks', () => ({ listTasks: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({
  getOfflineCacheIdentity: jest.fn(() => null),
  runCurrentCacheOperation: jest.fn(async () => null),
}));

const mockListTasks = listTasks as jest.MockedFunction<typeof listTasks>;

function task(runStatus: string): TaskRecord {
  return {
    id: 'internal-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    session_id: 'session-1',
    task_type: 'research',
    status: runStatus === 'completed' ? 'completed' : 'running',
    task_id: 'run-1',
    celery_task_id: null,
    meta: { run_status: runStatus },
    created_at: '2026-08-10T10:00:00+08:00',
    updated_at: '2026-08-10T10:00:00+08:00',
    completed_at: null,
  };
}

function legacyTask(status: TaskRecord['status']): TaskRecord {
  return {
    ...task('completed'),
    id: 'legacy-1',
    task_id: 'legacy-task-1',
    task_type: 'reconciliation',
    status,
    meta: null,
  };
}

describe('research task polling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockListTasks.mockReset();
    useNetworkStore.setState({ status: 'online' });
    useTaskStore.getState().reset();
  });

  afterEach(() => {
    useTaskStore.getState().stopPolling();
    jest.useRealTimers();
  });

  it.each(['queued', 'running', 'validating'])('%s remains actively polled', async (status) => {
    mockListTasks.mockResolvedValue([task(status)]);

    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling();
    await act(async () => jest.advanceTimersByTimeAsync(3_000));

    expect(mockListTasks).toHaveBeenCalledTimes(2);
    expect(taskRunStatus(task(status))).toBe(status);
  });

  it.each([
    'waiting_for_data',
    'waiting_for_approval',
    'needs_review',
    'completed',
    'failed',
    'cancelled',
  ])('%s does not poll continuously', async (status) => {
    mockListTasks.mockResolvedValue([task(status)]);

    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling();
    await act(async () => jest.advanceTimersByTimeAsync(9_000));

    expect(mockListTasks).toHaveBeenCalledTimes(1);
    expect(taskRunStatus(task(status))).toBe(status);
  });

  it('keeps polling an active nonresearch task alongside waiting research', async () => {
    mockListTasks.mockResolvedValue([task('waiting_for_data'), legacyTask('running')]);

    await useTaskStore.getState().refresh();
    useTaskStore.getState().startPolling();
    await act(async () => jest.advanceTimersByTimeAsync(3_000));

    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });
});
