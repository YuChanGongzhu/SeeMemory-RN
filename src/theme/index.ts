// RingMemoryApp Theme System
// Three visual directions: Neon Horizon, Sunset Grove, Shiguang

export type ThemeMode = 'neon' | 'warm' | 'shiguang';

export interface Theme {
  mode: ThemeMode;
  name: string;

  // Colors
  colors: {
    bg: string;
    bgSecondary: string;
    bgCard: string;
    bgCardAlt?: string;

    accent: string;
    accentSecondary: string;
    accentGlow?: string;

    success: string;
    warning: string;
    error: string;

    text: string;
    textSecondary: string;
    textMuted: string;

    border: string;
    borderAccent: string;

    // Specific elements
    input: string;
    inputBorder: string;
    inputBorderFocus: string;

    buttonPrimary: string;
    buttonPrimaryText: string;
    buttonSecondary: string;
    buttonSecondaryText: string;

    chatUser: string;
    chatAI: string;
    chatAIBorder?: string;

    statusConnected: string;
    statusConnecting: string;
    statusError: string;
    statusOffline: string;

    recordDot: string;
  };

  // Typography
  fonts: {
    display: string;
    heading: string;
    body: string;
    mono: string;
  };

  // Spacing
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };

  // Border Radius
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };

  // Shadows
  shadows: {
    card: any;
    button: any;
    glow?: string;
  };

  // 拾光-specific season colors
  seasons?: {
    spring: string;
    summer: string;
    autumn: string;
    winter: string;
  };

  // 拾光-specific gold accent
  gold?: string;
  goldGlow?: string;
}

// ============================================
// VERSION A: NEON HORIZON (Future Tech)
// ============================================
const neonTheme: Theme = {
  mode: 'neon',
  name: 'Neon Horizon',

  colors: {
    bg: '#050510',
    bgSecondary: '#0A0A1A',
    bgCard: 'rgba(20, 25, 50, 0.6)',
    bgCardAlt: 'rgba(20, 25, 50, 0.8)',

    accent: '#00F5FF',
    accentSecondary: '#FF00E5',
    accentGlow: 'rgba(0, 245, 255, 0.4)',

    success: '#00FF88',
    warning: '#FFB800',
    error: '#FF3366',

    text: '#FFFFFF',
    textSecondary: '#8888AA',
    textMuted: '#555577',

    border: 'rgba(0, 245, 255, 0.15)',
    borderAccent: 'rgba(0, 245, 255, 0.4)',

    input: 'rgba(5, 5, 16, 0.8)',
    inputBorder: 'rgba(0, 245, 255, 0.3)',
    inputBorderFocus: 'rgba(0, 245, 255, 0.8)',

    buttonPrimary: '#00F5FF',
    buttonPrimaryText: '#050510',
    buttonSecondary: 'rgba(20, 25, 50, 0.8)',
    buttonSecondaryText: '#00F5FF',

    chatUser: 'linear-gradient(135deg, #00F5FF 0%, #00B8D4 100%)',
    chatAI: 'rgba(20, 25, 50, 0.8)',
    chatAIBorder: 'rgba(0, 245, 255, 0.3)',

    statusConnected: '#00FF88',
    statusConnecting: '#FFB800',
    statusError: '#FF3366',
    statusOffline: '#666666',

    recordDot: '#FF3366',
  },

  fonts: {
    display: 'System',
    heading: 'System',
    body: 'System',
    mono: 'Menlo',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 20,
  },

  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
    },
    button: {
      shadowColor: '#00F5FF',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 15,
      elevation: 6,
    },
    glow: '0 0 20px rgba(0, 245, 255, 0.5), 0 0 40px rgba(0, 245, 255, 0.2)',
  },
};

// ============================================
// VERSION B: SUNSET GROVE (Warm Life)
// ============================================
const warmTheme: Theme = {
  mode: 'warm',
  name: 'Sunset Grove',

  colors: {
    bg: '#FDF8F3',
    bgSecondary: '#F7EFE7',
    bgCard: '#FFFFFF',

    accent: '#FF7043',
    accentSecondary: '#26A69A',
    accentGlow: 'rgba(255, 112, 67, 0.15)',

    success: '#66BB6A',
    warning: '#FFA726',
    error: '#EF5350',

    text: '#342B24',
    textSecondary: '#6F6257',
    textMuted: '#8A7A6D',

    border: '#DCCEC2',
    borderAccent: '#FF7043',

    input: '#FDF8F3',
    inputBorder: '#D8C8BB',
    inputBorderFocus: '#FF7043',

    buttonPrimary: '#F47A4E',
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#FFFFFF',
    buttonSecondaryText: '#FF7043',

    chatUser: '#F47A4E',
    chatAI: '#FFFFFF',
    chatAIBorder: '#FF7043',

    statusConnected: '#66BB6A',
    statusConnecting: '#FFA726',
    statusError: '#EF5350',
    statusOffline: '#AAAAAA',

    recordDot: '#FF7043',
  },

  fonts: {
    display: 'System',
    heading: 'System',
    body: 'System',
    mono: 'Menlo',
  },

  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 56,
  },

  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 28,
    pill: 24,
  },

  shadows: {
    card: {
      shadowColor: '#FF7043',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
      elevation: 4,
    },
    button: {
      shadowColor: '#FF7043',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 15,
      elevation: 6,
    },
  },
};

// ============================================
// VERSION C: SHIGUANG (拾光 · Four Seasons Memory)
// ============================================
const shiguangTheme: Theme = {
  mode: 'shiguang',
  name: '拾光',

  colors: {
    bg: '#F3F1E9',
    bgSecondary: '#E7E8DD',
    bgCard: '#FFFFFF',
    bgCardAlt: '#EEF0E8',

    accent: '#3F8A82',
    accentSecondary: '#E3A94F',
    accentGlow: 'rgba(63, 138, 130, 0.18)',

    success: '#7FA868',
    warning: '#C2803C',
    error: '#C0584A',

    text: '#28302C',
    textSecondary: '#6B7363',
    textMuted: '#9AA095',

    border: '#EAE5D7',
    borderAccent: '#C9DDD7',

    input: '#FFFFFF',
    inputBorder: '#E6E1D2',
    inputBorderFocus: '#3F8A82',

    buttonPrimary: '#3F8A82',
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#FFFFFF',
    buttonSecondaryText: '#3F8A82',

    chatUser: '#3F8A82',
    chatAI: '#FFFFFF',
    chatAIBorder: '#EAE5D7',

    statusConnected: '#7FA868',
    statusConnecting: '#C2803C',
    statusError: '#C0584A',
    statusOffline: '#9AA095',

    recordDot: '#3F8A82',
  },

  fonts: {
    display: 'System',
    heading: 'System',
    body: 'System',
    mono: 'ui-monospace',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  radius: {
    sm: 8,
    md: 14,
    lg: 20,
    xl: 24,
    pill: 20,
  },

  shadows: {
    card: {
      shadowColor: '#403C28',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 4,
    },
    button: {
      shadowColor: '#3F8A82',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 6,
    },
  },

  // 拾光-specific season colors
  seasons: {
    spring: '#7FA868',
    summer: '#3F8A82',
    autumn: '#C2803C',
    winter: '#7C92A6',
  },

  // 拾光-specific accent colors
  gold: '#E3A94F',
  goldGlow: 'rgba(242, 204, 131, 0.75)',
};

// Export all themes
export const themes: Record<ThemeMode, Theme> = {
  neon: neonTheme,
  warm: warmTheme,
  shiguang: shiguangTheme,
};

export const defaultTheme: ThemeMode = 'shiguang';
