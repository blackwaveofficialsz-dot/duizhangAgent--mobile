import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DuplicateFileDialog } from './DuplicateFileDialog';

describe('DuplicateFileDialog', () => {
  it('requires one explicit confirmation before replacing a duplicate upload', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const screen = await render(
      <DuplicateFileDialog
        duplicate={{ existing_sources: [{ bill_platform: '美团外卖' }], period: '2026-07' }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('检测到重复文件')).toBeTruthy();
    expect(screen.getByText('账期 2026-07')).toBeTruthy();
    expect(screen.getByText('美团外卖')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    const confirm = screen.getByRole('button', { name: '替换并重新上传' });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('allows a new duplicate response to be confirmed after the previous dialog closes', async () => {
    const onConfirm = jest.fn();
    const screen = await render(
      <DuplicateFileDialog duplicate={{ period: '2026-07' }} onCancel={jest.fn()} onConfirm={onConfirm} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '替换并重新上传' }));
    await screen.rerender(<DuplicateFileDialog duplicate={null} onCancel={jest.fn()} onConfirm={onConfirm} />);
    await screen.rerender(<DuplicateFileDialog duplicate={{ period: '2026-08' }} onCancel={jest.fn()} onConfirm={onConfirm} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '替换并重新上传' }).props.accessibilityState).toEqual({ disabled: false });
    });
    await fireEvent.press(screen.getByRole('button', { name: '替换并重新上传' }));

    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
