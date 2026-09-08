import { create } from 'zustand';
import type { LaborRow, OrderRow, ProductQueryScope, ProductRow, ProductTrendResult } from '@/services/api/analytics';

type InsightDetailState = {
  isReadOnly: boolean;
  labor: LaborRow | null;
  order: OrderRow | null;
  product: ProductRow | null;
  productScope: ProductQueryScope | null;
  productTrend: ProductTrendResult | null;
  reset: () => void;
  selectLabor: (labor: LaborRow, isReadOnly?: boolean) => void;
  selectOrder: (order: OrderRow, isReadOnly?: boolean) => void;
  selectProduct: (product: ProductRow, isReadOnly?: boolean, productScope?: ProductQueryScope | null, productTrend?: ProductTrendResult | null) => void;
};

export const useInsightDetailStore = create<InsightDetailState>((set) => ({
  isReadOnly: false,
  labor: null,
  order: null,
  product: null,
  productScope: null,
  productTrend: null,
  reset: () => set({ isReadOnly: false, labor: null, order: null, product: null, productScope: null, productTrend: null }),
  selectLabor: (labor, isReadOnly = false) => set({ isReadOnly, labor }),
  selectOrder: (order, isReadOnly = false) => set({ isReadOnly, order }),
  selectProduct: (product, isReadOnly = false, productScope = null, productTrend = null) => set({ isReadOnly, product, productScope, productTrend }),
}));
