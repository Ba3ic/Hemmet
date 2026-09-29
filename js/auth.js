// Inloggning, registrering och val av hushåll.
import { sb } from './supabase.js';
import { state } from './state.js';
import { h, icon, clear, field, formError, showFormError, busy, errorMessage } from './ui.js';

function brand(subtitle) {
  return h('div', { class: 'brand' },
    h('div', { class: 'brand-mark' }, icon('house')),
    h('div', {}, h('h1', { text: 'Hemmet' }), h('p', { text: subtitle })),
  );
}

/** Inloggnings-/registreringsvy. */
export function renderAuth(root) {
  let mode = 'login';
  const email = h('input', { class: 'input', type: 'email', name: 'email', required: true, attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false' } });
  const password = h('input', { class: 'input', type: 'password', name: 'password', required: true, minLength: 8, attrs: { autocomplete: 'current-password' } });
  const err = formError();
  const note = h('div', { class: 'form-note', hidden: true, attrs: { role: 'status' } });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' });
  const heading = h('h2', { style: 'margin-bottom:14px' });
  const switchText = h('span');
  const switchBtn = h('button', { type: 'button', on: { click: () => setMode(mode === 'login' ? 'signup' : 'login') } });

  const form = h('form', { class: 'card', attrs: { novalidate: true }, on: { submit: onSubmit } },
    heading, err, note,
    field('E-post', email),
    field('Lösenord', password),
    submit,
  );

  function setMode(m) {
    mode = m;
    heading.textContent = m === 'login' ? 'Logga in' : 'Skapa konto';
    submit.textContent = m === 'login' ? 'Logga in' : 'Skapa konto';
    password.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    switchText.textContent = m === 'login' ? 'Inget konto ännu?' : 'Har du redan ett konto?';
    switchBtn.textContent = m === 'login' ? 'Skapa konto' : 'Logga in';
    showFormError(err, null);
    note.hidden = true;
  }

  async function onSubmit(e) {
    e.preventDefault();
    showFormError(err, null);
    note.hidden = true;
    const em = email.value.trim();
    const pw = password.value;
    if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return showFormError(err, 'Skriv in en giltig e-postadress, t.ex. namn@exempel.se.');
    if (mode === 'signup' && pw.length < 8) return showFormError(err, 'Lösenordet måste vara minst 8 tecken.');
    if (!pw) return showFormError(err, 'Skriv in ditt lösenord.');

    await busy(submit, async () => {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
        if (error) showFormError(err, error);
        // Vid lyckad inloggning tar onAuthStateChange i app.js över.
      } else {
        const { data, error } = await sb.auth.signUp({
          email: em,
          password: pw,
          options: { emailRedirectTo: location.href.split('#')[0] },
        });
        if (error) return showFormError(err, error);
        if (!data.session) {
          note.textContent = `Nästan klart! Vi har skickat ett mejl till ${em}. Klicka på länken i mejlet och logga sedan in här.`;
          note.hidden = false;
          setModeKeepNote('login');
        }
      }
    });
  }

  function setModeKeepNote(m) {
    const keep = note.textContent;
    setMode(m);
    note.textContent = keep;
    note.hidden = false;
  }

  setMode('login');
  clear(root).append(
    h('main', { class: 'auth' },
      h('div', { class: 'auth-inner' },
        brand('Vår gemensamma vardag'),
        form,
        h('p', { class: 'auth-switch' }, switchText, ' ', switchBtn),
      ),
    ),
  );
  email.focus();
}

/** Hämta användarens hushåll (första, om flera). Kastar vid nätverksfel. */
export async function loadHousehold() {
  const { data, error } = await sb
    .from('members')
    .select('household_id, households(id, name, invite_code)')
    .eq('user_id', state.user.id)
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  state.household = row?.households || null;
  return state.household;
}

/** Vy för användare utan hushåll: skapa eller gå med. */
export function renderHouseholdSetup(root, onDone) {
  const content = h('div');

  function showChoices() {
    clear(content).append(
      h('p', { class: 'muted', style: 'margin-bottom:16px', text: 'Ni delar allt i ett hushåll. Den ena skapar det, den andra går med med en kod.' }),
      h('div', { class: 'choice-grid' },
        h('button', { type: 'button', class: 'choice', on: { click: showCreate } },
          h('span', { class: 'ico' }, icon('house')),
          h('span', {}, h('strong', { text: 'Skapa hushåll' }), h('span', { text: 'Du får en kod att dela med din sambo.' })),
        ),
        h('button', { type: 'button', class: 'choice', on: { click: showJoin } },
          h('span', { class: 'ico coral' }, icon('key')),
          h('span', {}, h('strong', { text: 'Gå med med kod' }), h('span', { text: 'Har du fått en kod? Skriv in den här.' })),
        ),
      ),
      h('p', { class: 'auth-switch' },
        h('span', { text: `Inloggad som ${state.user.email}.` }), ' ',
        h('button', { type: 'button', text: 'Logga ut', on: { click: () => sb.auth.signOut() } }),
      ),
    );
  }

  function formView({ title, label, placeholder, button, attrs, rpc, argName, transform }) {
    const input = h('input', { class: 'input', required: true, placeholder, attrs });
    const err = formError();
    const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: button });
    const form = h('form', { class: 'card', attrs: { novalidate: true }, on: { submit: async (e) => {
      e.preventDefault();
      showFormError(err, null);
      const value = transform(input.value);
      if (!value) return showFormError(err, rpc === 'join_household' ? 'Skriv in koden du fått, 8 tecken.' : 'Ge hushållet ett namn, t.ex. "Hemma".');
      await busy(submit, async () => {
        const { error } = await sb.rpc(rpc, { [argName]: value });
        if (error) return showFormError(err, error);
        try {
          await loadHousehold();
          onDone();
        } catch (e2) {
          showFormError(err, errorMessage(e2));
        }
      });
    } } },
      h('h2', { text: title, style: 'margin-bottom:14px' }),
      err,
      field(label, input),
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn', text: 'Tillbaka', on: { click: showChoices } }),
        submit,
      ),
    );
    clear(content).append(form);
    input.focus();
  }

  function showCreate() {
    formView({
      title: 'Skapa hushåll', label: 'Namn på hushållet', placeholder: 'T.ex. Hemma i Bandhagen', button: 'Skapa',
      attrs: { maxlength: '60', autocomplete: 'off' }, rpc: 'create_household', argName: 'hname', transform: (v) => v.trim(),
    });
  }
  function showJoin() {
    formView({
      title: 'Gå med i hushåll', label: 'Inbjudningskod', placeholder: 't.ex. a1b2c3d4', button: 'Gå med',
      attrs: { maxlength: '12', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' },
      rpc: 'join_household', argName: 'code', transform: (v) => v.trim().toLowerCase().replace(/\s+/g, ''),
    });
  }

  showChoices();
  clear(root).append(
    h('main', { class: 'auth' },
      h('div', { class: 'auth-inner' }, brand('Välkommen!'), content),
    ),
  );
}

/** Visas om config.js inte är ifylld eller innehåller en hemlig nyckel. */
export function renderConfigHelp(root, { secret }) {
  clear(root).append(
    h('main', { class: 'auth' },
      h('div', { class: 'auth-inner' },
        brand('Nästan igång'),
        h('div', { class: 'card' },
          secret
            ? [
                h('h2', { text: 'Fel sorts nyckel', style: 'margin-bottom:8px;color:var(--neg)' }),
                h('p', { class: 'muted', text: 'js/config.js innehåller en hemlig nyckel (service_role eller sb_secret_). Den får aldrig ligga i appen. Byt till den publika nyckeln (publishable eller anon) under Project Settings > API i Supabase, och byt ut den hemliga nyckeln där eftersom den kan ha läckt.' }),
              ]
            : [
                h('h2', { text: 'Koppla appen till Supabase', style: 'margin-bottom:8px' }),
                h('p', { class: 'muted', text: 'Öppna js/config.js och fyll i SUPABASE_URL och SUPABASE_KEY (den publika nyckeln) från Project Settings > API i Supabase. Ladda sedan om sidan.' }),
              ],
        ),
      ),
    ),
  );
}
