// Anteckningar: lista med sök (som Anteckningar på iPhone) och en redigeringsvy som autosparar.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, iconButton, put, add, fmt, debounce, confirmSheet, emptyState, errorBox, skeleton,
  toast, toastError,
} from './ui.js';

export const title = 'Anteckningar';

export function mount(root, ctx) {
  return ctx.params[0] ? mountEditor(root, ctx, ctx.params[0]) : mountList(root, ctx);
}

/** Visningsrubrik: titel, annars första raden i texten. */
function displayTitle(n) {
  return n.title.trim() || firstLine(n.body) || 'Ny anteckning';
}
function firstLine(text) {
  return (text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
}
function previewLine(n) {
  const lines = (n.body || '').split('\n').map((s) => s.trim()).filter(Boolean);
  // Om titeln saknas används första raden som rubrik – visa då nästa rad.
  return (n.title.trim() ? lines[0] : lines[1]) || 'Ingen ytterligare text';
}

// =====================================================================
// Lista
// =====================================================================

function mountList(root, { navigate }) {
  const hid = state.household.id;
  let notes = [];
  let token = 0;
  const content = h('div');
  const search = h('input', {
    class: 'input search-input', type: 'search', placeholder: 'Sök', attrs: { 'aria-label': 'Sök i anteckningar', autocomplete: 'off', enterkeyhint: 'search' },
    on: { input: () => render() },
  });

  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' }, h('h1', { text: 'Anteckningar' })),
      iconButton('edit', 'Ny anteckning', () => createNote(), 'accent'),
    ),
    h('div', { class: 'search' }, icon('search'), search),
    content,
  );

  async function load(showSkeleton) {
    const t = ++token;
    if (showSkeleton) put(content, skeleton(4));
    const { data, error } = await sb.from('notes').select('*').eq('household_id', hid).order('updated_at', { ascending: false });
    if (t !== token) return;
    if (error) return put(content, errorBox(error, () => load(true)));
    notes = data;
    render();
  }

  function render() {
    const q = search.value.trim().toLocaleLowerCase('sv');
    const list = q ? notes.filter((n) => (n.title + '\n' + n.body).toLocaleLowerCase('sv').includes(q)) : notes;
    if (!notes.length) {
      return put(content, emptyState({
        iconName: 'note',
        title: 'Skriv din första anteckning',
        text: 'Receptet ni vill komma ihåg, wifi-lösenordet till gästerna eller planer för semestern.',
        action: h('button', { type: 'button', class: 'btn btn-primary', on: { click: createNote } }, icon('edit'), 'Ny anteckning'),
      }));
    }
    if (!list.length) {
      return put(content, h('p', { class: 'muted', style: 'text-align:center;padding:24px 0', text: `Inga anteckningar matchar "${search.value.trim()}".` }));
    }
    put(content,
      h('p', { class: 'section-label', text: `${list.length} ${list.length === 1 ? 'anteckning' : 'anteckningar'}` }),
      h('ul', { class: 'rows notes-list' }, list.map((n) => h('li', {},
        h('a', { class: 'row', href: '#anteckningar/' + n.id },
          h('div', { class: 'grow' },
            h('div', { class: 'title ellipsis', text: displayTitle(n) }),
            h('div', { class: 'meta ellipsis' },
              h('span', { class: 'when', text: fmt.relativeUpdated(new Date(n.updated_at)) }),
              ' ',
              previewLine(n),
            ),
          ),
          icon('chevron', 'chev'),
        ),
      ))),
    );
  }

  async function createNote() {
    const { data, error } = await sb.from('notes')
      .insert({ household_id: hid, title: '', body: '', updated_at: new Date().toISOString(), updated_by: state.user.id })
      .select().single();
    if (error) return toastError(error);
    navigate('#anteckningar/' + data.id + '/ny');
  }

  load(true);
  // Sökfältet ligger utanför listan, så listan kan uppdateras även när man skriver i det.
  return { tables: ['notes'], refresh: () => load(false), handlesTyping: true };
}

// =====================================================================
// Redigering
// =====================================================================

function mountEditor(root, { navigate, params }, id) {
  const isFresh = params[1] === 'ny';
  let note = null;
  let dirty = false;      // osparade lokala ändringar
  let saving = null;      // pågående sparning (Promise)
  let lastSavedAt = null; // updated_at från vår senaste sparning
  let destroyed = false;

  const status = h('span', { class: 'save-status muted small', attrs: { 'aria-live': 'polite' } });
  const titleIn = h('input', {
    class: 'note-title', placeholder: 'Rubrik', attrs: { 'aria-label': 'Rubrik', autocomplete: 'off', maxlength: '200' },
    on: { input: onEdit, keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyIn.focus(); } } },
  });
  const bodyIn = h('textarea', {
    class: 'note-body', placeholder: 'Skriv något …', attrs: { 'aria-label': 'Text' },
    on: { input: () => { autosize(); onEdit(); } },
  });
  const meta = h('div', { class: 'note-meta muted small' });
  const editor = h('div', { class: 'note-editor', hidden: true }, meta, titleIn, bodyIn);
  const loading = h('div', {}, skeleton(2));

  add(root,
    h('header', { class: 'topbar' },
      iconButton('back', 'Tillbaka till anteckningar', () => navigate('#anteckningar')),
      h('div', { class: 'grow' }, status),
      iconButton('trash', 'Ta bort anteckningen', () => remove()),
    ),
    loading,
    editor,
  );

  const saveSoon = debounce(save, 700);

  function onEdit() {
    dirty = true;
    status.textContent = 'Sparar …';
    saveSoon();
  }

  function autosize() {
    bodyIn.style.height = 'auto';
    bodyIn.style.height = Math.max(bodyIn.scrollHeight, 240) + 'px';
  }

  function setMeta() {
    meta.textContent = note ? 'Ändrad ' + fmtWhen(new Date(note.updated_at)) : '';
  }

  async function load() {
    const { data, error } = await sb.from('notes').select('*').eq('id', id).maybeSingle();
    if (destroyed) return;
    if (error) { put(loading, errorBox(error, load)); return; }
    if (!data) {
      toast('Anteckningen finns inte längre.');
      return navigate('#anteckningar');
    }
    note = data;
    titleIn.value = note.title;
    bodyIn.value = note.body;
    loading.remove();
    editor.hidden = false;
    setMeta();
    autosize();
    if (isFresh) {
      history.replaceState(null, '', '#anteckningar/' + id);
      titleIn.focus();
    }
  }

  async function save() {
    if (!dirty || !note) return;
    if (saving) { await saving; if (!dirty) return; }
    dirty = false;
    const updated_at = new Date().toISOString();
    const row = { title: titleIn.value, body: bodyIn.value, updated_at, updated_by: state.user.id };
    // .then() gör frågan till ett vanligt Promise, så att den bara skickas en gång.
    saving = sb.from('notes').update(row).eq('id', id).then((r) => r);
    const { error } = await saving;
    saving = null;
    if (error) {
      dirty = true;
      if (!destroyed) status.textContent = 'Inte sparat – försöker igen när du skriver';
      toastError(error);
      return;
    }
    lastSavedAt = updated_at;
    Object.assign(note, row);
    if (!destroyed && !dirty) { status.textContent = 'Sparat'; setMeta(); }
  }

  // Ändring från den andra personen. Senaste ändringen vinner: har vi osparade ändringar
  // låter vi bli (vår sparning kommer efter), annars visar vi deras version.
  async function refresh() {
    if (!note || dirty || saving) return;
    const { data, error } = await sb.from('notes').select('*').eq('id', id).maybeSingle();
    if (destroyed || error) return;
    if (!data) {
      toast('Anteckningen togs bort av någon annan.');
      return navigate('#anteckningar');
    }
    if (dirty || saving || data.updated_at === lastSavedAt) return;
    if (new Date(data.updated_at) < new Date(note.updated_at)) return;
    note = data;
    replaceValue(titleIn, data.title);
    replaceValue(bodyIn, data.body);
    autosize();
    setMeta();
  }

  function replaceValue(el, value) {
    if (el.value === value) return;
    const focused = document.activeElement === el;
    const pos = focused ? el.selectionStart : 0;
    el.value = value;
    if (focused) el.setSelectionRange(Math.min(pos, value.length), Math.min(pos, value.length));
  }

  async function remove() {
    const ok = await confirmSheet({ title: 'Ta bort anteckningen?', message: 'Den tas bort för er båda och går inte att få tillbaka.' });
    if (!ok) return;
    saveSoon.cancel();
    dirty = false;
    const { error } = await sb.from('notes').delete().eq('id', id);
    if (error) return toastError(error);
    navigate('#anteckningar');
  }

  // Spara direkt om appen läggs i bakgrunden (t.ex. när man byter app på telefonen).
  const onHide = (e) => { if ((e.type === 'pagehide' || document.visibilityState === 'hidden') && dirty) saveSoon.flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  load();

  return {
    tables: ['notes'],
    handlesTyping: true,
    refresh,
    destroy() {
      destroyed = true;
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      saveSoon.cancel();
      if (!note) return;
      // Tom anteckning tas bort när man lämnar den, precis som på iPhone.
      if (!titleIn.value.trim() && !bodyIn.value.trim()) {
        sb.from('notes').delete().eq('id', id).then(({ error }) => error && console.warn(error));
        return;
      }
      if (dirty) save();
    },
  };
}

function fmtWhen(d) {
  const now = new Date();
  const time = fmt.time(d);
  if (d.toDateString() === now.toDateString()) return 'idag ' + time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'igår ' + time;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ' ' + time;
}
