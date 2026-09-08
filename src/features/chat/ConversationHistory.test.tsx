import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import * as sessionsApi from '@/services/api/sessions';
import { useNetworkStore } from '@/services/network/networkStore';
import { semanticThemes } from '@/theme/tokens';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { ConversationHistory } from './ConversationHistory';
import { useChatStore } from './chatStore';

jest.mock('@/services/api/sessions', () => ({
  deleteSession: jest.fn(),
  getSessionDetail: jest.fn(),
  listSessions: jest.fn(),
}));

jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));

jest.mock('lucide-react-native', () => {
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;
  return { SquarePen: Icon, Trash2: Icon };
});

const useThemeSpy = jest.spyOn(ThemeProvider, 'useTheme');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('ConversationHistory', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    (showToast as jest.Mock).mockClear();
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([]);
    useThemeSpy.mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
    useChatStore.setState({ activeSessionId: null, deletingSessionId: null, isOffline: false, lastSyncedAt: null, messagesBySessionId: {}, sessions: [] });
    useNetworkStore.setState({ status: 'online' });
  });

  it('creates only a local pending session and opens chat from the new conversation command', async () => {
    const onSessionOpened = jest.fn();
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);

    await waitFor(() => expect(sessionsApi.listSessions).toHaveBeenCalledTimes(1));
    jest.clearAllMocks();

    await fireEvent.press(screen.getByRole('button', { name: '新建对话' }));

    expect(sessionsApi.listSessions).not.toHaveBeenCalled();
    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalled();
    expect(sessionsApi.deleteSession).not.toHaveBeenCalled();
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ pending: true })]);
    expect(onSessionOpened).toHaveBeenCalledTimes(1);
  });

  it('does not render a local pending session as an openable history item', async () => {
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '历史会话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' },
    ]);
    useChatStore.setState({
      activeSessionId: null,
      messagesBySessionId: {},
      sessions: [
        { session_id: 'pending-1', title: '新对话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00', pending: true },
        { session_id: 'server-1', title: '历史会话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' },
      ],
    });
    const screen = await render(<ConversationHistory onSessionOpened={jest.fn()} />);

    expect(screen.queryByText('新对话')).toBeNull();
    expect(screen.getByText('历史会话')).toBeTruthy();
    expect(sessionsApi.getSessionDetail).not.toHaveBeenCalled();
  });

  it('opens chat only after deleting the active server session', async () => {
    jest.spyOn(sessionsApi, 'deleteSession').mockResolvedValue(undefined);
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const onSessionOpened = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);

    await fireEvent.press(screen.getByRole('button', { name: '删除当前会话' }));
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    await act(async () => buttons[1]?.onPress?.());

    await waitFor(() => expect(onSessionOpened).toHaveBeenCalledTimes(1));
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ pending: true })]);
  });

  it('does not open chat after deleting another server session', async () => {
    jest.spyOn(sessionsApi, 'deleteSession').mockResolvedValue(undefined);
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      { session_id: 'server-2', title: '其他会话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' },
    ]);
    const onSessionOpened = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '其他会话', created_at: '2026-07-16T09:00:00+08:00', updated_at: '2026-07-16T09:00:00+08:00' },
      ],
    });
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);

    await fireEvent.press(screen.getByRole('button', { name: '删除其他会话' }));
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    await act(async () => buttons[1]?.onPress?.());

    await waitFor(() => expect(sessionsApi.deleteSession).toHaveBeenCalledWith('server-2'));
    expect(onSessionOpened).not.toHaveBeenCalled();
  });

  it('does not navigate when a history detail becomes stale after starting a new session', async () => {
    const detail = deferred<{ session_id: string; title: string; messages: [] }>();
    jest.spyOn(sessionsApi, 'getSessionDetail').mockReturnValue(detail.promise);
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '历史会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const onSessionOpened = jest.fn();
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);

    await fireEvent.press(screen.getByText('历史会话'));
    await fireEvent.press(screen.getByRole('button', { name: '新建对话' }));
    await act(async () => {
      detail.resolve({ session_id: 'server-1', title: '历史会话', messages: [] });
      await detail.promise;
    });

    expect(onSessionOpened).toHaveBeenCalledTimes(1);
  });

  it('removes a deleting session from the openable history list', async () => {
    const deletion = deferred<void>();
    jest.spyOn(sessionsApi, 'deleteSession').mockReturnValue(deletion.promise);
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const onSessionOpened = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    useChatStore.setState({
      activeSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [] },
      sessions: [{ session_id: 'server-1', title: '当前会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
    });
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);

    await fireEvent.press(screen.getByRole('button', { name: '删除当前会话' }));
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    const detailRequestCount = (sessionsApi.getSessionDetail as jest.Mock).mock.calls.length;
    await act(async () => buttons[1]?.onPress?.());

    await waitFor(() => expect(screen.queryByText('当前会话')).toBeNull());
    expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(detailRequestCount);
    expect(onSessionOpened).not.toHaveBeenCalled();

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
  });

  it('disables other history rows and delete actions while deletion is pending', async () => {
    const onSessionOpened = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    useChatStore.setState({
      activeSessionId: 'server-2',
      deletingSessionId: 'server-1',
      messagesBySessionId: { 'server-1': [], 'server-2': [] },
      sessions: [
        { session_id: 'server-1', title: '正在删除', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
        { session_id: 'server-2', title: '其他会话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      ],
    });
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);
    const historyRow = screen.getByText('其他会话').parent;
    const detailRequestCount = (sessionsApi.getSessionDetail as jest.Mock).mock.calls.length;

    expect(historyRow?.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByText('其他会话'));
    await fireEvent.press(screen.getByRole('button', { name: '删除其他会话' }));

    expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(detailRequestCount);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith('对话已删除', 'success');
    expect(onSessionOpened).not.toHaveBeenCalled();
  });

  it('keeps cached conversations writable after a temporary fallback while the device is online', async () => {
    const onSessionOpened = jest.fn();
    const screen = await render(<ConversationHistory onSessionOpened={onSessionOpened} />);
    await waitFor(() => expect(sessionsApi.listSessions).toHaveBeenCalled());
    await act(async () => {
      useChatStore.setState({
        activeSessionId: null,
        deletingSessionId: null,
        isOffline: true,
        lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00'),
        messagesBySessionId: {},
        sessions: [{ session_id: 'cached-1', title: '缓存对话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' }],
      });
    });
    await waitFor(() => expect(screen.getByText('缓存对话')).toBeTruthy());
    expect(screen.getByText('离线查看 · 上次同步 2026-07-16 15:05')).toBeTruthy();
    const historyRow = screen.getByText('缓存对话').parent;
    const detailRequestCount = (sessionsApi.getSessionDetail as jest.Mock).mock.calls.length;

    expect(historyRow?.props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByRole('button', { name: '新建对话' }).props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByRole('button', { name: '新建对话' }));

    expect(sessionsApi.getSessionDetail).toHaveBeenCalledTimes(detailRequestCount);
    expect(onSessionOpened).toHaveBeenCalledTimes(1);
  });

  it('disables history write actions when an open drawer loses connectivity', async () => {
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '在线对话', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const screen = await render(<ConversationHistory onSessionOpened={jest.fn()} />);
    await screen.findByText('在线对话');

    await act(async () => {
      useNetworkStore.setState({ status: 'offline' });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '新建对话' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: '删除在线对话' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('disables new and delete commands before connectivity is confirmed', async () => {
    useNetworkStore.setState({ status: 'unknown' });
    jest.spyOn(sessionsApi, 'listSessions').mockResolvedValue([
      { session_id: 'server-1', title: '待确认网络', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);
    const screen = await render(<ConversationHistory onSessionOpened={jest.fn()} />);

    await screen.findByText('待确认网络');
    expect(screen.getByRole('button', { name: '新建对话' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: '删除待确认网络' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('aborts history loading without showing a stale toast after unmount', async () => {
    let rejectRequest!: (error: Error) => void;
    const request = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
    jest.spyOn(sessionsApi, 'listSessions').mockReturnValue(request);
    const screen = await render(<ConversationHistory onSessionOpened={jest.fn()} />);

    await screen.unmount();
    await act(async () => {
      rejectRequest(new Error('late failure'));
      await request.catch(() => undefined);
    });

    expect(showToast).not.toHaveBeenCalled();
  });
});
