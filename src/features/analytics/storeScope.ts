export type StoreScopeNode = {
  key: string;
  type: 'department' | 'store' | 'group' | 'ungrouped';
  label: string;
  department_id?: string;
  store_key?: string;
  children?: StoreScopeNode[];
};

export type ExplicitStoreScope = {
  key: string;
  label: string;
  storeKeys: string[];
  departmentKeys?: string[];
  type: StoreScopeNode['type'];
};

export type StoreScopeSelection = {
  scopeKeys: string[];
  scopes: ExplicitStoreScope[];
  shopKeys: string[];
  departmentKeys: string[];
  compareStores: boolean;
  label: string;
};

export function uniqueScopeKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

export function normalizeScopeKeys(previous: string[], next: string[]): string[] {
  const values = uniqueScopeKeys(next);
  if (!values.length) return ['ALL'];
  if (values.includes('ALL') && !previous.includes('ALL')) return ['ALL'];
  const scopes = values.filter((key) => key !== 'ALL');
  return scopes.length ? scopes : ['ALL'];
}

export function resolveStoreScopeSelection(scopeKeys: string[], nodes: StoreScopeNode[]): StoreScopeSelection {
  if (!scopeKeys.length || scopeKeys.includes('ALL')) {
    return {
      scopeKeys: ['ALL'],
      scopes: [],
      shopKeys: [],
      departmentKeys: [],
      compareStores: false,
      label: '全部门店',
    };
  }

  const normalizedKeys = uniqueScopeKeys(scopeKeys);
  const index = indexScopeNodes(nodes);
  const selectedScopes = normalizedKeys.flatMap((key) => {
    const node = index.get(key);
    const stores = uniqueStores(descendantStores(node));
    return node && stores.length ? [{ node, stores }] : [];
  });
  const scopes = selectedScopes.map(({ node, stores }) => ({
    key: node.key,
    label: node.label,
    type: node.type,
    storeKeys: stores.flatMap((store) => store.store_key ? [String(store.store_key)] : []),
    departmentKeys: uniqueScopeKeys(stores.flatMap((store) => store.department_id ? [String(store.department_id)] : [])),
  }));
  const leaves = uniqueStores(selectedScopes.flatMap((scope) => scope.stores));
  const selectedNode = normalizedKeys.length === 1 ? index.get(normalizedKeys[0]) : undefined;
  const multipleScopeLabel = scopes.length <= 2
    ? scopes.map((scope) => scope.label).join(' · ')
    : `${scopes.length} 个已选范围`;

  return {
    scopeKeys: normalizedKeys,
    scopes,
    shopKeys: leaves.flatMap((node) => node.store_key ? [String(node.store_key)] : []),
    departmentKeys: uniqueScopeKeys(leaves.flatMap((node) => node.department_id ? [String(node.department_id)] : [])),
    compareStores: leaves.length > 1 && selectedScopes.every((scope) => scope.stores.length === 1),
    label: normalizedKeys.length > 1
      ? multipleScopeLabel
      : selectedNode?.type === 'department'
      ? selectedNode.label
      : leaves.length === 1
        ? leaves[0].label
        : `${leaves.length} 家门店`,
  };
}

function indexScopeNodes(nodes: StoreScopeNode[]): Map<string, StoreScopeNode> {
  const index = new Map<string, StoreScopeNode>();
  const visit = (node: StoreScopeNode) => {
    index.set(node.key, node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return index;
}

function descendantStores(node?: StoreScopeNode): StoreScopeNode[] {
  if (!node) return [];
  if (node.type === 'store') return [node];
  return (node.children ?? []).flatMap(descendantStores);
}

function uniqueStores(nodes: StoreScopeNode[]): StoreScopeNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = String(node.store_key ?? node.key);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
