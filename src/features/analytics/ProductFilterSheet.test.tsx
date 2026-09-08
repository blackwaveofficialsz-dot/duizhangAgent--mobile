import { fireEvent, render } from '@testing-library/react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { createAnalyticsFilters } from './analyticsFilters';
import { ProductFilterSheet } from './ProductFilterSheet';
import type { StoreScopeNode } from './storeScope';

const scopeTree: StoreScopeNode[] = [{
  key: 'dept:north',
  label: '北区',
  type: 'department',
  children: [
    { key: 'shop:101', label: '茅坡店', store_key: '101', type: 'store' },
    { key: 'shop:102', label: '凤十二店', store_key: '102', type: 'store' },
  ],
}];

describe('ProductFilterSheet', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses the range tree only for the shop dimension', async () => {
    const screen = await render(<ProductFilterSheet
      filters={createAnalyticsFilters('2026-07-22')}
      onApply={jest.fn()}
      onClose={jest.fn()}
      platforms={[{ confirmed: true, platform_code: 2, platform_name: '美团' }]}
      scope={{ dimKey: 'ALL', dimType: 'all' }}
      scopeTree={scopeTree}
      stores={[{ key: '101', label: '茅坡店' }]}
      today="2026-07-22"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '选择分析维度 分店铺' }));
    expect(screen.getByRole('button', { name: '选择范围 北区' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '选择分析维度 分平台' }));
    expect(screen.queryByRole('button', { name: '选择范围 北区' })).toBeNull();
    expect(screen.getByRole('button', { name: '选择平台 美团' })).toBeTruthy();
  });

  it('does not expose the duplicate source type dimension', async () => {
    const screen = await render(<ProductFilterSheet
      filters={createAnalyticsFilters('2026-07-22')}
      onApply={jest.fn()}
      onClose={jest.fn()}
      platforms={[]}
      scope={{ dimKey: 'ALL', dimType: 'all' }}
      scopeTree={scopeTree}
      stores={[]}
      today="2026-07-22"
      visible
    />);

    expect(screen.getByRole('button', { name: '选择分析维度 堂食/外卖' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '选择分析维度 食亨来源' })).toBeNull();
  });
});
