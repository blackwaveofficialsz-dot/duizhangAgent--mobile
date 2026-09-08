import { apiRequest } from './client';
import { listTasks } from './tasks';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

describe('tasks API', () => {
  it('serializes status and task type with the backend query names', async () => {
    jest.mocked(apiRequest).mockResolvedValue([]);

    await listTasks({ status: 'failed', taskType: 'file_parsing', limit: 25 });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/tasks?status=failed&task_type=file_parsing&limit=25',
    );
  });
});
