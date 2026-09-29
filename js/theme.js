// Temahantering: 'dark' (standard), 'light' eller 'system'. Sparas i localStorage.
const KEY = 'hemmet-theme';
const COLORS = { dark: '#0e1413', light: '#f2f5f3' };
const media = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* privat läge o.d. – temat gäller ändå tills vidare */ }
  applyTheme(pref);
}

export function resolvedTheme(pref = getThemePref()) {
  if (pref === 'system') return media && media.matches ? 'light' : 'dark';
  return pref === 'light' ? 'light' : 'dark';
}

export function applyTheme(pref = getThemePref()) {
  const theme = resolvedTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[theme]);
}

media?.addEventListener?.('change', () => {
  if (getThemePref() === 'system') applyTheme('system');
});
