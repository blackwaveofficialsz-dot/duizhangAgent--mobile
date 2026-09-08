import { createContext, type PropsWithChildren, useContext, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { semanticThemes, type AppTheme } from './tokens';
import {
  resolveThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
  useThemeStore,
} from './themeStore';

type ThemeContextValue = {
  theme: AppTheme;
  mode: ThemeMode;
  resolvedMode: ResolvedThemeMode;
  hydrated: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: semanticThemes.light,
  mode: 'system',
  resolvedMode: 'light',
  hydrated: false,
  setMode: async () => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemMode = useColorScheme();
  const { mode, hydrated, hydrate, setMode } = useThemeStore();
  const resolvedMode = resolveThemeMode(mode, systemMode);
  const value = useMemo(
    () => ({ theme: semanticThemes[resolvedMode], mode, resolvedMode, hydrated, setMode }),
    [hydrated, mode, resolvedMode, setMode],
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
