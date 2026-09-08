import { fireEvent, render } from '@testing-library/react-native';
import { StoreScopePicker } from './StoreScopePicker';
import type { StoreScopeNode } from './storeScope';

const nodes: StoreScopeNode[] = [{
  key: 'group:operations',
  label: '运营部',
  type: 'group',
  children: [{
    key: 'dept:business-1',
    label: '事业1部',
    type: 'department',
    children: [{
      key: 'dept:tangcheng',
      label: '唐城店',
      type: 'department',
      children: [{
        key: 'shop:53945',
        label: '袁记肉夹馍（唐城医院直营店）',
        store_key: '53945',
        type: 'store',
      }],
    }],
  }],
}];

describe('StoreScopePicker', () => {
  it('hides the store child when a department maps to exactly one store', async () => {
    const onChange = jest.fn();
    const screen = await render(<StoreScopePicker nodes={nodes} onChange={onChange} selectedKeys={['ALL']} />);

    expect(screen.getByText('唐城店')).toBeTruthy();
    expect(screen.queryByText('袁记肉夹馍（唐城医院直营店）')).toBeNull();
    expect(screen.queryByLabelText('收起 唐城店')).toBeNull();

    await fireEvent.press(screen.getByLabelText('选择范围 唐城店'));
    expect(onChange).toHaveBeenCalledWith(['dept:tangcheng']);
  });
});
