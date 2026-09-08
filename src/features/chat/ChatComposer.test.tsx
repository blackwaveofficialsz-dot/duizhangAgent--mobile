import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { cleanupPickedDocuments, pickDocuments } from '@/services/files/pickDocuments';
import { ChatComposer } from './ChatComposer';

jest.mock('@/services/files/pickDocuments', () => ({
  cleanupPickedDocuments: jest.fn(),
  pickDocuments: jest.fn(),
}));

describe('ChatComposer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps send disabled for blank text and submits trimmed content', async () => {
    const onSend = jest.fn();
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={onSend} onStop={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText('输入消息');

    expect(screen.getByRole('button', { name: '发送消息' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(input, '  查询今日营收  ');
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(onSend).toHaveBeenCalledWith('查询今日营收');
    expect(input.props.value).toBe('');
  });

  it('uses a quiet disabled send button before there is anything to send', async () => {
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );
    const send = screen.getByRole('button', { name: '发送消息' });

    expect(StyleSheet.flatten(send.props.style)).toMatchObject({
      backgroundColor: '#EDF1F2',
      opacity: 1,
    });
  });

  it('starts as one multiline row and caps the input at five rows', async () => {
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText('输入消息');

    expect(input.props.multiline).toBe(true);
    expect(input.props.numberOfLines).toBe(1);
    expect(input).toHaveStyle({ minHeight: 44, maxHeight: 116 });
  });

  it('grows with multiline content and stays within the existing height bounds', async () => {
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText('输入消息');

    expect(input.props.scrollEnabled).toBe(false);
    await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { height: 84, width: 200 } } });
    expect(input).toHaveStyle({ height: 84 });

    await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { height: 200, width: 200 } } });
    expect(input).toHaveStyle({ height: 116 });
    expect(input.props.scrollEnabled).toBe(true);

    await fireEvent(input, 'contentSizeChange', { nativeEvent: { contentSize: { height: 12, width: 200 } } });
    expect(input).toHaveStyle({ height: 44 });
    expect(input.props.scrollEnabled).toBe(false);
  });

  it('uses explicit line breaks when iOS does not emit a new content size', async () => {
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText('输入消息');

    await fireEvent.changeText(input, '第一行\n第二行\n第三行');

    expect(input).toHaveStyle({ height: 84 });
  });

  it('adds the supplied bottom inset to the footer design padding', async () => {
    const screen = await render(
      <ChatComposer bottomInset={34} isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );

    expect(screen.getByTestId('chat-composer').parent).toHaveStyle({ paddingBottom: 44 });
  });

  it('does not allow a negative bottom inset to reduce the footer padding', async () => {
    const screen = await render(
      <ChatComposer bottomInset={-34} isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />,
    );

    expect(screen.getByTestId('chat-composer').parent).toHaveStyle({ paddingBottom: 10 });
  });

  it('queues a selected document and sends it from the same composer', async () => {
    const onSend = jest.fn().mockResolvedValue({ task_id: 'task-1' });
    jest.mocked(pickDocuments).mockResolvedValue([
      { mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' },
    ]);
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={onSend} onStop={jest.fn()} />,
    );

    const attachment = screen.getByRole('button', { name: '添加附件' });
    expect(attachment.props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(attachment);
    expect(screen.getByText('美团_2026-07.xlsx')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送消息' }).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));

    expect(onSend).toHaveBeenCalledWith('', [
      { mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' },
    ], false, expect.any(AbortSignal));
    expect(screen.getByTestId('chat-composer')).toContainElement(attachment);
  });

  it('prevents a second upload until the first request finishes', async () => {
    let finishUpload: (value: { task_id: string }) => void;
    const onSend = jest.fn(() => new Promise<{ task_id: string }>((resolve) => {
      finishUpload = resolve;
    }));
    jest.mocked(pickDocuments).mockResolvedValue([
      { mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' },
    ]);
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={onSend} onStop={jest.fn()} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    const send = screen.getByRole('button', { name: '发送消息' });
    await fireEvent.press(send);
    await fireEvent.press(send);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '添加附件' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '发送消息' }).props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      finishUpload!({ task_id: 'task-1' });
    });
  });

  it('reuploads a duplicate only after the user confirms replacement', async () => {
    const onSend = jest.fn()
      .mockResolvedValueOnce({ duplicate: true, existing_sources: [{ bill_platform: '美团外卖' }], period: '2026-07' })
      .mockResolvedValueOnce({ task_id: 'task-replaced' });
    jest.mocked(pickDocuments).mockResolvedValue([
      { mimeType: 'application/vnd.ms-excel', name: '美团_2026-07.xlsx', size: 512, uri: 'file:///cache/meal.xlsx' },
    ]);
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={onSend} onStop={jest.fn()} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByText('检测到重复文件')).toBeTruthy();
    expect(onSend).toHaveBeenLastCalledWith('', expect.any(Array), false, expect.any(AbortSignal));

    await fireEvent.press(screen.getByRole('button', { name: '替换并重新上传' }));
    expect(onSend).toHaveBeenLastCalledWith('', expect.any(Array), true, expect.any(AbortSignal));
  });

  it('cleans a duplicate copied file instead of adding it to the queue', async () => {
    const first = { mimeType: 'text/csv', name: '流水.csv', size: 12, uri: 'file:///cache/first.csv' };
    const duplicateCopy = { ...first, uri: 'file:///cache/second.csv' };
    jest.mocked(pickDocuments).mockResolvedValueOnce([first]).mockResolvedValueOnce([duplicateCopy]);
    const screen = await render(<ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));

    expect(screen.getAllByText('流水.csv')).toHaveLength(1);
    expect(cleanupPickedDocuments).toHaveBeenCalledWith([duplicateCopy]);
  });

  it('cleans queued copies when duplicate replacement is cancelled', async () => {
    const document = { mimeType: 'text/csv', name: '流水.csv', size: 12, uri: 'file:///cache/report.csv' };
    jest.mocked(pickDocuments).mockResolvedValue([document]);
    const screen = await render(
      <ChatComposer isStreaming={false} onSend={jest.fn().mockResolvedValue({ duplicate: true })} onStop={jest.fn()} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));
    await fireEvent.press(screen.getByRole('button', { name: '取消' }));

    expect(cleanupPickedDocuments).toHaveBeenCalledWith([document]);
    expect(screen.queryByText('流水.csv')).toBeNull();
  });

  it('cleans a picker result that resolves after unmount', async () => {
    const document = { mimeType: 'text/csv', name: '流水.csv', size: 12, uri: 'file:///cache/late.csv' };
    let resolvePick!: (documents: typeof document[]) => void;
    jest.mocked(pickDocuments).mockReturnValue(new Promise((resolve) => { resolvePick = resolve; }));
    const screen = await render(<ChatComposer isStreaming={false} onSend={jest.fn()} onStop={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    screen.unmount();
    resolvePick([document]);
    await Promise.resolve();
    await Promise.resolve();

    expect(cleanupPickedDocuments).toHaveBeenCalledWith([document]);
  });

  it('aborts an in-flight upload before cleaning its source file on unmount', async () => {
    const events: string[] = [];
    const document = { mimeType: 'text/csv', name: '流水.csv', size: 12, uri: 'file:///cache/uploading.csv' };
    let uploadSignal: AbortSignal | undefined;
    jest.mocked(cleanupPickedDocuments).mockImplementation(() => { events.push('cleanup'); });
    jest.mocked(pickDocuments).mockResolvedValue([document]);
    const onSend = jest.fn((_text, _files, _replace, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      uploadSignal = signal;
      signal?.addEventListener('abort', () => {
        events.push('abort');
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }));
    const screen = await render(<ChatComposer isStreaming={false} onSend={onSend} onStop={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: '添加附件' }));
    await fireEvent.press(screen.getByRole('button', { name: '发送消息' }));
    screen.unmount();
    await waitFor(() => expect(events).toEqual(['abort', 'cleanup']));

    expect(uploadSignal?.aborted).toBe(true);
  });

  it('switches the send command to stop while streaming', async () => {
    const onStop = jest.fn();
    const screen = await render(
      <ChatComposer isStreaming onSend={jest.fn()} onStop={onStop} />,
    );

    expect(screen.queryByRole('button', { name: '发送消息' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '停止生成' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps typed text when an unresolved pending turn blocks send', async () => {
    const onSend = jest.fn();
    const screen = await render(
      <ChatComposer isBlocked isStreaming={false} onSend={onSend} onStop={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText('输入消息');

    await fireEvent.changeText(input, '第二个问题');
    const send = screen.getByRole('button', { name: '发送消息' });
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(send);

    expect(onSend).not.toHaveBeenCalled();
    expect(input.props.value).toBe('第二个问题');
  });
});
