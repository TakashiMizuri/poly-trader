export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'poly-trader-theme'

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function applyThemeToDocument(theme: Theme) {
  document.documentElement.dataset.theme = theme
}
