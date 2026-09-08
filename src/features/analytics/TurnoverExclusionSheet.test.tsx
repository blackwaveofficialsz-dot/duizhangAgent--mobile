import { fireEvent, render } from '@testing-library/react-native';
import { TurnoverExclusionSheet } from './TurnoverExclusionSheet';

describe('TurnoverExclusionSheet', () => {
  it('lists excluded stores in a safe-area sheet and closes on request', async () => {
    const onClose = jest.fn();
    const screen = await render(
      <TurnoverExclusionSheet
        excludedStores={[{ reason: '未配置桌台数', store_key: '102', store_label: '凤十二店' }]}
        onClose={onClose}
        visible
      />,
    );

    expect(screen.getByTestId('turnover-exclusion-sheet-safe-area')).toBeTruthy();
    expect(screen.getByText('已排除门店')).toBeTruthy();
    expect(screen.getByText('凤十二店')).toBeTruthy();
    expect(screen.getByText('未配置桌台数')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '关闭已排除门店' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
