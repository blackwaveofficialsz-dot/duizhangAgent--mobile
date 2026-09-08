import { File } from 'expo-file-system';
import { apiRequest } from './client';

export type UploadDocument = {
  mimeType: string | null;
  name: string;
  size: number | null;
  uri: string;
};

type UploadTaskType = 'file_parsing' | 'reconciliation';

type UploadFilesInput = {
  files: UploadDocument[];
  message: string;
  period?: string;
  replace?: boolean;
  signal?: AbortSignal;
  sessionId: string;
  taskType?: UploadTaskType;
};

export type UploadResult = {
  celery_task_id?: string;
  duplicate?: boolean;
  existing_sources?: unknown[];
  period?: string;
  session_id?: string;
  status?: string;
  task_id?: string;
  task_type?: UploadTaskType;
};

type UploadValidationError = {
  detail?: string;
  error: string;
};

export async function uploadFiles({
  files,
  message,
  period,
  replace = false,
  signal,
  sessionId,
  taskType = 'file_parsing',
}: UploadFilesInput): Promise<UploadResult> {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('task_type', taskType);
  form.append('message', message);
  if (period) form.append('period', period);
  if (replace) form.append('replace', 'true');
  for (const document of files) form.append('files', new File(document.uri), document.name);

  const result = await apiRequest<UploadResult | UploadValidationError>('/api/v1/chat/upload/async', {
    body: form,
    method: 'POST',
    signal,
  });
  if ('error' in result) throw new Error(result.detail || '文件校验失败，请检查后重试');
  return result;
}
