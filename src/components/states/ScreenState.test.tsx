import { fireEvent, render } from '@testing-library/react-native';
import { ScreenState } from './ScreenState';

describe('ScreenState', () => {
  it.each([
    ['loading', '正在加载'],
    ['empty', '暂无内容'],
    ['error', '加载失败'],
    ['offline', '当前处于离线状态'],
  ] as const)('renders the %s state', async (state, title) => {
    const screen = await render(<ScreenState state={state} />);

    expect(screen.getByText(title)).toBeTruthy();
  });

  it('exposes an accessible 44dp action', async () => {
    const onAction = jest.fn();
    const screen = await render(
      <ScreenState state="error" actionLabel="重新加载" onAction={onAction} />,
    );
    const action = screen.getByRole('button', { name: '重新加载' });

    expect(action).toHaveStyle({ minHeight: 44 });
    await fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
