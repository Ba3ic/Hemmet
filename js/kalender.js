// Kalender: månadsvy med markerade dagar och en lista över vald dag.
import {
  h, icon, iconButton, put, add, fmt, capitalize, ymd, sameDay, startOfDay, addDays, weekdayMon,
  emptyState, errorBox,
} from './ui.js';
import { fetchEvents, occursOn, sortEvents, eventRow, eventSheet } from './events.js';

export const title = 'Kalender';

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

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
    h('section', { class: 'card cal' },
      h('div', { class: 'month-switch' },
        iconButton('left', 'Föregående månad', () => shiftMonth(-1)),
        monthLabel,
        iconButton('right', 'Nästa månad', () => shiftMonth(1)),
      ),
      h('div', { class: 'cal-weekdays', attrs: { 'aria-hidden': 'true' } }, WEEKDAYS.map((d) => h('span', { text: d }))),
      grid,
    ),
    dayHead,
    dayList,
  );

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
      const count = events.filter((e) => occursOn(e, d)).length;
      const inMonth = d.getMonth() === month.getMonth();
      const isSel = sameDay(d, selected);
      const label = capitalize(fmt.full(d)) + (count ? `, ${count} ${count === 1 ? 'händelse' : 'händelser'}` : '');
      cells.push(h('button', {
        type: 'button',
        class: 'cal-day' + (inMonth ? '' : ' other') + (sameDay(d, today) ? ' today' : '') + (count ? ' has' : ''),
        tabIndex: isSel ? 0 : -1,
        attrs: { role: 'gridcell', 'aria-selected': String(isSel), 'aria-label': label },
        dataset: { date: ymd(d) },
        on: { click: () => select(d), keydown: onKey },
      },
        h('span', { class: 'n', text: String(d.getDate()) }),
        h('span', { class: 'dots', attrs: { 'aria-hidden': 'true' } }, Array.from({ length: Math.min(count, 3) }, () => h('i'))),
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
