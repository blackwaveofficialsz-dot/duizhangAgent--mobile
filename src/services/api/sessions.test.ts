import { apiRequest } from './client';
import { getSessionDetail, listSessions } from './sessions';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

describe('sessions API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('forwards AbortSignal to list and detail requests', async () => {
    const controller = new AbortController();
    jest.mocked(apiRequest)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ session_id: 'tenant-99:session-1', title: '会话', messages: [] });

    await listSessions(controller.signal);
    await getSessionDetail('tenant-99:session-1', controller.signal);

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/v1/sessions', { signal: controller.signal });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/v1/sessions/tenant-99%3Asession-1', { signal: controller.signal });
  });
});
