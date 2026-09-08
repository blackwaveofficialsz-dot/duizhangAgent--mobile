import { act, fireEvent, render } from '@testing-library/react-native';
import { AppToast, showToast } from './AppToast';

describe('AppToast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows a toast for five seconds by default and allows manual close', async () => {
    const screen = await render(<AppToast />);

    await act(() => showToast('保存成功', 'success'));
    const alert = screen.getByRole('alert', { name: '保存成功' });
    const closeButton = screen.getByRole('button', { name: '关闭提示' });
    expect(alert).not.toContainElement(closeButton);

    await act(() => jest.advanceTimersByTime(4999));
    expect(screen.getByText('保存成功')).toBeTruthy();

    await act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText('保存成功')).toBeNull();

    await act(() => showToast('再次保存成功', 'success'));
    expect(screen.getByRole('button', { name: '关闭提示' })).toHaveStyle({ width: 44, height: 44 });

    await fireEvent.press(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText('再次保存成功')).toBeNull();
  });

  it('supports error and info feedback', async () => {
    const screen = await render(<AppToast />);

    await act(() => showToast('提交失败', 'error'));
    expect(screen.getByText('提交失败')).toBeTruthy();

    await act(() => showToast('已进入离线模式', 'info'));
    expect(screen.getByText('已进入离线模式')).toBeTruthy();
  });
});
