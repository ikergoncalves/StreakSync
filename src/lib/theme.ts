import { DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';
import { ColorSchemeName } from 'react-native';

/**
 * Shared dark-mode palette reference.
 *
 * Dark mode follows the OS appearance automatically (see `darkMode: 'media'`
 * in tailwind.config.js) — screens only declare `dark:` variants. To keep the
 * theme coherent, every screen uses the SAME class pairs for the same role:
 *
 * | Role                    | Light                       | Dark                          |
 * | ----------------------- | --------------------------- | ----------------------------- |
 * | Screen background       | bg-slate-50                 | dark:bg-slate-950             |
 * | Card / surface          | bg-white                    | dark:bg-slate-900             |
 * | Primary text            | text-slate-900              | dark:text-slate-50            |
 * | Secondary text          | text-slate-500              | dark:text-slate-400           |
 * | Muted text / timestamps | text-slate-400              | dark:text-slate-500           |
 * | Field label / body      | text-slate-700 / -600       | dark:text-slate-300           |
 * | Input surface           | bg-white border-slate-300   | dark:bg-slate-900 dark:border-slate-700 |
 * | Neutral chip / button   | bg-slate-200 (active: -300) | dark:bg-slate-800 (active: -700) |
 * | Text on neutral chip    | text-slate-700 / -900       | dark:text-slate-200 / -100    |
 * | Hairline border         | border-slate-100 / -200     | dark:border-slate-800         |
 * | Error banner            | bg-red-50 text-red-700      | dark:bg-red-950 dark:text-red-300 |
 * | Warning banner          | bg-amber-50 text-amber-800  | dark:bg-amber-950 dark:text-amber-200 |
 * | Accent link text        | text-emerald-700            | dark:text-emerald-400         |
 * | Accent surface (subtle) | bg-emerald-50               | dark:bg-emerald-950           |
 *
 * The emerald-600 primary accent (buttons, spinners, active tab tint) has
 * enough contrast on both backgrounds and intentionally stays identical in
 * both modes.
 */

/** Tailwind slate hexes for values NativeWind classes can't reach (inline styles). */
export const SLATE = {
  50: '#f8fafc',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  950: '#020617',
} as const;

/** Primary accent (Tailwind emerald-600) — shared by light and dark mode. */
export const ACCENT = '#059669';

export interface InlineColors {
  /** TextInput placeholderTextColor. */
  placeholder: string;
  /** Border of an unchecked completion toggle (TodayScreen). */
  uncheckedToggleBorder: string;
  /** Empty (not completed) cell in the habit history grid. */
  gridEmptyCell: string;
  /** Outline marking today in the habit history grid. */
  gridTodayOutline: string;
  /** Spinner rendered on a neutral (slate) surface, e.g. secondary Button. */
  onNeutralSpinner: string;
}

/**
 * Scheme-dependent colors for inline `style` props, mirroring the class
 * pairs above. Callers pass `useColorScheme()`; null/undefined means the OS
 * didn't report a scheme and falls back to light, matching NativeWind.
 */
export function getInlineColors(scheme: ColorSchemeName): InlineColors {
  const dark = scheme === 'dark';
  return {
    placeholder: dark ? SLATE[500] : SLATE[400],
    uncheckedToggleBorder: dark ? SLATE[600] : SLATE[300],
    gridEmptyCell: dark ? SLATE[700] : SLATE[200],
    gridTodayOutline: dark ? SLATE[50] : SLATE[900],
    onNeutralSpinner: dark ? SLATE[50] : SLATE[900],
  };
}

/**
 * React Navigation theme aligned with the slate palette, so the pieces
 * navigation owns (tab bar, screen background behind transitions) match the
 * NativeWind-styled content in both modes.
 */
export function getNavigationTheme(scheme: ColorSchemeName): Theme {
  if (scheme === 'dark') {
    return {
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: ACCENT,
        background: SLATE[950],
        card: SLATE[900],
        border: SLATE[800],
        text: SLATE[50],
      },
    };
  }
  return {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: ACCENT,
      background: SLATE[50],
      card: '#ffffff',
      border: SLATE[200],
      text: SLATE[900],
    },
  };
}
