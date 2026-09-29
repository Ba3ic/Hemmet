// Inställningar: inbjudningskod, tema och utloggning.
import { sb } from './supabase.js';
import { state } from './state.js';
import { getThemePref, setThemePref } from './theme.js';
import { h, icon, iconButton, toast, add } from './ui.js';

export const title = 'Inställningar';

export function mount(root, { navigate }) {
  const hh = state.household;

  const copyBtn = h('button', { type: 'button', class: 'btn btn-sm', on: { click: copyCode } }, icon('copy'), 'Kopiera');

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(hh.invite_code);
      toast('Koden är kopierad');
    } catch {
      // Reserv om urklipp inte är tillåtet: markera koden så att man kan kopiera själv.
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Markera och kopiera koden manuellt');
    }
  }

  const codeEl = h('code', { text: hh.invite_code });

  const current = getThemePref();
  const themes = [['dark', 'Mörk'], ['light', 'Ljus'], ['angelica', 'Angelica Mode'], ['system', 'Följ systemet']];
  const themeControl = h('div', { class: 'segmented themes', attrs: { role: 'radiogroup', 'aria-label': 'Tema' } },
    themes.map(([value, label]) => h('label', {},
      h('input', { type: 'radio', name: 'theme', value, checked: value === current, on: { change: () => setThemePref(value) } }),
      h('span', { text: label }),
    )),
  );

  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  add(root,
    h('header', { class: 'topbar' },
      iconButton('back', 'Tillbaka till Idag', () => navigate('#idag')),
      h('div', { class: 'grow' }, h('h1', { text: 'Inställningar' })),
    ),

    h('section', { class: 'card', attrs: { 'aria-labelledby': 'hh-title' } },
      h('div', { class: 'card-title' }, h('h2', { id: 'hh-title', text: hh.name })),
      h('p', { class: 'muted small', style: 'margin-bottom:10px', text: 'Dela koden med din sambo. Hen skapar ett konto, väljer "Gå med med kod" och skriver in den.' }),
      h('div', { class: 'invite' }, codeEl, copyBtn),
    ),

    h('section', { class: 'card', attrs: { 'aria-labelledby': 'theme-title' } },
      h('div', { class: 'card-title' }, h('h2', { id: 'theme-title', text: 'Tema' })),
      themeControl,
    ),

    !isStandalone ? h('section', { class: 'card', attrs: { 'aria-labelledby': 'home-title' } },
      h('div', { class: 'card-title' }, h('h2', { id: 'home-title', text: 'Lägg Hemmet på hemskärmen' })),
      h('p', { class: 'muted small', text: 'På iPhone: öppna sidan i Safari, tryck på Dela-knappen och välj "Lägg till på hemskärmen". Då öppnas Hemmet som en egen app.' }),
    ) : null,

    h('section', { class: 'card' },
      h('div', { class: 'settings-row' },
        h('div', {}, h('div', { class: 'small muted', text: 'Inloggad som' }), h('div', { text: state.user.email, style: 'overflow-wrap:anywhere' })),
        h('button', { type: 'button', class: 'btn btn-danger', on: { click: logout } }, icon('logout'), 'Logga ut'),
      ),
    ),
  );

  async function logout() {
    const { error } = await sb.auth.signOut();
    if (error) {
      // Nätverksfel: logga ut lokalt ändå.
      await sb.auth.signOut({ scope: 'local' });
    }
  }

  return {};
}
