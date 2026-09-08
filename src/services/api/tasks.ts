import { apiRequest } from './client';
import type { RetryFilesResult, TaskFilters, TaskRecord } from '@/types/task';

export function listTasks(filters: TaskFilters = {}): Promise<TaskRecord[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.taskType) params.set('task_type', filters.taskType);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.size ? `?${params}` : '';
  return apiRequest<TaskRecord[]>(`/api/v1/tasks${query}`);
}

export function getTask(taskId: string): Promise<TaskRecord> {
  return apiRequest<TaskRecord>(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
}

export function retryTaskFiles(taskId: string): Promise<RetryFilesResult> {
  return apiRequest<RetryFilesResult>(`/api/v1/tasks/${encodeURIComponent(taskId)}/retry-files`, {
    method: 'POST',
  });
}
