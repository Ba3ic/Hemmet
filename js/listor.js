// Listor: översikt över hushållets listor och poster med beskrivning, länk och bild.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, iconButton, clear, field, formError, showFormError, busy, sheet, confirmSheet,
  emptyState, errorBox, skeleton, toast, toastError, safeUrl, prettyHost, put, add,
} from './ui.js';
import { resizeImage, uploadImage, removeImages, signedUrls, lightbox } from './images.js';

export const title = 'Listor';

const SUGGESTIONS = ['Köplista', 'Hushållslista'];

export function mount(root, ctx) {
  return ctx.params[0] ? mountList(root, ctx, ctx.params[0]) : mountOverview(root, ctx);
}

// =====================================================================
// Översikt
// =====================================================================

function mountOverview(root, { navigate }) {
  const hid = state.household.id;
  const content = h('div');
  let lists = [];
  let token = 0;

  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' }, h('h1', { text: 'Listor' })),
      iconButton('plus', 'Ny lista', () => editListSheet(), 'accent'),
    ),
    content,
  );

  async function load(showSkeleton) {
    const t = ++token;
    if (showSkeleton) put(content, skeleton(3));
    const [ls, items] = await Promise.all([
      sb.from('lists').select('*').eq('household_id', hid).order('created_at'),
      sb.from('list_items').select('list_id, done').eq('household_id', hid),
    ]);
    if (t !== token) return;
    const err = ls.error || items.error;
    if (err) return put(content, errorBox(err, () => load(true)));
    const counts = {};
    for (const it of items.data) {
      const c = counts[it.list_id] ||= { open: 0, total: 0 };
      c.total++;
      if (!it.done) c.open++;
    }
    lists = ls.data.map((l) => ({ ...l, ...(counts[l.id] || { open: 0, total: 0 }) }));
    render();
  }

  function render() {
    if (!lists.length) {
      put(content, 
        emptyState({
          iconName: 'list',
          title: 'Skapa din första lista',
          text: 'T.ex. en köplista för veckohandlingen eller en hushållslista för saker som ska fixas hemma.',
          action: h('div', { class: 'chips', style: 'justify-content:center' },
            SUGGESTIONS.map((name) => h('button', { type: 'button', class: 'chip', text: '+ ' + name, on: { click: () => createList(name) } })),
            h('button', { type: 'button', class: 'chip', text: '+ Egen lista', on: { click: () => editListSheet() } }),
          ),
        }),
      );
      return;
    }
    put(content, 
      h('ul', { class: 'rows' }, lists.map((l) => h('li', {},
        h('a', { class: 'row', href: '#listor/' + l.id },
          h('span', { class: 'list-ico' }, icon(/köp|handla|mat/i.test(l.name) ? 'cart' : 'list')),
          h('div', { class: 'grow' },
            h('div', { class: 'title', text: l.name }),
            h('div', { class: 'meta', text: countText(l) }),
          ),
          icon('chevron', 'chev'),
        ),
      ))),
    );
  }

  async function createList(name) {
    const { data, error } = await sb.from('lists').insert({ household_id: hid, name }).select().single();
    if (error) return toastError(error);
    navigate('#listor/' + data.id);
  }

  function editListSheet() {
    const input = h('input', { class: 'input', required: true, placeholder: 'T.ex. Köplista', attrs: { maxlength: '60', autocomplete: 'off' } });
    const err = formError();
    const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Skapa' });
    const s = sheet({
      title: 'Ny lista',
      content: h('form', { on: { submit: async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return showFormError(err, 'Ge listan ett namn.');
        await busy(save, async () => {
          const { data, error } = await sb.from('lists').insert({ household_id: hid, name }).select().single();
          if (error) return showFormError(err, error);
          s.close();
          navigate('#listor/' + data.id);
        });
      } } },
        err,
        h('div', { class: 'chips' }, SUGGESTIONS.map((n) => h('button', { type: 'button', class: 'chip', text: n, on: { click: () => { input.value = n; input.focus(); } } }))),
        field('Namn', input),
        h('div', { class: 'sheet-actions' },
          h('button', { type: 'button', class: 'btn', text: 'Avbryt', on: { click: () => s.close() } }),
          save,
        ),
      ),
    });
  }

  load(true);
  return { tables: ['lists', 'list_items'], refresh: () => load(false) };
}

function countText(l) {
  if (!l.total) return 'Tom';
  if (!l.open) return `Allt klart · ${l.total} ${l.total === 1 ? 'post' : 'poster'}`;
  return `${l.open} kvar av ${l.total}`;
}

// =====================================================================
// En lista
// =====================================================================

function mountList(root, { navigate }, listId) {
  const hid = state.household.id;
  let list = null;
  let items = [];
  let urls = {};
  let token = 0;

  const heading = h('h1');
  const content = h('div');
  const quickName = h('input', { class: 'input', placeholder: 'Lägg till…', attrs: { 'aria-label': 'Ny post', autocomplete: 'off', maxlength: '120', enterkeyhint: 'done' } });
  const quick = h('form', { class: 'quick-add', on: { submit: quickAdd } },
    quickName,
    iconButton('image', 'Ny post med detaljer och bild', () => itemSheet(null, quickName.value.trim())),
    h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till post', title: 'Lägg till' } }, icon('plus')),
  );

  add(root,
    h('header', { class: 'topbar' },
      iconButton('back', 'Tillbaka till listor', () => navigate('#listor')),
      h('div', { class: 'grow' }, heading),
      iconButton('edit', 'Byt namn eller ta bort listan', () => listSettings()),
    ),
    quick,
    content,
  );

  async function load(showSkeleton) {
    const t = ++token;
    if (showSkeleton) put(content, skeleton(4));
    const [l, it] = await Promise.all([
      sb.from('lists').select('*').eq('id', listId).maybeSingle(),
      sb.from('list_items').select('*').eq('list_id', listId).order('created_at'),
    ]);
    if (t !== token) return;
    const err = l.error || it.error;
    if (err) return put(content, errorBox(err, () => load(true)));
    if (!l.data) {
      // Listan har tagits bort (kanske av den andra personen).
      toast('Listan finns inte längre.');
      return navigate('#listor');
    }
    list = l.data;
    items = it.data;
    heading.textContent = list.name;
    document.title = list.name + ' · Hemmet';
    render();
    // Hämta bildlänkar efteråt, så att listan syns direkt.
    const paths = items.map((x) => x.image_path).filter(Boolean);
    if (paths.length) {
      urls = await signedUrls(paths);
      if (t === token) render();
    }
  }

  function render() {
    const open = items.filter((x) => !x.done);
    const done = items.filter((x) => x.done);
    if (!items.length) {
      put(content, emptyState({
        iconName: 'list',
        title: 'Listan är tom',
        text: 'Skriv i fältet ovan för att lägga till din första post. Tryck på bildikonen för att lägga till beskrivning, länk eller skärmdump.',
      }));
      return;
    }
    put(content, 
      open.length
        ? h('ul', { class: 'rows items' }, open.map(itemRow))
        : h('p', { class: 'all-done' }, icon('check'), 'Allt är avbockat!'),
      done.length ? h('div', { class: 'section-head' },
        h('h2', { class: 'section-label', style: 'margin:0', text: `Klara (${done.length})` }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: clearDone } }, icon('broom'), 'Rensa klara'),
      ) : null,
      done.length ? h('ul', { class: 'rows items done' }, done.map(itemRow)) : null,
    );
  }

  function itemRow(it) {
    const link = safeUrl(it.link);
    const thumbUrl = it.image_path ? urls[it.image_path] : null;
    return h('li', { class: 'item' + (it.done ? ' is-done' : '') },
      h('button', {
        type: 'button', class: 'check-btn',
        attrs: { 'aria-pressed': String(it.done), 'aria-label': (it.done ? 'Avmarkera ' : 'Bocka av ') + it.name },
        on: { click: () => toggle(it) },
      }, h('span', { class: 'box' }, icon('check'))),
      h('button', { type: 'button', class: 'item-main', attrs: { 'aria-label': 'Redigera ' + it.name }, on: { click: () => itemSheet(it) } },
        h('span', { class: 'title', text: it.name }),
        it.description ? h('span', { class: 'desc', text: it.description }) : null,
      ),
      link ? h('a', { class: 'item-link', href: link, target: '_blank', rel: 'noopener noreferrer', attrs: { title: link } },
        icon('link'), h('span', { text: prettyHost(link) })) : null,
      it.image_path ? h('button', {
        type: 'button', class: 'thumb', attrs: { 'aria-label': 'Visa bild för ' + it.name },
        on: { click: () => thumbUrl ? lightbox(thumbUrl, it.name) : toast('Bilden laddas fortfarande – försök igen om en stund.') },
      }, thumbUrl ? h('img', { src: thumbUrl, alt: '', loading: 'lazy' }) : icon('image')) : null,
    );
  }

  async function toggle(it) {
    it.done = !it.done;
    render();
    const { error } = await sb.from('list_items').update({ done: it.done }).eq('id', it.id);
    if (error) { it.done = !it.done; render(); toastError(error); }
  }

  async function quickAdd(e) {
    e.preventDefault();
    const name = quickName.value.trim();
    if (!name) { quickName.focus(); return; }
    quickName.value = '';
    const { data, error } = await sb.from('list_items').insert({ list_id: listId, household_id: hid, name }).select().single();
    if (error) { quickName.value = name; return toastError(error); }
    items.push(data);
    render();
    quickName.focus();
  }

  async function clearDone() {
    const done = items.filter((x) => x.done);
    const ok = await confirmSheet({ title: 'Rensa klara poster?', message: `${done.length} avbockade ${done.length === 1 ? 'post tas' : 'poster tas'} bort för gott.`, confirm: 'Rensa' });
    if (!ok) return;
    const { error } = await sb.from('list_items').delete().eq('list_id', listId).eq('done', true);
    if (error) return toastError(error);
    await removeImages(done.map((x) => x.image_path));
    items = items.filter((x) => !x.done);
    render();
  }

  // ---------- Blad: ny/redigera post ----------

  function itemSheet(it, presetName = '') {
    const isNew = !it;
    const name = h('input', { class: 'input', required: true, value: it?.name || presetName, attrs: { maxlength: '120', autocomplete: 'off' } });
    const desc = h('textarea', { class: 'textarea', value: it?.description || '', attrs: { rows: '3', placeholder: 'Storlek, färg, antal …' } });
    const link = h('input', { class: 'input', type: 'url', value: it?.link || '', placeholder: 'https://…', attrs: { inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' } });
    const err = formError();

    // Bildhantering
    let newBlob = null;
    let removeExisting = false;
    const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', attrs: { tabindex: '-1', 'aria-hidden': 'true' }, on: { change: onFile } });
    const preview = h('div', { class: 'image-preview' });
    function renderPreview() {
      clear(preview);
      let src = null;
      if (newBlob) src = URL.createObjectURL(newBlob);
      else if (it?.image_path && !removeExisting) src = urls[it.image_path];
      if (src || (it?.image_path && !removeExisting)) {
        add(preview, 
          src ? h('img', { src, alt: 'Vald bild' }) : h('div', { class: 'thumb' }, icon('image')),
          h('div', { class: 'image-actions' },
            h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => fileInput.click() } }, icon('image'), 'Byt bild'),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', on: { click: () => { newBlob = null; removeExisting = true; renderPreview(); } } }, icon('trash'), 'Ta bort bild'),
          ),
        );
      } else {
        add(preview, h('button', { type: 'button', class: 'btn btn-block image-pick', on: { click: () => fileInput.click() } }, icon('image'), 'Välj eller ta en bild'));
      }
    }
    async function onFile() {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      showFormError(err, null);
      try {
        newBlob = await resizeImage(file);
        renderPreview();
      } catch (e2) {
        showFormError(err, e2.message);
      }
    }
    renderPreview();

    const save = h('button', { type: 'submit', class: 'btn btn-primary', text: isNew ? 'Lägg till' : 'Spara' });

    const s = sheet({
      title: isNew ? 'Ny post' : 'Redigera post',
      content: h('form', { attrs: { novalidate: true }, on: { submit: async (e) => {
        e.preventDefault();
        showFormError(err, null);
        const n = name.value.trim();
        if (!n) return showFormError(err, 'Posten behöver ett namn.');
        const rawLink = link.value.trim();
        const cleanLink = rawLink ? safeUrl(rawLink) : null;
        if (rawLink && !cleanLink) return showFormError(err, 'Länken ser inte giltig ut. Den ska börja med http:// eller https://, t.ex. https://exempel.se.');

        await busy(save, async () => {
          let imagePath = it?.image_path || null;
          const oldPath = imagePath;
          try {
            if (newBlob) imagePath = await uploadImage(hid, newBlob);
            else if (removeExisting) imagePath = null;
          } catch (e3) {
            return showFormError(err, e3);
          }
          const row = { name: n, description: desc.value.trim() || null, link: cleanLink, image_path: imagePath };
          const res = isNew
            ? await sb.from('list_items').insert({ ...row, list_id: listId, household_id: hid }).select().single()
            : await sb.from('list_items').update(row).eq('id', it.id).select().single();
          if (res.error) {
            if (newBlob && imagePath) removeImages([imagePath]); // städa upp den uppladdade bilden
            return showFormError(err, res.error);
          }
          if (oldPath && oldPath !== imagePath) removeImages([oldPath]);
          if (isNew) items.push(res.data);
          else Object.assign(it, res.data);
          if (imagePath) urls = { ...urls, ...(await signedUrls([imagePath])) };
          if (isNew) quickName.value = '';
          render();
          s.close();
        });
      } } },
        err,
        field('Namn', name),
        field('Beskrivning', desc),
        field('Länk', link),
        h('div', { class: 'field' }, h('span', { text: 'Bild eller skärmdump' }), preview, fileInput),
        h('div', { class: 'sheet-actions' },
          isNew
            ? h('button', { type: 'button', class: 'btn', text: 'Avbryt', on: { click: () => s.close() } })
            : h('button', { type: 'button', class: 'btn btn-danger', on: { click: async () => {
                const ok = await confirmSheet({ title: `Ta bort ${it.name}?` });
                if (!ok) return;
                const { error } = await sb.from('list_items').delete().eq('id', it.id);
                if (error) return showFormError(err, error);
                removeImages([it.image_path]);
                items = items.filter((x) => x !== it);
                render();
                s.close();
              } } }, icon('trash'), 'Ta bort'),
          save,
        ),
      ),
    });
  }

  // ---------- Blad: byt namn / ta bort lista ----------

  function listSettings() {
    if (!list) return;
    const input = h('input', { class: 'input', required: true, value: list.name, attrs: { maxlength: '60', autocomplete: 'off' } });
    const err = formError();
    const save = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Spara' });
    const s = sheet({
      title: 'Listans inställningar',
      content: h('form', { on: { submit: async (e) => {
        e.preventDefault();
        const n = input.value.trim();
        if (!n) return showFormError(err, 'Listan behöver ett namn.');
        await busy(save, async () => {
          const { error } = await sb.from('lists').update({ name: n }).eq('id', listId);
          if (error) return showFormError(err, error);
          list.name = n;
          heading.textContent = n;
          s.close();
        });
      } } },
        err,
        field('Namn', input),
        h('div', { class: 'sheet-actions' },
          h('button', { type: 'button', class: 'btn btn-danger', on: { click: async () => {
            const ok = await confirmSheet({ title: `Ta bort ${list.name}?`, message: `Listan och alla ${items.length} poster tas bort för er båda.`, confirm: 'Ta bort listan' });
            if (!ok) return;
            const paths = items.map((x) => x.image_path);
            const { error } = await sb.from('lists').delete().eq('id', listId);
            if (error) return showFormError(err, error);
            removeImages(paths);
            s.close();
            navigate('#listor');
          } } }, icon('trash'), 'Ta bort'),
          save,
        ),
      ),
    });
  }

  load(true);
  // Snabbfältet ligger utanför listan som ritas om, så vi kan uppdatera även när man skriver.
  return { tables: ['lists', 'list_items'], refresh: () => load(false), handlesTyping: true };
}
