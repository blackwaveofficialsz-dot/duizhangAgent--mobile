import { resolveLaborScope } from './laborScope';
import type { StoreScopeNode } from './storeScope';

const tree: StoreScopeNode[] = [{
  key: 'dept:ops',
  type: 'department',
  label: '运营部',
  children: [
    { key: 'shop:801', type: 'store', label: '北大街', store_key: '801', department_id: '111' },
    { key: 'shop:802', type: 'store', label: '南大街', store_key: '802', department_id: '111' },
    { key: 'shop:803', type: 'store', label: '科技路', store_key: '803', department_id: '112' },
  ],
}];

describe('resolveLaborScope', () => {
  it('uses the selected department ids once for an explicit parent scope', () => {
    expect(resolveLaborScope(['dept:ops'], tree)).toMatchObject({
      departmentKeys: ['111', '112'],
      requestStoreKeys: ['111', '112'],
      shopKeys: ['801', '802', '803'],
      canOpenStoreDetail: false,
      label: '运营部',
    });
  });

  it('warns when selected stores share one DingTalk department instead of splitting it', () => {
    expect(resolveLaborScope(['shop:801', 'shop:802'], tree)).toMatchObject({
      comparisonScopes: [],
      departmentKeys: ['111'],
      requestStoreKeys: ['111'],
      hasSharedDepartment: true,
      canOpenStoreDetail: false,
      notice: '门店共用人效部门，暂无法拆分',
    });
  });

  it('keeps distinguishable explicit ranges for trend comparison', () => {
    expect(resolveLaborScope(['shop:801', 'shop:803'], tree).comparisonScopes).toEqual([
      expect.objectContaining({ departmentKeys: ['111'], key: 'shop:801', label: '北大街' }),
      expect.objectContaining({ departmentKeys: ['112'], key: 'shop:803', label: '科技路' }),
    ]);
  });

  it('permits detail only for a uniquely mapped store leaf', () => {
    expect(resolveLaborScope(['shop:803'], tree)).toMatchObject({
      departmentKeys: ['112'],
      canOpenStoreDetail: true,
      detailDepartmentKey: '112',
    });
  });

  it('rejects an explicit scope without a DingTalk department mapping', () => {
    const result = resolveLaborScope(['shop:unmapped'], [{
      key: 'shop:unmapped', type: 'store', label: '未映射门店', store_key: '999',
    }]);

    expect(result).toMatchObject({
      hasUnresolvedMapping: true,
      requestStoreKeys: [],
      notice: '所选经营范围未映射钉钉部门，无法纳入人效统计。',
    });
  });
});
