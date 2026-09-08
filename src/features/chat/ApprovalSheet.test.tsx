jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ fontScale: 1, height: 1000, scale: 1, width: 375 }),
}));

import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ApprovalSheet } from './ApprovalSheet';

describe('ApprovalSheet', () => {
  it('keeps approval disabled while the source stream is active and confirms only once', async () => {
    const onApprove = jest.fn();
    const screen = await render(
      <ApprovalSheet
        approval={{ action: '导出报表', description: '将导出本月对账结果', turnId: 'turn-1', sourceSessionId: 'session-1' }}
        isStreaming
        onApprove={onApprove}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('导出报表')).toBeTruthy();
    expect(screen.getByText('将导出本月对账结果')).toBeTruthy();
    expect(screen.getByTestId('approval-sheet-handle')).toBeTruthy();
    expect(screen.getByTestId('approval-impact')).toBeTruthy();
    expect(screen.getByTestId('approval-content-scroll')).toBeTruthy();
    const sheet = screen.getByTestId('approval-sheet');
    expect(sheet).toHaveStyle({
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    });
    expect(StyleSheet.flatten(sheet.props.style).maxHeight).toBe(820);
    expect(screen.getByRole('button', { name: '同意执行' }).props.accessibilityState).toEqual({ disabled: true });

    await fireEvent.press(screen.getByRole('button', { name: '同意执行' }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByTestId('approval-sheet-safe-area')).toBeTruthy();
  });

  it('cancels without approving', async () => {
    const onApprove = jest.fn();
    const onCancel = jest.fn();
    const screen = await render(
      <ApprovalSheet
        approval={{ action: '同步数据', description: '将同步外部数据', turnId: 'turn-2', sourceSessionId: 'session-2' }}
        isStreaming={false}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('keeps approval disabled for offline cached data', async () => {
    const onApprove = jest.fn();
    const screen = await render(
      <ApprovalSheet
        approval={{ action: '同步数据', description: '将同步外部数据', turnId: 'turn-offline', sourceSessionId: 'session-2' }}
        isDisabled
        isStreaming={false}
        onApprove={onApprove}
        onCancel={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '同意执行' }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('submits an enabled approval only once', async () => {
    const onApprove = jest.fn();
    const screen = await render(
      <ApprovalSheet
        approval={{ action: '同步数据', description: '将同步外部数据', turnId: 'turn-3', sourceSessionId: 'session-3' }}
        isStreaming={false}
        onApprove={onApprove}
        onCancel={jest.fn()}
      />,
    );

    const approve = screen.getByRole('button', { name: '同意执行' });
    await fireEvent.press(approve);
    await fireEvent.press(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
