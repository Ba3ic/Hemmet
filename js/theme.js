// Temahantering: 'dark' (standard), 'light', 'angelica' eller 'system'. Sparas i localStorage.
const KEY = 'hemmet-theme';
const THEMES = ['dark', 'light', 'angelica'];
const COLORS = { dark: '#0e1413', light: '#f2f5f3', angelica: '#f6efe6' };
let decorLoaded = false;
const media = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) || v === 'system' ? v : 'dark';
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
  return THEMES.includes(pref) ? pref : 'dark';
}

export function applyTheme(pref = getThemePref()) {
  const theme = resolvedTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[theme]);
  // Glitter och katt hör bara till Angelica Mode (laddas först när temat väljs).
  if (theme === 'angelica') import('./angelica.js').then((m) => m.startDecor()).catch(() => {});
  else if (decorLoaded) import('./angelica.js').then((m) => m.stopDecor());
  if (theme === 'angelica') decorLoaded = true;
}

media?.addEventListener?.('change', () => {
  if (getThemePref() === 'system') applyTheme('system');
});
