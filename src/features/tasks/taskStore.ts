import { create } from 'zustand';
import { NETWORK_ERROR_MESSAGE } from '@/services/api/client';
import { listTasks } from '@/services/api/tasks';
import { getOfflineCacheIdentity, runCurrentCacheOperation } from '@/services/cache/offlineCache';
import { isDeviceOffline } from '@/services/network/networkStore';
import { taskRunStatus, type TaskFilters, type TaskRecord } from '@/types/task';

type TaskLoadStatus = 'idle' | 'loading' | 'refreshing' | 'error';

type TaskState = {
  tasks: TaskRecord[];
  status: TaskLoadStatus;
  error: string | null;
  filters: TaskFilters;
  isForeground: boolean;
  isOffline: boolean;
  lastSyncedAt: number | null;
  reset: () => void;
  refresh: () => Promise<void>;
  setFilters: (filters: TaskFilters) => void;
  setForeground: (isForeground: boolean) => void;
  startPolling: (owner?: string) => void;
  stopPolling: (owner?: string) => void;
};

const POLL_INTERVAL_MS = 3000;
const DEFAULT_POLLING_OWNER = 'default';
const pollingOwners = new Set<string>();
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let actionGeneration = 0;
let refreshRequest = 0;

function hasActiveTasks(tasks: TaskRecord[]) {
  return tasks.some((task) => {
    const status = taskRunStatus(task);
    return task.task_type === 'research'
      ? status === 'queued' || status === 'running' || status === 'validating'
      : status === 'pending' || status === 'running' || status === 'retrying';
  });
}

function clearPollingTimer() {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
}

function schedulePolling() {
  clearPollingTimer();
  const state = useTaskStore.getState();
  if (!pollingOwners.size || !state.isForeground || isDeviceOffline() || !hasActiveTasks(state.tasks)) return;

  pollingTimer = setTimeout(() => {
    pollingTimer = null;
    void useTaskStore.getState().refresh();
  }, POLL_INTERVAL_MS);
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  status: 'idle',
  error: null,
  filters: {},
  isForeground: true,
  isOffline: false,
  lastSyncedAt: null,
  reset: () => {
    actionGeneration += 1;
    refreshRequest += 1;
    pollingOwners.clear();
    clearPollingTimer();
    set({
      error: null,
      filters: {},
      isForeground: true,
      isOffline: false,
      lastSyncedAt: null,
      status: 'idle',
      tasks: [],
    });
  },
  refresh: async () => {
    const generation = actionGeneration;
    const request = ++refreshRequest;
    const isCurrent = () => generation === actionGeneration && request === refreshRequest;
    const { filters, lastSyncedAt, tasks: previousTasks } = useTaskStore.getState();
    set({ error: null, status: previousTasks.length ? 'refreshing' : 'loading' });
    if (isDeviceOffline()) {
      const cached = await readCachedTasks(new Error(NETWORK_ERROR_MESSAGE), previousTasks, lastSyncedAt);
      if (!isCurrent()) return;
      set(cached ?? { error: null, isOffline: true, lastSyncedAt, status: 'idle', tasks: previousTasks });
      schedulePolling();
      return;
    }
    try {
      const response = await listTasks({ ...filters, limit: 100 });
      if (!isCurrent()) return;
      const tasks = response.filter((task) => (
        (!filters.status || task.status === filters.status)
        && (!filters.taskType || task.task_type === filters.taskType)
      ));
      set({ tasks, status: 'idle', error: null, isOffline: false, lastSyncedAt: Date.now() });
      saveCachedTasks(tasks);
    } catch (error) {
      if (!isCurrent()) return;
      const cached = await readCachedTasks(error, previousTasks, lastSyncedAt);
      if (!isCurrent()) return;
      if (cached) {
        set(cached);
        return;
      }
      set({
        tasks: previousTasks,
        status: 'error',
        error: error instanceof Error ? error.message : '任务加载失败，请稍后重试',
      });
    } finally {
      if (isCurrent()) schedulePolling();
    }
  },
  setFilters: (filters) => set({ filters }),
  setForeground: (isForeground) => {
    set({ isForeground });
    if (isForeground) schedulePolling();
    else clearPollingTimer();
  },
  startPolling: (owner = DEFAULT_POLLING_OWNER) => {
    pollingOwners.add(owner);
    schedulePolling();
  },
  stopPolling: (owner = DEFAULT_POLLING_OWNER) => {
    pollingOwners.delete(owner);
    if (pollingOwners.size) schedulePolling();
    else clearPollingTimer();
  },
}));

async function readCachedTasks(
  error: unknown,
  previousTasks: TaskRecord[],
  lastSyncedAt: number | null,
): Promise<Pick<TaskState, 'error' | 'isOffline' | 'lastSyncedAt' | 'status' | 'tasks'> | null> {
  if (!(error instanceof Error) || error.message !== NETWORK_ERROR_MESSAGE) return null;
  const identity = getOfflineCacheIdentity();
  if (!identity) return null;
  if (previousTasks.length && previousTasks.every((task) => task.tenant_id === identity.tenantId && task.user_id === identity.userId)) {
    return {
      error: null,
      isOffline: true,
      lastSyncedAt,
      status: 'idle',
      tasks: previousTasks.map((task) => ({ ...task, meta: { ...(task.meta ?? {}), cached: true } })),
    };
  }
  try {
    return await runCurrentCacheOperation(async (repositories, currentIdentity) => {
      const now = Date.now();
      const tasks = await repositories.tasks.read(currentIdentity, now);
      if (!tasks.length) return null;
      const lastSyncedAt = await repositories.tasks.lastSyncedAt(currentIdentity, now);
      return {
        error: null,
        isOffline: true,
        lastSyncedAt,
        status: 'idle' as const,
        tasks: tasks.map((task) => ({
          ...task,
          celery_task_id: null,
          meta: { ...(task.meta ?? {}), cached: true },
          session_id: '',
          tenant_id: currentIdentity.tenantId,
          user_id: currentIdentity.userId,
        })),
      };
    });
  } catch {
    return null;
  }
}

function saveCachedTasks(tasks: TaskRecord[]): void {
  void runCurrentCacheOperation((repositories, identity) => (
    repositories.tasks.save(identity, tasks, Date.now())
  )).catch(() => {});
}
