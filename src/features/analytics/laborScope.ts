import { resolveStoreScopeSelection, type ExplicitStoreScope, type StoreScopeNode } from './storeScope';

export type LaborScope = {
  cacheKey: string;
  canOpenStoreDetail: boolean;
  comparisonScopes: ExplicitStoreScope[];
  departmentKeys: string[];
  detailDepartmentKey?: string;
  hasSharedDepartment: boolean;
  hasUnresolvedMapping: boolean;
  label: string;
  notice?: string;
  requestStoreKeys: string[];
  shopKeys: string[];
};

export function resolveLaborScope(scopeKeys: string[], nodes: StoreScopeNode[]): LaborScope {
  const selection = resolveStoreScopeSelection(scopeKeys, nodes);
  const isAll = selection.scopeKeys.includes('ALL');
  const mapping = departmentIdsByShop(nodes);
  const departmentKeys = unique(selection.shopKeys.flatMap((shopKey) => mapping.departmentsByShop.get(shopKey) ?? []));
  const hasUnresolvedMapping = !isAll && (selection.shopKeys.length === 0 || selection.shopKeys.some((shopKey) => !mapping.departmentsByShop.has(shopKey)));
  const hasSharedDepartment = departmentKeys.some((departmentKey) => (mapping.shopsByDepartment.get(departmentKey) ?? []).length > 1);
  const selectedScope = selection.scopes.length === 1 ? selection.scopes[0] : undefined;
  const comparisonScopes = distinctComparisonScopes(selection.scopes);
  const detailDepartmentKey = selectedScope?.type === 'store' && selection.shopKeys.length === 1 && departmentKeys.length === 1 && (mapping.shopsByDepartment.get(departmentKeys[0]) ?? []).length === 1
    ? departmentKeys[0]
    : undefined;
  const notice = hasUnresolvedMapping
    ? '所选经营范围未映射钉钉部门，无法纳入人效统计。'
    : hasSharedDepartment
      ? '门店共用人效部门，暂无法拆分'
      : undefined;

  return {
    cacheKey: `${selection.scopeKeys.slice().sort().join(',')}:${selection.shopKeys.slice().sort().join(',')}:${departmentKeys.slice().sort().join(',')}`,
    canOpenStoreDetail: Boolean(detailDepartmentKey),
    comparisonScopes,
    departmentKeys,
    detailDepartmentKey,
    hasSharedDepartment,
    hasUnresolvedMapping,
    label: selection.label,
    notice,
    requestStoreKeys: isAll ? [] : departmentKeys,
    shopKeys: selection.shopKeys,
  };
}

function distinctComparisonScopes(scopes: ExplicitStoreScope[]): ExplicitStoreScope[] {
  const seen = new Set<string>();
  const distinct = scopes.filter((scope) => {
    const signature = unique(scope.departmentKeys ?? []).sort().join(',');
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  return distinct.length > 1 ? distinct : [];
}

function departmentIdsByShop(nodes: StoreScopeNode[]): { departmentsByShop: Map<string, string[]>; shopsByDepartment: Map<string, string[]> } {
  const departmentsByShop = new Map<string, string[]>();
  const shopsByDepartment = new Map<string, string[]>();
  const visit = (node: StoreScopeNode) => {
    if (node.type === 'store' && node.store_key && node.department_id) {
      const shopKey = String(node.store_key);
      const departmentKey = String(node.department_id);
      departmentsByShop.set(shopKey, unique([...(departmentsByShop.get(shopKey) ?? []), departmentKey]));
      shopsByDepartment.set(departmentKey, unique([...(shopsByDepartment.get(departmentKey) ?? []), shopKey]));
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return { departmentsByShop, shopsByDepartment };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
