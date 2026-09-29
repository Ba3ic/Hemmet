// Hemmet – start, inloggningsflöde, flikrad och router.
import { sb, hasSecretKey } from './supabase.js';
import { state } from './state.js';
import { applyTheme } from './theme.js';
import { renderAuth, renderHouseholdSetup, renderConfigHelp, loadHousehold } from './auth.js';
import { startRealtime, stopRealtime, onChange } from './realtime.js';
import { h, icon, errorBox, put, add } from './ui.js';

const root = document.getElementById('app');

const TABS = [
  { id: 'idag', label: 'Idag', icon: 'today' },
  { id: 'kalender', label: 'Kalender', icon: 'calendar' },
  { id: 'listor', label: 'Listor', icon: 'list' },
  { id: 'anteckningar', label: 'Anteckningar', icon: 'note' },
  { id: 'utgifter', label: 'Utgifter', icon: 'wallet' },
];

// Varje vy ligger i en egen fil och laddas när den behövs.
const VIEWS = {
  idag: () => import('./idag.js'),
  kalender: () => import('./kalender.js'),
  listor: () => import('./listor.js'),
  anteckningar: () => import('./anteckningar.js'),
  utgifter: () => import('./utgifter.js'),
  installningar: () => import('./installningar.js'),
};
// Undervyer hör till en flik i flikraden.
const TAB_OF = { installningar: 'idag' };

let shell = null;          // { main, tabLinks, offlineBar }
let current = null;        // { name, controller, container }
let mountToken = 0;
let unsubscribeRealtime = null;

applyTheme();
registerServiceWorker();
boot();

// ---------- Start ----------

async function boot() {
  if (!sb) return renderConfigHelp(root, { secret: hasSecretKey });

  const { data } = await sb.auth.getSession();
  await handleSession(data.session);

  sb.auth.onAuthStateChange((event, session) => {
    // Tokenförnyelse ska inte rita om appen.
    if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_IN' && state.user && session?.user?.id === state.user.id && shell) return;
    // Kör utanför callbacken (Supabase rekommenderar att inte vänta på andra anrop här).
    setTimeout(() => handleSession(session), 0);
  });
}

async function handleSession(session) {
  if (!session) {
    teardownShell();
    state.user = null;
    state.household = null;
    try { localStorage.removeItem('hemmet-household'); } catch { /* ignoreras */ }
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    return renderAuth(root);
  }
  state.user = session.user;
  try {
    await loadHousehold();
  } catch (err) {
    // Offline: använd senast kända hushåll så att man kan läsa cachad data.
    const cached = readCachedHousehold();
    if (cached && !navigator.onLine) state.household = cached;
    else {
      put(root, h('main', { class: 'auth' }, h('div', { class: 'auth-inner' }, errorBox(err, () => handleSession(session)))));
      return;
    }
  }
  if (!state.household) {
    teardownShell();
    return renderHouseholdSetup(root, startApp);
  }
  startApp();
}

function startApp() {
  cacheHousehold(state.household);
  buildShell();
  startRealtime(state.household.id);
  unsubscribeRealtime?.();
  unsubscribeRealtime = onChange((table) => requestRefresh(table));
  route();
}

// ---------- Skal ----------

function buildShell() {
  teardownShell();
  const main = h('div', { class: 'shell' });
  const tabLinks = {};
  const nav = h('nav', { class: 'tabbar', attrs: { 'aria-label': 'Flikar' } },
    h('ul', {}, TABS.map((t) => {
      const a = h('a', { href: '#' + t.id }, h('span', { class: 'tab-ico' }, icon(t.icon)), h('span', { class: 'tab-label', text: t.label }));
      tabLinks[t.id] = a;
      return h('li', {}, a);
    })),
  );
  const offlineBar = h('div', { class: 'offline-bar', hidden: navigator.onLine, attrs: { role: 'status' } },
    'Du är offline – du ser senast hämtade data. Ändringar går inte att spara just nu.');
  put(root, offlineBar, main, nav);
  shell = { main, tabLinks, offlineBar };
}

function teardownShell() {
  stopRealtime();
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  current?.controller?.destroy?.();
  current = null;
  shell = null;
}

// ---------- Router ----------

window.addEventListener('hashchange', () => { if (shell) route(); });

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = raw.split('/');
  return { name: VIEWS[name] ? name : 'idag', params: rest.filter(Boolean) };
}

async function route() {
  const { name, params } = parseHash();
  const token = ++mountToken;

  const tab = TAB_OF[name] || name;
  for (const [id, a] of Object.entries(shell.tabLinks)) {
    if (id === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  current?.controller?.destroy?.();
  const container = h('main', { class: 'view', attrs: { tabindex: '-1' } });
  put(shell.main, container);
  const sameView = current?.name === name;
  current = { name, controller: null, container };
  if (!sameView) window.scrollTo(0, 0);

  let mod;
  try {
    mod = await VIEWS[name]();
  } catch (err) {
    container.append(errorBox(err, () => route()));
    return;
  }
  if (token !== mountToken) return;
  current.controller = mod.mount(container, { params, navigate }) || {};
  document.title = (mod.title ? mod.title + ' · ' : '') + 'Hemmet';
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------- Uppdatering vid realtidsändringar ----------

let refreshTimer = null;
let pendingTables = new Set();

function requestRefresh(table) {
  if (!current?.controller?.refresh) return;
  const wanted = current.controller.tables;
  if (table !== '*' && wanted && !wanted.includes(table)) return;
  pendingTables.add(table);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(flushRefresh, 250);
}

function isTyping(container) {
  const a = document.activeElement;
  if (!a || !(a.matches('input, textarea, select') || a.isContentEditable)) return false;
  // Skriver man i ett blad eller i vyn – vänta tills fältet lämnas.
  return container.contains(a) || !!a.closest('.sheet');
}

function flushRefresh() {
  const c = current;
  if (!c?.controller?.refresh) return;
  // Vyer som hanterar redigering själva (t.ex. anteckningar) sätter handlesTyping.
  if (!c.controller.handlesTyping && isTyping(c.container)) {
    const active = document.activeElement;
    active.addEventListener('blur', () => { refreshTimer = setTimeout(flushRefresh, 150); }, { once: true });
    return;
  }
  const tables = [...pendingTables];
  pendingTables = new Set();
  c.controller.refresh(tables);
}

// Appen kan ha sovit (t.ex. i bakgrunden på iPhone) – hämta om när den visas igen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shell) requestRefresh('*');
});
window.addEventListener('online', () => {
  if (shell) { shell.offlineBar.hidden = true; requestRefresh('*'); }
});
window.addEventListener('offline', () => {
  if (shell) shell.offlineBar.hidden = false;
});

// ---------- Offline-stöd ----------

function cacheHousehold(hh) {
  try { localStorage.setItem('hemmet-household', JSON.stringify(hh)); } catch { /* ignoreras */ }
}
function readCachedHousehold() {
  try { return JSON.parse(localStorage.getItem('hemmet-household') || 'null'); } catch { return null; }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker kunde inte registreras', e));
  });
}
