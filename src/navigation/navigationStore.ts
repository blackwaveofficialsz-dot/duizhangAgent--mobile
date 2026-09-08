import { create } from 'zustand';

export type DrawerTab = 'navigation' | 'history';

type NavigationState = {
  activeTab: DrawerTab;
  setActiveTab: (tab: DrawerTab) => void;
  prepareDrawerForRoute: (routeName: string) => void;
};

export function defaultDrawerTabForRoute(routeName: string): DrawerTab {
  return routeName === 'chat' ? 'history' : 'navigation';
}

export function getDrawerWidth(windowWidth: number): number {
  return Math.min(windowWidth * 0.7, 360);
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeTab: 'navigation',
  setActiveTab: (activeTab) => set({ activeTab }),
  prepareDrawerForRoute: (routeName) => {
    set({ activeTab: defaultDrawerTabForRoute(routeName) });
  },
}));
