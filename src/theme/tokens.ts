export const brand = {
  primary: '#087E6D',
  tide: '#19A58E',
  coral: '#FF5A36',
  night: '#111C25',
} as const;

export const palette = {
  ...brand,
  white: '#FFFFFF',
  ink: '#212121',
  stone: '#EEECE7',
  line: '#D9D9DD',
} as const;

export type ThemeTokens = {
  background: {
    canvas: string;
    surface: string;
    subtle: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  border: {
    default: string;
    strong: string;
  };
  action: {
    primary: string;
    primaryPressed: string;
    onPrimary: string;
  };
  status: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  chart: {
    series01: string;
    series02: string;
    series03: string;
    series04: string;
    series05: string;
    series06: string;
    series07: string;
    series08: string;
  };
  overlay: {
    scrim: string;
  };
};

export const semanticThemes = {
  light: {
    background: {
      canvas: '#F5F7F8',
      surface: '#FFFFFF',
      subtle: '#EDF1F2',
    },
    text: {
      primary: '#17212B',
      secondary: '#53616D',
      muted: '#5F6B76',
    },
    border: {
      default: '#DDE5EA',
      strong: '#A8B2BC',
    },
    action: {
      primary: palette.primary,
      primaryPressed: '#056B5D',
      onPrimary: palette.white,
    },
    status: {
      success: palette.primary,
      warning: '#A76500',
      danger: '#D9492B',
      info: '#1863DC',
    },
    chart: {
      series01: '#1863DC',
      series02: palette.tide,
      series03: palette.coral,
      series04: '#7B67B2',
      series05: '#D49A32',
      series06: '#4B91A8',
      series07: '#B65C8A',
      series08: '#6F8A49',
    },
    overlay: {
      scrim: 'rgba(0, 0, 0, 0.56)',
    },
  },
  dark: {
    background: {
      canvas: palette.night,
      surface: '#18242E',
      subtle: '#1E2C37',
    },
    text: {
      primary: '#F5F7FA',
      secondary: '#A6B1BB',
      muted: '#8C98A4',
    },
    border: {
      default: '#2C3A46',
      strong: '#526272',
    },
    action: {
      primary: '#2563EB',
      primaryPressed: '#1D4ED8',
      onPrimary: palette.white,
    },
    status: {
      success: '#20C6A3',
      warning: '#F2B84B',
      danger: '#FF5A36',
      info: '#1863DC',
    },
    chart: {
      series01: '#1863DC',
      series02: '#F1F5FF',
      series03: palette.coral,
      series04: '#A996DB',
      series05: '#E5B95D',
      series06: '#73B6CB',
      series07: '#D487AC',
      series08: '#9DB86F',
    },
    overlay: {
      scrim: 'rgba(0, 0, 0, 0.56)',
    },
  },
} as const satisfies Record<'light' | 'dark', ThemeTokens>;

export type AppTheme = (typeof semanticThemes)[keyof typeof semanticThemes];

function legacyTheme(theme: ThemeTokens) {
  return {
    background: theme.background.canvas,
    text: theme.text.primary,
    textSecondary: theme.text.secondary,
    border: theme.border.default,
  };
}

export const themes = {
  light: legacyTheme(semanticThemes.light),
  dark: legacyTheme(semanticThemes.dark),
} as const;
