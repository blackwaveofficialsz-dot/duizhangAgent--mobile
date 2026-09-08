import { fireEvent, render } from '@testing-library/react-native';
import { ChatTableDetailScreen } from './ChatTableDetailScreen';

describe('ChatTableDetailScreen', () => {
  it('renders a long table in a dedicated scrollable page', async () => {
    const onClose = jest.fn();
    const screen = await render(
      <ChatTableDetailScreen
        onClose={onClose}
        table={{
          columns: ['名称', '数值'],
          rows: Array.from({ length: 21 }, (_, index) => [`第${index + 1}行`, String(index + 1)]),
          text: '查询结果',
        }}
      />,
    );

    expect(screen.getByText('表格结果')).toBeTruthy();
    expect(screen.getByTestId('table-detail-horizontal')).toBeTruthy();
    expect(screen.getByTestId('table-detail-list').props.horizontal).not.toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '返回对话' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a 132-row table virtualized', async () => {
    const rows = Array.from({ length: 132 }, (_, index) => [`第${index + 1}行`, String(index + 1)]);
    const screen = await render(
      <ChatTableDetailScreen
        onClose={jest.fn()}
        table={{ columns: ['名称', '数值'], rows, text: '' }}
      />,
    );

    const list = screen.getByTestId('table-detail-list');
    expect(list.props.data).toHaveLength(132);
    expect(list.props.initialNumToRender).toBe(20);
  });

  it('fits four concise columns in the initial phone viewport', async () => {
    const screen = await render(
      <ChatTableDetailScreen
        onClose={jest.fn()}
        table={{
          columns: ['日期', '门店', '订单原价', '应结金额'],
          rows: [['2026-07-16', '凤城十二路店', '37,756.45', '17,911.60']],
          text: '查询结果',
        }}
      />,
    );

    expect(screen.getByTestId('table-detail-horizontal').props.showsHorizontalScrollIndicator).toBe(true);
    expect(screen.getByText('应结金额')).toHaveStyle({ width: 96 });
  });

  it('shows the complete value of a dense cell on the detail page', async () => {
    const longDescription = '这是一段需要在完整表格页面中全部显示的商品说明。'.repeat(12);
    const screen = await render(
      <ChatTableDetailScreen
        onClose={jest.fn()}
        table={{ columns: ['商品', '说明'], rows: [['套餐 A', longDescription]], text: '' }}
      />,
    );

    expect(screen.getByText(longDescription).props.numberOfLines).toBeUndefined();
  });
});
