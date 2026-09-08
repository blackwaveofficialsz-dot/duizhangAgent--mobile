import * as SecureStore from 'expo-secure-store';
import type { ColorSchemeName } from 'react-native';
import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

export const THEME_MODE_STORAGE_KEY = 'theme-mode';

type ThemeState = {
  mode: ThemeMode;
  hydrated: boolean;
  revision: number;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
};

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveThemeMode(
  mode: ThemeMode,
  systemMode: ColorSchemeName,
): ResolvedThemeMode {
  return mode === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : mode;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  hydrated: false,
  revision: 0,
  hydrate: async () => {
    const revision = get().revision;
    let mode: ThemeMode = 'system';
    try {
      const storedMode = await SecureStore.getItemAsync(THEME_MODE_STORAGE_KEY);
      if (isThemeMode(storedMode)) mode = storedMode;
    } catch {
      // Keep the safe default when secure storage is unavailable.
    }
    set((state) => state.revision === revision
      ? { mode, hydrated: true }
      : { hydrated: true });
  },
  setMode: async (mode) => {
    set((state) => ({ mode, revision: state.revision + 1 }));
    try {
      await SecureStore.setItemAsync(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // The in-memory selection remains usable for this session.
    }
  },
}));
