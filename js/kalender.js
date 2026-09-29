// Kalender: månadsvy med markerade dagar och en lista över vald dag.
import {
  h, icon, iconButton, put, add, fmt, capitalize, ymd, sameDay, startOfDay, addDays, weekdayMon,
  emptyState, errorBox,
} from './ui.js';
import { fetchEvents, occursOn, sortEvents, eventRow, eventSheet } from './events.js';

export const title = 'Kalender';

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const MAX_LABELS = 3;        // etiketter per dag på bred skärm
const MAX_LABELS_NARROW = 2; // på smal skärm (se .cal-ev:nth-child(3) i CSS)
const EV_COLORS = 5;

/** Stabil färg per händelse (samma händelse får alltid samma färg). */
function colorIndex(e) {
  let n = 0;
  for (const ch of e.id || e.title) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % EV_COLORS;
}

/** Kort etikett i dagrutan: färgad kant, ev. starttid och titel. */
function evLabel(e, day) {
  const start = new Date(e.starts_at);
  const showTime = !e.all_day && sameDay(start, day);
  return h('span', { class: `cal-ev c${colorIndex(e)}` + (e.all_day ? ' all-day' : '') },
    showTime ? h('span', { class: 't', text: fmt.time(start) }) : null,
    h('span', { class: 'x', text: e.title }),
  );
}

export function mount(root, { params }) {
  const fromParam = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? new Date(params[0] + 'T00:00') : null;
  let selected = startOfDay(fromParam || new Date());
  let month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  let events = [];
  let token = 0;
  let failed = null;

  const monthLabel = h('h2', { class: 'month-label', attrs: { 'aria-live': 'polite' } });
  const grid = h('div', { class: 'cal-grid', attrs: { role: 'grid', 'aria-label': 'Månadsvy' } });
  const dayHead = h('div', { class: 'section-head' });
  const dayList = h('div');

  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' }, h('h1', { text: 'Kalender' })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Idag', on: { click: () => select(new Date(), true) } }),
      iconButton('plus', 'Ny händelse', () => openNew(), 'accent'),
    ),
    h('div', { class: 'cal-layout' },
    h('section', { class: 'card cal' },
      h('div', { class: 'month-switch' },
        iconButton('left', 'Föregående månad', () => shiftMonth(-1)),
        monthLabel,
        iconButton('right', 'Nästa månad', () => shiftMonth(1)),
      ),
      h('div', { class: 'cal-weekdays', attrs: { 'aria-hidden': 'true' } }, WEEKDAYS.map((d) => h('span', { text: d }))),
      grid,
    ),
    h('aside', { class: 'cal-side', attrs: { 'aria-label': 'Vald dag' } }, dayHead, dayList),
    ),
  );
  // Kalendern får använda mer av bredden på stora skärmar.
  root.classList.add('view-wide');

  // Rutnätet börjar på måndagen i veckan där månaden börjar och visar 6 veckor.
  const gridStart = () => addDays(month, -weekdayMon(month));
  const gridEnd = () => addDays(gridStart(), 42);

  function shiftMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    // Behåll samma dag i månaden om det går
    const day = Math.min(selected.getDate(), new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
    selected = new Date(month.getFullYear(), month.getMonth(), day);
    load();
  }

  function select(d, focus) {
    const nd = startOfDay(d);
    const monthChanged = nd.getMonth() !== month.getMonth() || nd.getFullYear() !== month.getFullYear();
    selected = nd;
    if (monthChanged) {
      month = new Date(nd.getFullYear(), nd.getMonth(), 1);
      load().then(() => focus && focusSelected());
    } else {
      renderGrid();
      renderDay();
      if (focus) focusSelected();
    }
    history.replaceState(null, '', '#kalender/' + ymd(selected));
  }

  function focusSelected() {
    grid.querySelector('[aria-selected="true"]')?.focus();
  }

  async function load() {
    const t = ++token;
    monthLabel.textContent = capitalize(fmt.monthYear(month));
    renderGrid();
    try {
      const data = await fetchEvents(gridStart(), gridEnd());
      if (t !== token) return;
      events = data;
      failed = null;
    } catch (err) {
      if (t !== token) return;
      failed = err;
    }
    renderGrid();
    renderDay();
  }

  function renderGrid() {
    const today = new Date();
    const start = gridStart();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const dayEvents = sortEvents(events.filter((e) => occursOn(e, d)));
      const count = dayEvents.length;
      const inMonth = d.getMonth() === month.getMonth();
      const isSel = sameDay(d, selected);
      const label = capitalize(fmt.full(d)) + (count
        ? `, ${count} ${count === 1 ? 'händelse' : 'händelser'}: ${dayEvents.map((e) => e.title).join(', ')}`
        : '');
      cells.push(h('button', {
        type: 'button',
        class: 'cal-day' + (inMonth ? '' : ' other') + (sameDay(d, today) ? ' today' : '') + (count ? ' has' : ''),
        tabIndex: isSel ? 0 : -1,
        attrs: { role: 'gridcell', 'aria-selected': String(isSel), 'aria-label': label },
        dataset: { date: ymd(d) },
        on: { click: () => select(d), keydown: onKey },
      },
        h('span', { class: 'n', text: String(d.getDate()) }),
        count ? h('span', { class: 'cal-evs', attrs: { 'aria-hidden': 'true' } },
          dayEvents.slice(0, MAX_LABELS).map((e) => evLabel(e, d)),
          // Två varianter av "+N till": smal skärm visar färre etiketter (styrs i CSS).
          count > MAX_LABELS ? h('span', { class: 'cal-more wide', text: `+${count - MAX_LABELS} till` }) : null,
          count > MAX_LABELS_NARROW ? h('span', { class: 'cal-more narrow', text: `+${count - MAX_LABELS_NARROW}` }) : null,
        ) : null,
      ));
    }
    put(grid, cells);
  }

  function onKey(e) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key] != null) {
      e.preventDefault();
      select(addDays(selected, moves[e.key]), true);
    } else if (e.key === 'Enter' && e.target.dataset.date) {
      e.preventDefault();
      openNew();
    }
  }

  function renderDay() {
    const list = sortEvents(events.filter((e) => occursOn(e, selected)));
    put(dayHead,
      h('div', {},
        h('h2', { text: capitalize(fmt.full(selected)) }),
        sameDay(selected, new Date()) ? h('div', { class: 'muted small', text: 'Idag' }) : null,
      ),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => openNew() } }, icon('plus'), 'Ny'),
    );
    if (failed) return put(dayList, errorBox(failed, () => load()));
    if (!list.length) {
      return put(dayList, emptyState({
        iconName: 'calendar',
        title: 'Inget planerat',
        text: 'Lägg till din första händelse för dagen, t.ex. en middag eller en tid hos tandläkaren.',
        action: h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => openNew() } }, icon('plus'), 'Ny händelse'),
      }));
    }
    put(dayList, h('ul', { class: 'rows' }, list.map((e) => eventRow(e, selected, (ev) => eventSheet(ev, { onSaved: afterSave })))));
  }

  function openNew() {
    eventSheet(null, { date: selected, onSaved: afterSave });
  }

  function afterSave(saved) {
    if (saved) {
      // Hoppa till dagen där händelsen hamnade.
      selected = startOfDay(new Date(saved.starts_at));
      month = new Date(selected.getFullYear(), selected.getMonth(), 1);
      history.replaceState(null, '', '#kalender/' + ymd(selected));
    }
    load();
  }

  load();

  return { tables: ['events'], refresh: () => load(), handlesTyping: true };
}
