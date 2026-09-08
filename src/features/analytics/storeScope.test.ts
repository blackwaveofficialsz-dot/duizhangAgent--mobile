import { normalizeScopeKeys, resolveStoreScopeSelection, uniqueScopeKeys, type StoreScopeNode } from './storeScope';

const nodes: StoreScopeNode[] = [
  {
    key: 'dept:north',
    type: 'department',
    label: '北区',
    department_id: 'north',
    children: [
      { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101', department_id: 'north' },
      { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102', department_id: 'north' },
    ],
  },
  {
    key: 'ungrouped',
    type: 'ungrouped',
    label: '未分组',
    children: [{ key: 'shop:201', type: 'store', label: '南坪店', store_key: '201' }],
  },
];

describe('storeScope', () => {
  it('keeps department and child store selections independent while resolving leaf stores', () => {
    const selection = resolveStoreScopeSelection(['dept:north', 'shop:201'], nodes);

    expect(selection.scopeKeys).toEqual(['dept:north', 'shop:201']);
    expect(selection.scopes).toEqual([
      { key: 'dept:north', label: '北区', storeKeys: ['101', '102'], departmentKeys: ['north'], type: 'department' },
      { key: 'shop:201', label: '南坪店', storeKeys: ['201'], departmentKeys: [], type: 'store' },
    ]);
    expect(selection.shopKeys).toEqual(['101', '102', '201']);
    expect(selection.label).toBe('北区 · 南坪店');
    expect(selection.compareStores).toBe(false);
  });

  it('compares stores only when every explicit scope is one store', () => {
    const selection = resolveStoreScopeSelection(['shop:101', 'shop:102'], nodes);

    expect(selection.compareStores).toBe(true);
    expect(selection.label).toBe('茅坡店 · 凤十二店');
  });

  it('treats all stores as mutually exclusive', () => {
    expect(normalizeScopeKeys(['ALL'], ['ALL', 'dept:north'])).toEqual(['dept:north']);
    expect(normalizeScopeKeys(['dept:north'], ['dept:north', 'ALL'])).toEqual(['ALL']);
    expect(normalizeScopeKeys(['shop:101'], [])).toEqual(['ALL']);
  });

  it('deduplicates explicit store and department keys before range aggregation', () => {
    expect(uniqueScopeKeys(['101', '101', '', 'north', 'north'])).toEqual(['101', 'north']);

    const selection = resolveStoreScopeSelection(['dept:north'], [{
      ...nodes[0],
      children: [...nodes[0].children!, nodes[0].children![0]],
    }]);

    expect(selection.scopes[0]).toMatchObject({ storeKeys: ['101', '102'], departmentKeys: ['north'] });
  });
});
