import { fireEvent, render } from '@testing-library/react-native';
import { AnalyticsModuleTabs } from './AnalyticsModuleTabs';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

describe('AnalyticsModuleTabs', () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it('renders the five modules in the confirmed order and marks the current module', async () => {
    const screen = await render(<AnalyticsModuleTabs activeModule="dashboard" />);

    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      '订单统计',
      '看板',
      '产品',
      '人效',
      '营收报警',
    ]);
    expect(screen.getByRole('tab', { name: '看板' }).props.accessibilityState)
      .toMatchObject({ selected: true });
    expect(screen.getByRole('tab', { name: '产品' }).props.accessibilityState)
      .toMatchObject({ selected: false });
  });

  it('replaces the route when another module is selected', async () => {
    const screen = await render(<AnalyticsModuleTabs activeModule="dashboard" />);

    fireEvent.press(screen.getByRole('tab', { name: '产品' }));

    expect(mockReplace).toHaveBeenCalledWith('/analytics/products');
  });

  it('routes the dashboard tab to the dedicated dashboard page', async () => {
    const screen = await render(<AnalyticsModuleTabs activeModule="orders" />);

    fireEvent.press(screen.getByRole('tab', { name: '看板' }));

    expect(mockReplace).toHaveBeenCalledWith('/analytics/dashboard');
  });

  it('does not navigate when the current module is selected again', async () => {
    const screen = await render(<AnalyticsModuleTabs activeModule="dashboard" />);

    fireEvent.press(screen.getByRole('tab', { name: '看板' }));

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
