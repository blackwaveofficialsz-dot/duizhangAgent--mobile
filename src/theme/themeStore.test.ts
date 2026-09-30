import * as SecureStore from 'expo-secure-store';
import { brand, palette, semanticThemes } from './tokens';
import {
  THEME_MODE_STORAGE_KEY,
  resolveThemeMode,
  useThemeStore,
} from './themeStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItemAsync = jest.mocked(SecureStore.getItemAsync);
const setItemAsync = jest.mocked(SecureStore.setItemAsync);

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const [red, green, blue] = color.slice(1).match(/.{2}/g)!.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'system', hydrated: false, revision: 0 });
    getItemAsync.mockReset();
    setItemAsync.mockReset();
  });

  it('exports the public brand contract and derives the palette from it', () => {
    expect(brand).toEqual({
      primary: '#087E6D',
      tide: '#19A58E',
      coral: '#FF5A36',
      night: '#111C25',
    });
    expect(palette).toMatchObject({
      ...brand,
      white: '#FFFFFF',
      ink: '#212121',
      stone: '#EEECE7',
      line: '#D9D9DD',
    });
  });

  it('keeps button labels and input placeholders at WCAG AA contrast', () => {
    Object.values(semanticThemes).forEach((theme) => {
      expect(contrastRatio(theme.action.primary, theme.action.onPrimary)).toBeGreaterThanOrEqual(4.5);
      Object.values(theme.background).forEach((background) => {
        expect(contrastRatio(theme.text.muted, background)).toBeGreaterThanOrEqual(4.5);
      });
    });
  });

  it('uses the confirmed mobile redesign theme values', () => {
    expect(semanticThemes.light).toMatchObject({
      background: { canvas: '#F5F7F8', surface: '#FFFFFF', subtle: '#EDF1F2' },
      text: { primary: '#17212B', secondary: '#53616D', muted: '#5F6B76' },
      border: { default: '#DDE5EA', strong: '#A8B2BC' },
      action: { primary: '#1863DC', primaryPressed: '#1454C4', onPrimary: '#FFFFFF' },
      status: { danger: '#D9492B', success: '#087E6D', warning: '#A76500' },
    });
    expect(semanticThemes.dark).toMatchObject({
      background: { canvas: '#111C25', surface: '#18242E', subtle: '#1E2C37' },
      text: { primary: '#F5F7FA', secondary: '#A6B1BB', muted: '#8C98A4' },
      border: { default: '#2C3A46', strong: '#526272' },
      action: { primary: '#2563EB', primaryPressed: '#1D4ED8', onPrimary: '#FFFFFF' },
      status: { danger: '#FF5A36', success: '#20C6A3', warning: '#F2B84B' },
    });
  });

  it('defaults to the system theme', () => {
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('restores a persisted theme selection', async () => {
    getItemAsync.mockResolvedValue('dark');

    await useThemeStore.getState().hydrate();

    expect(getItemAsync).toHaveBeenCalledWith(THEME_MODE_STORAGE_KEY);
    expect(useThemeStore.getState()).toMatchObject({ mode: 'dark', hydrated: true });
  });

  it('falls back to system for an invalid persisted value', async () => {
    getItemAsync.mockResolvedValue('sepia');

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', hydrated: true });
  });

  it('finishes hydration with the system theme when storage cannot be read', async () => {
    getItemAsync.mockRejectedValue(new Error('secure storage unavailable'));

    await expect(useThemeStore.getState().hydrate()).resolves.toBeUndefined();

    expect(useThemeStore.getState()).toMatchObject({ mode: 'system', hydrated: true });
  });

  it('does not overwrite a selection made while hydration is in progress', async () => {
    let resolveStoredMode!: (value: string | null) => void;
    getItemAsync.mockImplementation(
      () => new Promise((resolve) => {
        resolveStoredMode = resolve;
      }),
    );

    const hydration = useThemeStore.getState().hydrate();
    await useThemeStore.getState().setMode('dark');
    resolveStoredMode('light');
    await hydration;

    expect(useThemeStore.getState()).toMatchObject({ mode: 'dark', hydrated: true });
  });

  it('persists an explicit theme selection', async () => {
    setItemAsync.mockResolvedValue();

    await useThemeStore.getState().setMode('light');

    expect(setItemAsync).toHaveBeenCalledWith(THEME_MODE_STORAGE_KEY, 'light');
    expect(useThemeStore.getState().mode).toBe('light');
  });

  it('keeps the selected theme when storage cannot be written', async () => {
    setItemAsync.mockRejectedValue(new Error('secure storage unavailable'));

    await expect(useThemeStore.getState().setMode('dark')).resolves.toBeUndefined();

    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('tracks system light and dark changes only in system mode', () => {
    expect(resolveThemeMode('system', 'light')).toBe('light');
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
  });
});
