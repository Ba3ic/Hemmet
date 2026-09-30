// Kategorier för utgifter: vilka som gäller i en flik, färger, välja kategori och hantera
// (skapa, döp om, ta bort). Gemensamma kategorier har owner null, personliga har personens id.
// När en kategori tas bort flyttar databasen dess utgifter till Övrigt (se migrations/002).
import { sb } from './supabase.js';
import { h, icon, iconButton, sheet, confirmSheet, toast, toastError, put } from './ui.js';

const COLORS = 8; // --cat1 … --cat8 i app.css; fler kategorier än så får en neutral färg

/** Kategorier som gäller för owner (null = gemensamt): gemensamma + personens egna. Övrigt sist. */
export function categoriesFor(all, owner) {
  return all
    .filter((c) => c.owner == null || (owner && c.owner === owner))
    .sort((a, b) => (a.is_fallback - b.is_fallback) || (a.owner == null ? 0 : 1) - (b.owner == null ? 0 : 1)
      || String(a.created_at).localeCompare(String(b.created_at)) || a.name.localeCompare(b.name, 'sv'));
}

/**
 * Färg per kategori, fast efter kategorins plats i listan (inte efter belopp), så att en
 * kategori behåller sin färg när man filtrerar. Övrigt är alltid neutral.
 */
export function colorMap(list) {
  const map = new Map();
  let i = 0;
  for (const c of list) {
    if (c.is_fallback) map.set(c.id, 'var(--cat-other)');
    else map.set(c.id, i < COLORS ? `var(--cat${++i})` : 'var(--cat-other)');
  }
  return map;
}

export const fallbackOf = (all) => all.find((c) => c.is_fallback);

/** Välj kategori i ett blad. Returnerar Promise<id | null>. */
export function pickCategory({ categories, current, title = 'Välj kategori', onManage }) {
  return new Promise((resolve) => {
    let picked = null;
    const colors = colorMap(categories);
    const s = sheet({
      title,
      onClose: () => resolve(picked),
      content: [
        h('ul', { class: 'rows cat-pick', attrs: { role: 'list' } }, categories.map((c) => h('li', {},
          h('button', {
            type: 'button', class: 'cat-pick-btn', attrs: { 'aria-pressed': String(c.id === current) },
            on: { click: () => { picked = c.id; s.close(); } },
          },
            h('i', { class: 'dot', style: `background:${colors.get(c.id)}` }),
            h('span', { class: 'grow', text: c.name }),
            c.owner ? h('span', { class: 'muted small', text: 'egen' }) : null,
            c.id === current ? icon('check') : null,
          ),
        ))),
        onManage ? h('button', { type: 'button', class: 'btn btn-sm cat-manage-link', on: { click: () => { s.close(); onManage(); } } }, icon('tag'), 'Hantera kategorier') : null,
      ],
    });
  });
}

/**
 * Blad för att skapa, döpa om och ta bort kategorier.
 * all: alla hushållets kategorier. me: inloggad användare. onChange(): ladda om vyn.
 */
export function manageCategories({ all, me, hid, onChange }) {
  const body = h('div');
  let list = [...all];
  let changed = false;

  function render() {
    const shared = categoriesFor(list, null);
    const mine = list.filter((c) => c.owner === me).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    put(body,
      h('p', { class: 'muted small', style: 'margin-bottom:12px', text: 'Tar du bort en kategori flyttas dess utgifter till Övrigt. Inget raderas.' }),
      group('Gemensamma', 'Syns i alla flikar', shared, null),
      group('Mina egna', 'Bara för dina egna utgifter', mine, me),
    );
  }

  function group(heading, sub, cats, owner) {
    const nameIn = h('input', { class: 'input', placeholder: 'Ny kategori', attrs: { 'aria-label': `Ny kategori (${heading.toLowerCase()})`, maxlength: '40', autocomplete: 'off' } });
    const addBtn = h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till kategori', title: 'Lägg till' } }, icon('plus'));
    return h('section', { class: 'cat-group', attrs: { 'aria-label': heading } },
      h('div', { class: 'section-head' }, h('div', {}, h('h2', { text: heading }), h('div', { class: 'muted small', text: sub }))),
      cats.length ? h('ul', { class: 'rows expense-rows' }, cats.map(row)) : h('p', { class: 'muted small empty-inline', text: 'Inga egna kategorier än.' }),
      h('form', { class: 'add-expense', on: { submit: async (e) => {
        e.preventDefault();
        const name = nameIn.value.trim();
        if (!name) { nameIn.focus(); return; }
        if (list.some((c) => (c.owner ?? null) === owner && c.name.toLowerCase() === name.toLowerCase())) {
          toast(`Det finns redan en kategori som heter ${name}.`, { error: true });
          return;
        }
        addBtn.disabled = true;
        const res = await sb.from('categories').insert({ household_id: hid, owner, name }).select().single();
        addBtn.disabled = false;
        if (res.error) return toastError(res.error);
        list.push(res.data);
        changed = true;
        render();
        body.querySelector(`form input[aria-label="${nameIn.getAttribute('aria-label')}"]`)?.focus();
      } } }, nameIn, addBtn),
    );
  }

  function row(c) {
    if (c.is_fallback) {
      return h('li', { class: 'expense' },
        h('div', { class: 'name-cell' }, h('span', { class: 'cat-fixed-name', text: c.name }), h('span', { class: 'since muted', text: 'kan inte tas bort' })),
      );
    }
    const input = h('input', {
      class: 'input bare', value: c.name, attrs: { 'aria-label': `Namn på kategorin ${c.name}`, maxlength: '40', autocomplete: 'off' },
      on: {
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        change: async (e) => {
          const name = e.target.value.trim();
          if (!name || name === c.name) { e.target.value = c.name; return; }
          const { error } = await sb.from('categories').update({ name }).eq('id', c.id);
          if (error) { e.target.value = c.name; return toastError(error); }
          c.name = name;
          changed = true;
        },
      },
    });
    return h('li', { class: 'expense' },
      h('div', { class: 'name-cell' }, input),
      iconButton('trash', `Ta bort ${c.name}`, async () => {
        const ok = await confirmSheet({ title: `Ta bort ${c.name}?`, message: 'Utgifter i kategorin flyttas till Övrigt.' });
        if (!ok) return;
        const { error } = await sb.from('categories').delete().eq('id', c.id);
        if (error) return toastError(error);
        list = list.filter((x) => x.id !== c.id);
        changed = true;
        render();
        toast(`${c.name} är borttagen. Utgifterna ligger nu under Övrigt.`);
      }),
    );
  }

  render();
  sheet({ title: 'Kategorier', content: body, onClose: () => { if (changed) onChange?.(); } });
}
