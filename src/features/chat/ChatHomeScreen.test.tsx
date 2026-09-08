import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Keyboard, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { uploadFiles } from '@/services/api/uploads';
import { getSessionDetail, listSessions } from '@/services/api/sessions';
import { getOrders, getRevenueAlerts } from '@/services/api/analytics';
import { getOperationsOverview } from '@/services/api/operationsAnalytics';
import { pickDocuments } from '@/services/files/pickDocuments';
import { useNetworkStore } from '@/services/network/networkStore';
import { beijingToday } from '@/utils/time';
import { useChatStore } from './chatStore';
import { structuredMessage } from '@/test/agentResponseFixture';
import { ChatHomeScreen } from './ChatHomeScreen';
import { useChatStream } from './useChatStream';

const mockAppStateListeners: Array<(state: string) => void> = [];

jest.mock('react-native', () => {
  const React = require('react');
  const actual = jest.requireActual('react-native');

  return new Proxy(actual, {
    get(target, property) {
      if (property === 'AppState') {
        return {
          addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
            mockAppStateListeners.push(listener);
            return { remove: jest.fn() };
          }),
          currentState: 'active',
        };
      }
      if (property === 'KeyboardAvoidingView') {
        return ({ behavior, children, ...props }: { behavior?: string; children: React.ReactNode }) => (
          React.createElement(actual.View, { ...props, keyboardAvoidingBehavior: behavior }, children)
        );
      }
      return target[property];
    },
  });
});
jest.mock('./useChatStream', () => ({ useChatStream: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/components/layout/AppHeader', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    APP_HEADER_HEIGHT: 56,
    AppHeader: ({ leadingAction, title, trailingAction }: {
      leadingAction?: { onPress: () => void; type: string };
      title: string;
      trailingAction?: { onPress: () => void; type: string };
    }) => (
      <View>
        {leadingAction ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={leadingAction.onPress} /> : null}
        <Text>{title}</Text>
        {trailingAction ? <Pressable accessibilityRole="button" accessibilityLabel="打开历史记录" onPress={trailingAction.onPress} /> : null}
      </View>
    ),
  };
});
jest.mock('@/services/api/analytics', () => ({ getOrders: jest.fn(), getRevenueAlerts: jest.fn() }));
jest.mock('@/services/api/operationsAnalytics', () => ({ getOperationsOverview: jest.fn() }));
jest.mock('@/utils/time', () => ({ ...jest.requireActual('@/utils/time'), beijingToday: jest.fn(() => '2026-09-01') }));
jest.mock('@/services/api/uploads', () => ({ uploadFiles: jest.fn() }));
jest.mock('@/services/api/sessions', () => ({ getSessionDetail: jest.fn(), listSessions: jest.fn() }));
jest.mock('@/services/files/pickDocuments', () => ({ cleanupPickedDocuments: jest.fn(), pickDocuments: jest.fn() }));
jest.mock('lucide-react-native', () => {
  const actual = jest.requireActual('lucide-react-native');
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;
  return { ...actual, Menu: actual.Menu ?? Icon, SquarePen: actual.SquarePen ?? Icon, Trash2: actual.Trash2 ?? Icon };
});
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: 'chat-safe-area-provider' }, children),
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement(View, { ...props, testID: 'chat-safe-area' }, children),
    useSafeAreaInsets: jest.fn(),
  };
});

const defaultPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('ChatHomeScreen', () => {
  beforeEach(() => {
    mockAppStateListeners.length = 0;
    useChatStore.getState().reset();
    useNetworkStore.setState({ status: 'online' });
    jest.mocked(beijingToday).mockReset().mockReturnValue('2026-09-01');
    jest.mocked(useRouter).mockReturnValue({
      back: jest.fn(),
      canGoBack: jest.fn(() => true),
      push: jest.fn(),
      replace: jest.fn(),
    } as never);
    jest.mocked(useSafeAreaInsets).mockReturnValue({ bottom: 34, left: 0, right: 0, top: 0 });
    jest.mocked(listSessions).mockReset().mockResolvedValue([]);
    jest.mocked(getSessionDetail).mockReset().mockResolvedValue({ messages: [], session_id: 'server-1', title: '历史会话' });
    jest.mocked(getOrders).mockReset().mockResolvedValue({
      rows: [
        {
          avg_order_value: 17.8,
          dim_key: 'ALL',
          dim_label: '总计',
          net_income: 101512,
          order_count: 5704,
          refund_rate: 0.02,
        },
      ],
      snapshot_status: 'ready',
    });
    jest.mocked(getRevenueAlerts).mockReset().mockResolvedValue([
      {
        actual_amount: 16900,
        baseline_amount: 20361,
        business_date: '2026-08-27',
        deviation_pct: -0.17,
        direction: 'under',
        shop_key: 'maopo',
        shop_label: '茅坡店',
        status: 'open',
      },
      {
        actual_amount: 11200,
        baseline_amount: 13200,
        business_date: '2026-08-27',
        deviation_pct: -0.1515,
        direction: 'under',
        reason_hints: ['外卖订单详情仍在处理中'],
        shop_key: 'xijing',
        shop_label: '西京医院店',
        status: 'open',
      },
    ]);
    jest.mocked(getOperationsOverview).mockReset().mockResolvedValue({
      channels: [],
      metrics: {
        avg_order_value: { change_rate: -0.02, current: 17.8, difference: -0.36, previous: 18.16, status: 'ok' },
        net_income: { change_rate: 0.079, current: 101512, difference: 7432, previous: 94080, status: 'ok' },
        order_count: { change_rate: 0.101, current: 5704, difference: 523, previous: 5181, status: 'ok' },
      },
      period: { date_from: '2026-08-27', date_to: '2026-08-27' },
      platforms: [],
      previous_period: { date_from: '2026-08-26', date_to: '2026-08-26' },
      store_channels: [],
      stores: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setPlatformOS(defaultPlatformOS);
  });

  it('uses the app-level safe-area provider instead of resetting insets inside the screen', async () => {
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.queryByTestId('chat-safe-area-provider')).toBeNull();
  });

  it('on iOS keeps the standalone composer above the home indicator while the keyboard is hidden', async () => {
    setPlatformOS('ios');
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.getByTestId('chat-safe-area').props.edges).toEqual(['left', 'right']);
    expect(screen.getByTestId('chat-composer').parent).toHaveStyle({ paddingBottom: 44 });
  });

  it('on iOS shrinks the chat container when the keyboard opens', async () => {
    setPlatformOS('ios');
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.getByTestId('chat-keyboard-area').props.keyboardAvoidingBehavior).toBe('height');
  });

  it('on iOS offsets keyboard coordinates by the safe area and app header', async () => {
    setPlatformOS('ios');
    jest.mocked(useSafeAreaInsets).mockReturnValue({ bottom: 34, left: 0, right: 0, top: 59 });
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.getByTestId('chat-keyboard-area').props.keyboardVerticalOffset).toBe(115);
  });

  it('on iOS does not subscribe to keyboard visibility just for footer spacing', async () => {
    setPlatformOS('ios');
    const addListener = jest.spyOn(Keyboard, 'addListener');
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);
    expect(screen.getByTestId('chat-composer').parent).toHaveStyle({ paddingBottom: 44 });
    expect(addListener).not.toHaveBeenCalled();
  });

  it('on Android keeps compact composer spacing without iOS bottom inset', async () => {
    setPlatformOS('android');
    const addListener = jest.spyOn(Keyboard, 'addListener');
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.getByTestId('chat-safe-area').props.edges).toEqual(['left', 'right']);
    expect(screen.getByTestId('chat-composer').parent).toHaveStyle({ paddingBottom: 10 });
    expect(addListener).not.toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
    expect(addListener).not.toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
  });

  it('opens the task route with the message task ID', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });
    useChatStore.setState({
      activeSessionId: 'tenant-99:session-task',
      messagesBySessionId: {
        'tenant-99:session-task': [
          { id: 'assistant-task', role: 'assistant', content: '任务已创建', created_at: '2026-07-16T10:00:00+08:00', task_id: 'task-7' },
        ],
      },
    });

    const screen = await render(<ChatHomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '查看关联任务' }));

    expect(push).toHaveBeenCalledWith({ pathname: '/tasks/[taskId]', params: { taskId: 'task-7' } });
  });

  it('renders the default business overview from analytics APIs when the conversation is empty', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(await screen.findByText('昨日经营摘要')).toBeTruthy();
    expect(screen.getByText('8 月 31 日')).toBeTruthy();
    expect(screen.getByText('更新时间 8月31日 · 完整度 已同步')).toBeTruthy();
    expect(screen.getByText('整体平稳，2 家门店需关注')).toBeTruthy();
    expect(screen.getByText('¥101,512')).toBeTruthy();
    expect(screen.getByText('5,704')).toBeTruthy();
    expect(screen.getByText('¥17.80')).toBeTruthy();
    expect(screen.getByText('+7.9%')).toBeTruthy();
    expect(screen.getByText('茅坡店净实收偏低')).toBeTruthy();
    expect(screen.getByText('西京医院店同步延迟')).toBeTruthy();
    expect(screen.getByText('各门店昨日销售')).toBeTruthy();
    expect(screen.getByText('本周营收趋势')).toBeTruthy();
    expect(screen.getByText('门店人效排名')).toBeTruthy();
    expect(screen.getByText('查看产品表现')).toBeTruthy();
    expect(getOrders).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-31', dateTo: '2026-08-31' }),
      expect.objectContaining({ dimensions: [] }),
    );

    await fireEvent.press(screen.getByRole('button', { name: '查看昨日经营详情' }));
    expect(push).toHaveBeenCalledWith('/analytics/orders');
  });

  it('refreshes the default business overview when the app returns to foreground on the next day', async () => {
    let today = '2026-08-31';
    jest.mocked(beijingToday).mockImplementation(() => today);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);
    expect(await screen.findByText('8 月 30 日')).toBeTruthy();

    today = '2026-09-01';
    await act(async () => {
      mockAppStateListeners.forEach((listener) => listener('active'));
    });

    await waitFor(() => expect(getOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-31', dateTo: '2026-08-31' }),
      expect.objectContaining({ dimensions: [] }),
    ));
    expect(screen.getByText('8 月 31 日')).toBeTruthy();
    expect(screen.getByText('更新时间 8月31日 · 完整度 已同步')).toBeTruthy();
  });

  it('shows incomplete snapshot status in the default business overview', async () => {
    jest.mocked(getOrders).mockResolvedValue({
      rows: [
        {
          avg_order_value: 17.8,
          dim_key: 'ALL',
          dim_label: '总计',
          net_income: 101512,
          order_count: 5704,
          refund_rate: 0.02,
        },
      ],
      snapshot_status: 'missing',
    });
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(await screen.findByText('更新时间 8月31日 · 完整度 未完整')).toBeTruthy();
  });

  it('sends quick questions from the default business overview', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage,
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);
    await screen.findByText('常用问题');
    await fireEvent.press(screen.getByRole('button', { name: '各门店昨日销售' }));

    expect(sendMessage).toHaveBeenCalledWith('各门店昨日销售');
  });

  it('keeps manual chat input available when the default business overview cannot load', async () => {
    const sendMessage = jest.fn();
    jest.mocked(getOrders).mockRejectedValue(new Error('订单统计加载失败'));
    jest.mocked(getOperationsOverview).mockRejectedValue(new Error('对比加载失败'));
    jest.mocked(getRevenueAlerts).mockRejectedValue(new Error('报警加载失败'));
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage,
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(await screen.findByText('经营摘要暂不可用')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('输入消息'), '继续查一下昨日经营');
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(sendMessage).toHaveBeenCalledWith('继续查一下昨日经营');
  });

  it('renders the active conversation and connects the composer to the stream', async () => {
    const sendMessage = jest.fn();
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage,
      stopGeneration: jest.fn(),
    });
    useChatStore.setState({
      activeSessionId: 'tenant-99:session-4b2f',
      messagesBySessionId: {
        'tenant-99:session-4b2f': [
          { id: 'assistant-1', role: 'assistant', content: '已加载对话', created_at: '2026-07-16T10:00:00+08:00' },
        ],
      },
    });

    const screen = await render(<ChatHomeScreen />);
    expect(screen.getByText('已加载对话')).toBeTruthy();
    expect(screen.getByTestId('chat-keyboard-area')).toHaveStyle({ flex: 1 });

    await fireEvent.changeText(screen.getByPlaceholderText('输入消息'), '继续提问');
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));
    expect(sendMessage).toHaveBeenCalledWith('继续提问');
  });

  it('opens conversation history from the chat header and closes it after selecting a session', async () => {
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });
    jest.mocked(listSessions).mockResolvedValue([
      { created_at: '2026-07-16T10:00:00+08:00', session_id: 'server-1', title: '历史会话', updated_at: '2026-07-16T10:00:00+08:00' },
    ]);

    const screen = await render(<ChatHomeScreen />);

    expect(screen.getByRole('button', { name: '打开历史记录' })).toBeTruthy();
    expect(screen.queryByText('对话历史')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: '打开历史记录' }));
    expect(screen.getByText('对话历史')).toBeTruthy();
    expect(await screen.findByText('历史会话')).toBeTruthy();

    await fireEvent.press(screen.getByText('历史会话'));

    expect(useChatStore.getState().activeSessionId).toBe('server-1');
    expect(screen.queryByText('对话历史')).toBeNull();
  });

  it('sends a structured prompt through the active chat stream', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage,
      stopGeneration: jest.fn(),
    });
    useChatStore.setState({
      activeSessionId: 'tenant-99:session-prompts',
      messagesBySessionId: { 'tenant-99:session-prompts': [structuredMessage()] },
    });

    const screen = await render(<ChatHomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '对比上期' }));

    expect(sendMessage).toHaveBeenCalledWith('对比凤八店上一完整周人效');
    expect(useChatStore.getState().activeSessionId).toBe('tenant-99:session-prompts');
  });

  it('allows sending after a temporary cache fallback while the device is online', async () => {
    const sendMessage = jest.fn();
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false, isStreaming: false, pendingApproval: null,
      approvePending: jest.fn(), cancelPending: jest.fn(), retryInterruptedMessage: jest.fn(), sendMessage, stopGeneration: jest.fn(),
    });
    useChatStore.setState({ isOffline: true });
    const screen = await render(<ChatHomeScreen />);

    await fireEvent.changeText(screen.getByPlaceholderText('输入消息'), '恢复后提问');
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(sendMessage).toHaveBeenCalledWith('恢复后提问');
  });

  it('blocks sending and uploads immediately when the device is offline', async () => {
    const sendMessage = jest.fn();
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false, isStreaming: false, pendingApproval: null,
      approvePending: jest.fn(), cancelPending: jest.fn(), retryInterruptedMessage: jest.fn(), sendMessage, stopGeneration: jest.fn(),
    });
    jest.mocked(pickDocuments).mockResolvedValue([]);
    useNetworkStore.setState({ status: 'offline' });
    const screen = await render(<ChatHomeScreen />);

    await fireEvent.changeText(screen.getByPlaceholderText('输入消息'), '设备离线提问');
    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(pickDocuments).not.toHaveBeenCalled();
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it('blocks billable actions before connectivity is confirmed', async () => {
    const sendMessage = jest.fn();
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false, isStreaming: false, pendingApproval: null,
      approvePending: jest.fn(), cancelPending: jest.fn(), retryInterruptedMessage: jest.fn(), sendMessage, stopGeneration: jest.fn(),
    });
    useNetworkStore.setState({ status: 'unknown' });
    const screen = await render(<ChatHomeScreen />);

    await fireEvent.changeText(screen.getByPlaceholderText('输入消息'), '网络状态待确认');
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uploads selected files and adds a linked task message to the active conversation', async () => {
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });
    jest.mocked(pickDocuments).mockResolvedValue([
      { mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' },
    ]);
    jest.mocked(uploadFiles).mockResolvedValue({
      session_id: 'tenant-99:session-upload', status: 'pending', task_id: 'task-upload', task_type: 'file_parsing',
    });
    useChatStore.setState({
      activeSessionId: 'tenant-99:session-upload',
      messagesBySessionId: { 'tenant-99:session-upload': [] },
      sessions: [{ created_at: '2026-07-16T10:00:00+08:00', session_id: 'tenant-99:session-upload', title: '文件上传', updated_at: '2026-07-16T10:00:00+08:00' }],
    });

    const screen = await render(<ChatHomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(uploadFiles).toHaveBeenCalledWith({
      files: [{ mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' }],
      message: '',
      signal: expect.any(AbortSignal),
      sessionId: 'tenant-99:session-upload',
      taskType: 'file_parsing',
    });
    expect(useChatStore.getState().messagesBySessionId['tenant-99:session-upload']).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: '\n📎 美团_2026-07.xlsx', role: 'user' }),
      expect.objectContaining({ task_id: 'task-upload' }),
    ]));
  });

  it('does not render a screen-global agent stage', async () => {
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: true,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);

    expect(screen.queryByTestId('agent-stage')).toBeNull();
  });

  it('returns one level from the chat header', async () => {
    const back = jest.fn();
    jest.mocked(useRouter).mockReturnValue({
      back,
      canGoBack: jest.fn(() => true),
      push: jest.fn(),
      replace: jest.fn(),
    } as never);
    jest.mocked(useChatStream).mockReturnValue({
      isPendingBlocked: false,
      isStreaming: false,
      pendingApproval: null,
      approvePending: jest.fn(),
      cancelPending: jest.fn(),
      retryInterruptedMessage: jest.fn(),
      sendMessage: jest.fn(),
      stopGeneration: jest.fn(),
    });

    const screen = await render(<ChatHomeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '返回' }));

    expect(back).toHaveBeenCalledTimes(1);
  });
});
