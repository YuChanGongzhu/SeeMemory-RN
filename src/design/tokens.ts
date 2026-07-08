/**
 * SiMemory design tokens — faithful to the app-prototype web design
 * (app-prototype/src/index.css). Single light iOS-style theme; a few
 * sub-pages (membership / power store / historical mood) use the `dark`
 * sub-palette. All RN UI reads from here instead of the legacy 3-theme system.
 */
import {Platform, TextStyle} from 'react-native';

export const colors = {
  // surfaces
  bg: '#FFFFFF',
  bgApp: '#F9F9FB', // app/content background
  bgSecondary: '#F2F2F7', // chips, inputs, icon buttons
  nested: '#F9F9FB',

  // text
  textMain: '#1A1A1A',
  textSub: '#8E8E93',
  textTertiary: '#C7C7CC', // inactive nav / placeholder
  onDark: '#FFFFFF',

  // lines + primary
  border: '#E5E5EA',
  primary: '#000000',

  // dark cards / dark pages
  dark: '#1A1A1A',
  darkCard: '#1C1C1E',
  darkCard2: '#2D2D30',

  // emotions
  focus: '#34C759',
  anxiety: '#FF3B30',
  excite: '#FFCC00',
  fatigue: '#8E8E93',

  // semantic / accents
  premium: '#FDE047',
  storage: '#63CE84',
  success: '#34D399',
  danger: '#FF3B30',
  dangerSoft: '#FFE5E5',

  // topic aura
  auraPerson: '#BF5AF2',
  auraProject: '#0A84FF',
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  pill: 20,
  card: 20,
  bigCard: 24,
  sheet: 28,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  page: 20, // horizontal page padding
} as const;

// iOS System (SF Pro) closely mirrors Inter; swap to bundled Inter later
// (requires native font linking + rebuild).
const FONT = Platform.select({ios: 'System', android: 'sans-serif', default: 'System'}) as string;
export const fontFamily = FONT;

type TypeToken = Pick<TextStyle, 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight'>;

export const type = {
  pageTitle: {fontSize: 24, fontWeight: '700', letterSpacing: -0.5},
  pageSub: {fontSize: 13, fontWeight: '400'},
  sysTitle: {fontSize: 17, fontWeight: '700', letterSpacing: -0.3},
  sysBody: {fontSize: 14, lineHeight: 22},
  memTitle: {fontSize: 16, fontWeight: '700', letterSpacing: -0.2},
  memBody: {fontSize: 14, lineHeight: 22},
  memTime: {fontSize: 12, fontWeight: '500'},
  tag: {fontSize: 11, fontWeight: '600'},
  sectionLabel: {fontSize: 12, fontWeight: '600', letterSpacing: 0.7},
  bubble: {fontSize: 15, lineHeight: 23},
  menuLabel: {fontSize: 15, fontWeight: '500'},
  statNum: {fontSize: 22, fontWeight: '700', letterSpacing: -0.6},
  statLabel: {fontSize: 12, fontWeight: '500'},
  sheetTitle: {fontSize: 20, fontWeight: '700', letterSpacing: -0.4},
  bigTitle: {fontSize: 26, fontWeight: '700', letterSpacing: -0.6},
} satisfies Record<string, TypeToken>;

// Shadows — RN approximation of the prototype's layered box-shadows.
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  soft: {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  tabbar: {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 12,
  },
  fab: {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 14},
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 14,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 16,
  },
} as const;

// Frosted-glass capsule background (solid translucent fallback for blur).
export const frostedBg = 'rgba(255,255,255,0.92)';

export const emotionMeta = {
  focus: {label: '专注', color: colors.focus},
  anxiety: {label: '焦虑', color: colors.anxiety},
  excitement: {label: '兴奋', color: colors.excite},
  fatigue: {label: '疲惫', color: colors.fatigue},
} as const;

export type EmotionKey = keyof typeof emotionMeta;
