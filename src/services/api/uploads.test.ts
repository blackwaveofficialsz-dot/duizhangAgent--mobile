import { File } from 'expo-file-system';
import { apiRequest } from './client';
import { uploadFiles } from './uploads';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn((uri: string) => new Blob([uri], { type: 'application/octet-stream' })),
}));

describe('uploadFiles', () => {
  it('submits only the trusted multipart fields and preserves a Chinese filename', async () => {
    jest.mocked(apiRequest).mockResolvedValue({
      celery_task_id: 'celery-1',
      session_id: 'tenant-1:session-1',
      status: 'pending',
      task_id: 'task-1',
      task_type: 'file_parsing',
    });

    const controller = new AbortController();
    await uploadFiles({
      files: [{ mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' }],
      message: '请解析本月账单',
      period: '2026-07',
      replace: true,
      signal: controller.signal,
      sessionId: 'session-1',
      taskType: 'file_parsing',
    });

    expect(File).toHaveBeenCalledWith('file:///cache/meal.xlsx');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/chat/upload/async', expect.objectContaining({ method: 'POST', signal: controller.signal }));

    const form = jest.mocked(apiRequest).mock.calls[0][1]?.body as FormData;
    const names = Array.from(form.keys());
    expect(names).toEqual(['session_id', 'task_type', 'message', 'period', 'replace', 'files']);
    expect(names).not.toContain('tenant_id');
    expect(names).not.toContain('user_id');
    expect((form.get('files') as Blob & { name?: string }).name).toBe('美团_2026-07.xlsx');
  });

  it('throws a readable error when the server rejects the file period in a 200 response', async () => {
    jest.mocked(apiRequest).mockResolvedValue({
      detail: '以下文件账期不一致，请统一后再上传：美团_2026-06.xlsx',
      error: 'file_period_mismatch',
    });

    await expect(uploadFiles({
      files: [{ mimeType: 'application/vnd.ms-excel', name: '美团_2026-06.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' }],
      message: '',
      sessionId: 'session-1',
    })).rejects.toThrow('以下文件账期不一致，请统一后再上传：美团_2026-06.xlsx');
  });
});
