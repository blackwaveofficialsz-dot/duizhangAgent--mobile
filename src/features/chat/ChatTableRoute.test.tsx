import { render } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChatTableRoute from '@/app/(app)/tables/[messageId]';
import { structuredMessage } from '@/test/agentResponseFixture';
import { useChatStore } from './chatStore';

jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(), useRouter: jest.fn() }));
jest.mock('./chatStore', () => ({ useChatStore: jest.fn() }));

describe('ChatTableRoute', () => {
  it('selects the source message from the store before deriving the table', async () => {
    const back = jest.fn();
    const message = {
      id: 'table-message',
      role: 'assistant',
      content: '| 日期 | 金额 |\n| --- | ---: |\n| 2026-07-16 | 120 |',
      created_at: '2026-07-16T10:00:00+08:00',
    };
    let selectedValue: unknown;
    jest.mocked(useLocalSearchParams).mockReturnValue({ messageId: 'table-message' } as never);
    jest.mocked(useRouter).mockReturnValue({ back } as never);
    jest.mocked(useChatStore).mockImplementation(((selector: (state: unknown) => unknown) => {
      selectedValue = selector({ activeSessionId: 'session-1', messagesBySessionId: { 'session-1': [message] } });
      return selectedValue;
    }) as never);

    const screen = await render(<ChatTableRoute />);

    expect(selectedValue).toBe(message);
    expect(screen.getByText('2 列 · 1 行')).toBeTruthy();
  });

  it('opens the requested table when one message contains multiple tables', async () => {
    const message = {
      id: 'report-message',
      role: 'assistant',
      content: [
        '| 门店 | 金额 |',
        '| --- | ---: |',
        '| 茅坡店 | 120 |',
        '',
        '| 产品 | 销量 | 备注 |',
        '| --- | ---: | --- |',
        '| 肉夹馍 | 10 | 第二张表 |',
      ].join('\n'),
      created_at: '2026-07-16T10:00:00+08:00',
    };
    jest.mocked(useLocalSearchParams).mockReturnValue({ messageId: 'report-message', tableIndex: '1' } as never);
    jest.mocked(useRouter).mockReturnValue({ back: jest.fn() } as never);
    jest.mocked(useChatStore).mockImplementation(((selector: (state: unknown) => unknown) => (
      selector({ activeSessionId: 'session-1', messagesBySessionId: { 'session-1': [message] } })
    )) as never);

    const screen = await render(<ChatTableRoute />);

    expect(screen.getByText('3 列 · 1 行')).toBeTruthy();
    expect(screen.getByText('第二张表')).toBeTruthy();
    expect(screen.queryByText('茅坡店')).toBeNull();
  });

  it('opens structured table ordinal zero when summary and insights precede it', async () => {
    const message = structuredMessage();
    jest.mocked(useLocalSearchParams).mockReturnValue({ messageId: message.id, tableIndex: '0' } as never);
    jest.mocked(useRouter).mockReturnValue({ back: jest.fn() } as never);
    jest.mocked(useChatStore).mockImplementation(((selector: (state: unknown) => unknown) => (
      selector({ activeSessionId: 'session-1', messagesBySessionId: { 'session-1': [message] } })
    )) as never);

    const screen = await render(<ChatTableRoute />);

    expect(screen.getByText('2 列 · 8 行')).toBeTruthy();
    expect(screen.getByText('门店8')).toBeTruthy();
  });
});
