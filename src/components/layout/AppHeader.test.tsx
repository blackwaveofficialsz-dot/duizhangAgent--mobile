import { fireEvent, render } from '@testing-library/react-native';
import { AppHeader } from './AppHeader';

describe('AppHeader', () => {
  it('renders configured leading and trailing actions', async () => {
    const onBack = jest.fn();
    const onRefresh = jest.fn();
    const screen = await render(
      <AppHeader
        leadingAction={{ type: 'back', onPress: onBack }}
        trailingAction={{ type: 'refresh', onPress: onRefresh }}
        title="任务详情"
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '返回' }));
    await fireEvent.press(screen.getByRole('button', { name: '刷新' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled trailing action visible', async () => {
    const screen = await render(
      <AppHeader
        leadingAction={{ type: 'back', onPress: jest.fn() }}
        trailingAction={{ type: 'refresh', onPress: jest.fn(), disabled: true }}
        title="任务详情"
      />,
    );

    expect(screen.getByRole('button', { name: '刷新' }).props.accessibilityState)
      .toMatchObject({ disabled: true });
  });

  it('supports a history toolbar action', async () => {
    const onHistory = jest.fn();
    const screen = await render(
      <AppHeader
        leadingAction={{ type: 'back', onPress: jest.fn() }}
        trailingAction={{ type: 'history', onPress: onHistory }}
        title="对话"
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '打开历史记录' }));

    expect(onHistory).toHaveBeenCalledTimes(1);
  });
});
