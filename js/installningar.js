// Inställningar: inbjudningskod, ditt namn, tema och utloggning.
import { sb } from './supabase.js';
import { state } from './state.js';
import { getThemePref, setThemePref } from './theme.js';
import { h, icon, iconButton, toast, toastError, add } from './ui.js';

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

  // Namnet visas som din flik under Utgifter.
  const nameInput = h('input', { class: 'input', id: 'my-name', placeholder: 'T.ex. Lucas', attrs: { maxlength: '30', autocomplete: 'given-name' } });
  sb.from('members').select('display_name').eq('household_id', hh.id).eq('user_id', state.user.id).maybeSingle()
    .then(({ data }) => { if (data?.display_name && !nameInput.value) nameInput.value = data.display_name; });
  const nameForm = h('form', { class: 'add-expense', on: { submit: async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc('set_my_profile', { p_household: hh.id, p_name: nameInput.value.trim() });
    if (error) return toastError(error);
    nameInput.blur();
    toast('Namnet är sparat');
  } } }, nameInput, h('button', { type: 'submit', class: 'btn btn-sm', text: 'Spara' }));

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

    h('section', { class: 'card', attrs: { 'aria-labelledby': 'name-title' } },
      h('div', { class: 'card-title' }, h('h2', { id: 'name-title' }, h('label', { text: 'Ditt namn', attrs: { for: 'my-name' } }))),
      h('p', { class: 'muted small', style: 'margin-bottom:10px', text: 'Visas som din flik under Utgifter, för er båda.' }),
      nameForm,
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
