import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type NativeEventSubscription } from 'react-native';
import TaskDetailRoute from '@/app/(app)/tasks/[taskId]';
import ConnectorRecordsRoute from '@/app/(app)/tasks/[taskId]/records';
import { getConnectorSyncRunRecords, type ConnectorRecordTable } from '@/services/api/connectors';
import { getTask } from '@/services/api/tasks';
import { useNetworkStore } from '@/services/network/networkStore';
import type { TaskRecord } from '@/types/task';
import { ConnectorRecordsScreen } from './ConnectorRecordsScreen';

const mockUseLocalSearchParams = jest.fn<Record<string, string>, []>();
const mockUseNavigation = jest.fn();
const mockUseRouter = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useNavigation: () => mockUseNavigation(),
  useRouter: () => mockUseRouter(),
}));
jest.mock('@/services/api/connectors', () => ({ getConnectorSyncRunRecords: jest.fn() }));
jest.mock('@/services/api/tasks', () => ({ getTask: jest.fn(), retryTaskFiles: jest.fn() }));

const pageOne: ConnectorRecordTable = {
  columns: [
    { field: 'store_name', label: '门店' },
    { field: 'amount', label: '金额' },
    { field: 'status', label: '状态' },
    { field: 'remark', label: '备注' },
    { field: 'source', label: '来源' },
  ],
  rows: [{ amount: 120, remark: null, source: 'connector', status: '已同步', store_name: '茅坡店' }],
  page: 1,
  page_size: 20,
  total: 21,
  total_pages: 2,
};

const pageTwo: ConnectorRecordTable = {
  ...pageOne,
  page: 2,
  rows: [{ amount: 150, remark: null, source: 'connector', status: '已同步', store_name: '东城店' }],
};

const connectorTask: TaskRecord = {
  celery_task_id: null,
  completed_at: '2026-07-18T10:00:00+08:00',
  created_at: '2026-07-18T09:00:00+08:00',
  id: 'connector-row',
  meta: { connector_sync_run_id: 'run-1' },
  session_id: 'tenant:session',
  status: 'completed',
  task_id: 'task-1',
  task_type: 'connector_sync',
  tenant_id: 'tenant',
  updated_at: '2026-07-18T10:00:00+08:00',
  user_id: 'user',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('ConnectorRecordsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    useNetworkStore.setState({ status: 'online' });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads records into a horizontal table and changes page', async () => {
    jest.mocked(getConnectorSyncRunRecords)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo);

    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    expect(await screen.findByText('门店')).toBeTruthy();
    expect(screen.getByTestId('connector-records-table').props.horizontal).toBe(true);
    expect(screen.getByText('茅坡店')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '下一页' })));

    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenLastCalledWith('run-1', 2, 20));
    expect(await screen.findByText('东城店')).toBeTruthy();
    expect(screen.getByText('共 21 条，第 2 / 2 页')).toBeTruthy();
  });

  it('formats only the built-in business_time column in Beijing time', async () => {
    jest.mocked(getConnectorSyncRunRecords).mockResolvedValue({
      columns: [
        { field: 'business_time', label: '业务时间' },
        { field: 'note', label: '备注' },
      ],
      page: 1,
      page_size: 20,
      rows: [{ business_time: '2026-07-18T00:30:00Z', note: '2026-07-18T00:30:00Z' }],
      total: 1,
      total_pages: 1,
    });

    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    expect(await screen.findByText('2026-07-18 08:30')).toBeTruthy();
    expect(screen.getByText('2026-07-18T00:30:00Z')).toBeTruthy();
  });

  it('resets to the first page when the page size changes', async () => {
    jest.mocked(getConnectorSyncRunRecords)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo)
      .mockResolvedValue({ ...pageOne, page_size: 50, total_pages: 1 });
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    await screen.findByText('茅坡店');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '下一页' })));
    expect(await screen.findByText('东城店')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '每页 50 条' })));

    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenLastCalledWith('run-1', 1, 50));
  });

  it('requests the last valid page when the current page becomes out of range', async () => {
    const outOfRangePage = { ...pageTwo, rows: [], total: 1, total_pages: 1 };
    const lastPage = {
      ...pageOne,
      rows: [{ amount: 180, remark: null, source: 'connector', status: '已同步', store_name: '有效末页' }],
      total: 1,
      total_pages: 1,
    };
    jest.mocked(getConnectorSyncRunRecords)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(outOfRangePage)
      .mockResolvedValueOnce(lastPage);
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    await screen.findByText('茅坡店');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '下一页' })));

    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenLastCalledWith('run-1', 1, 20));
    expect(await screen.findByText('有效末页')).toBeTruthy();
    expect(screen.getByText('共 1 条，第 1 / 1 页')).toBeTruthy();
  });

  it('keeps newer page data when an older request resolves last', async () => {
    const older = deferred<ConnectorRecordTable>();
    const newer = deferred<ConnectorRecordTable>();
    jest.mocked(getConnectorSyncRunRecords)
      .mockResolvedValueOnce(pageOne)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    await screen.findByText('茅坡店');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '下一页' })));
    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenCalledWith('run-1', 2, 20));
    await act(async () => useNetworkStore.setState({ status: 'offline' }));
    expect(screen.getByText('当前离线，无法加载同步结果')).toBeTruthy();
    await act(async () => useNetworkStore.setState({ status: 'online' }));
    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenCalledTimes(3));

    await act(async () => newer.resolve({
      ...pageTwo,
      rows: [{ amount: 200, remark: null, source: 'connector', status: '已同步', store_name: '新页数据' }],
    }));
    expect(await screen.findByText('新页数据')).toBeTruthy();
    await act(async () => older.resolve({
      ...pageTwo,
      rows: [{ amount: 100, remark: null, source: 'connector', status: '已同步', store_name: '旧页数据' }],
    }));
    await older.promise;

    expect(screen.getByText('新页数据')).toBeTruthy();
    expect(screen.queryByText('旧页数据')).toBeNull();
  });

  it('retries a failed request', async () => {
    jest.mocked(getConnectorSyncRunRecords)
      .mockRejectedValueOnce(new Error('服务暂不可用'))
      .mockResolvedValueOnce(pageOne);
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    expect(await screen.findByText('服务暂不可用')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '重新加载' })));

    expect(await screen.findByText('茅坡店')).toBeTruthy();
    expect(getConnectorSyncRunRecords).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when the service returns no rows', async () => {
    jest.mocked(getConnectorSyncRunRecords).mockResolvedValue({ ...pageOne, rows: [], total: 0, total_pages: 0 });

    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    expect(await screen.findByText('暂无同步记录')).toBeTruthy();
  });

  it('does not request records while offline', async () => {
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);

    expect(screen.getByText('当前离线，无法加载同步结果')).toBeTruthy();
    expect(getConnectorSyncRunRecords).not.toHaveBeenCalled();
  });

  it('resets pagination and clears old rows when runId changes', async () => {
    const nextRun = deferred<ConnectorRecordTable>();
    jest.mocked(getConnectorSyncRunRecords)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo)
      .mockReturnValueOnce(nextRun.promise);
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-1" />);
    await screen.findByText('茅坡店');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '下一页' })));
    await screen.findByText('东城店');

    await screen.rerender(<ConnectorRecordsScreen onBack={jest.fn()} runId="run-2" />);

    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenLastCalledWith('run-2', 1, 20));
    expect(screen.queryByText('东城店')).toBeNull();
    await act(async () => nextRun.resolve({
      ...pageOne,
      rows: [{ amount: 200, remark: null, source: 'connector', status: '已同步', store_name: '新运行门店' }],
    }));
    expect(await screen.findByText('新运行门店')).toBeTruthy();
  });

  it('shows a parameter error without requesting an empty runId', async () => {
    const screen = await render(<ConnectorRecordsScreen onBack={jest.fn()} runId="" />);

    expect(await screen.findByText('缺少同步运行 ID')).toBeTruthy();
    expect(getConnectorSyncRunRecords).not.toHaveBeenCalled();
  });
});

describe('connector records routes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as NativeEventSubscription);
    useNetworkStore.setState({ status: 'online' });
  });

  afterEach(() => {
    cleanup();
  });

  it('passes taskId and runId from the detail route to the records route', async () => {
    const goBack = jest.fn();
    const push = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ taskId: 'task-1' });
    mockUseNavigation.mockReturnValue({ getState: () => ({ index: 1 }), goBack });
    mockUseRouter.mockReturnValue({ push, replace: jest.fn() });
    jest.mocked(getTask).mockResolvedValue(connectorTask);

    const screen = await render(<TaskDetailRoute />);
    fireEvent.press(screen.getByRole('button', { name: '返回' }));
    await fireEvent.press(await screen.findByRole('button', { name: '查看同步结果' }));

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      pathname: '/tasks/[taskId]/records',
      params: { taskId: 'task-1', runId: 'run-1' },
    });
  });

  it('passes runId to the records screen and goes back within the task Stack', async () => {
    const goBack = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ runId: 'run-1', taskId: 'task-1' });
    mockUseNavigation.mockReturnValue({ getState: () => ({ index: 2 }), goBack });
    mockUseRouter.mockReturnValue({ replace: jest.fn() });

    jest.mocked(getConnectorSyncRunRecords).mockResolvedValue(pageOne);
    const screen = await render(<ConnectorRecordsRoute />);

    await waitFor(() => expect(getConnectorSyncRunRecords).toHaveBeenCalledWith('run-1', 1, 20));
    fireEvent.press(screen.getByRole('button', { name: '返回' }));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('returns a directly opened task detail to the task list instead of chat', async () => {
    const goBack = jest.fn();
    const replace = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ taskId: 'task-1' });
    mockUseNavigation.mockReturnValue({ getState: () => ({ index: 0 }), goBack });
    mockUseRouter.mockReturnValue({ push: jest.fn(), replace });
    jest.mocked(getTask).mockResolvedValue(connectorTask);

    const screen = await render(<TaskDetailRoute />);
    fireEvent.press(screen.getByRole('button', { name: '返回' }));

    expect(goBack).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/tasks');
  });

  it('returns directly opened records to their task detail instead of chat', async () => {
    const goBack = jest.fn();
    const replace = jest.fn();
    mockUseLocalSearchParams.mockReturnValue({ runId: 'run-1', taskId: 'task-1' });
    mockUseNavigation.mockReturnValue({ getState: () => ({ index: 0 }), goBack });
    mockUseRouter.mockReturnValue({ replace });
    jest.mocked(getConnectorSyncRunRecords).mockResolvedValue(pageOne);

    const screen = await render(<ConnectorRecordsRoute />);
    fireEvent.press(screen.getByRole('button', { name: '返回' }));

    expect(goBack).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith({
      pathname: '/tasks/[taskId]',
      params: { taskId: 'task-1' },
    });
  });
});
