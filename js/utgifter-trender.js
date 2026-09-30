// Trender: rörliga utgifter per kategori över 6 eller 12 månader, med filter, sortering och
// förändring mot föregående månad. I personliga flikar även "Kvar" per månad.
import { h, kr, put } from './ui.js';
import { renderChart, trendBadge } from './utgifter-graf.js';
import { addMonths, monthRange, variableByCategory, categoryTrend, personTotals } from './utgifter-berakning.js';
import { colorMap } from './utgifter-kategorier.js';

/**
 * ctx: {
 *   data, categories (flikens kategorier), owner (null = gemensamt), pct, month,
 *   opts: { n, sortBy, filter: Set }, setOpts(patch), onSelectMonth(m, viaKeyboard),
 *   monthName, monthOnly, cards: { chart, left } (återanvända grafkort),
 *   ownerLabel ("din" eller "Angelicas")
 * }
 */
export function renderTrends(el, ctx) {
  const { data, categories, owner, pct, month, opts } = ctx;
  const months = monthRange(addMonths(month, -(opts.n - 1)), month);
  const colors = colorMap(categories);
  const byCat = variableByCategory(data, [addMonths(months[0], -1), ...months], { owner, pct });
  const known = new Set(categories.map((c) => c.id));
  // Filtret kan innehålla en borttagen kategori – ignorera den.
  const filter = new Set([...opts.filter].filter((id) => known.has(id)));
  const shown = filter.size ? categories.filter((c) => filter.has(c.id)) : categories;
  const prevName = ctx.monthOnly(addMonths(month, -1));

  // ---------- Reglage ----------
  const seg = (name, label, items, value, onPick) => h('div', { class: 'segmented compact', attrs: { role: 'radiogroup', 'aria-label': label } },
    items.map(([v, text]) => h('label', {},
      h('input', { type: 'radio', name, value: String(v), checked: v === value, dataset: { focusKey: `${name}=${v}` }, on: { change: () => onPick(v) } }),
      h('span', { text }),
    )));
  const uid = owner || 'gemensamt';
  const chip = (id, text, pressed, color) => h('button', {
    type: 'button', class: 'filter-chip', attrs: { 'aria-pressed': String(pressed) }, dataset: { focusKey: 'chip-' + (id || 'alla') },
    on: { click: () => {
      if (id === null) return ctx.setOpts({ filter: new Set() });
      const next = new Set(filter);
      if (next.has(id)) next.delete(id); else next.add(id);
      ctx.setOpts({ filter: next });
    } },
  }, color ? h('i', { class: 'dot', style: `background:${color}` }) : null, text);

  const controls = h('section', { class: 'card trend-controls', attrs: { 'aria-label': 'Visa' } },
    h('div', { class: 'trend-control-row' },
      seg('period-' + uid, 'Period', [[6, '6 mån'], [12, '12 mån']], opts.n, (n) => ctx.setOpts({ n })),
      seg('sort-' + uid, 'Sortera', [['amount', 'Belopp'], ['change', 'Förändring']], opts.sortBy, (sortBy) => ctx.setOpts({ sortBy })),
    ),
    h('div', { class: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Filtrera på kategori' } },
      chip(null, 'Alla', filter.size === 0),
      categories.map((c) => chip(c.id, c.name, filter.has(c.id), colors.get(c.id))),
    ),
  );

  // ---------- Graf ----------
  const monthTotal = (m) => shown.reduce((acc, c) => acc + (byCat.get(c.id)?.get(m) || 0), 0);
  // Förklaringen visar bara kategorier som har belopp under perioden.
  const series = shown
    .filter((c) => months.some((m) => byCat.get(c.id)?.get(m)))
    .map((c) => ({ key: c.id, label: c.name, color: colors.get(c.id) }));
  renderChart(ctx.cards.chart, {
    title: filter.size === 1 ? shown[0].name : 'Rörliga per kategori',
    months: months.map((m) => ({ month: m, values: Object.fromEntries(series.map((se) => [se.key, byCat.get(se.key)?.get(m) || 0])) })),
    series: series.length ? series : [{ key: 'none', label: 'Rörliga', color: 'var(--cat-other)' }],
    selected: month,
    onSelect: ctx.onSelectMonth,
    monthName: ctx.monthName,
    headRight: trendBadge(monthTotal(month), monthTotal(addMonths(month, -1))),
    emptyText: 'Inga rörliga utgifter under perioden' + (filter.size ? ' i de valda kategorierna.' : '.'),
    ariaLabel: 'Rörliga utgifter per kategori och månad. Tryck på en månad för att visa den.',
  });

  // ---------- Lista per kategori ----------
  const rows = categoryTrend(byCat, shown, [addMonths(month, -1), month], opts.sortBy);
  const list = h('section', { class: 'card trend-list', attrs: { 'aria-label': 'Förändring per kategori' } },
    h('div', { class: 'card-title' },
      h('h2', { text: ctx.monthName(month) }),
      h('span', { class: 'muted small', text: 'mot ' + prevName }),
    ),
    rows.length
      ? h('ul', { class: 'trend-rows' }, rows.map((r) => h('li', { class: 'trend-row' },
        h('span', { class: 'trend-name' }, h('i', { class: 'dot', style: `background:${colors.get(r.category.id)}` }), r.category.name),
        h('span', { class: 'num trend-now', text: kr(r.now) }),
        changeChip(r, prevName),
      )))
      : h('p', { class: 'muted small', text: `Inga rörliga utgifter i ${ctx.monthOnly(month)} eller ${prevName}.` }),
    owner ? h('p', { class: 'muted small trend-note', text: `Inklusive ${ctx.ownerLabel} andel (${pct} %) av de gemensamma rörliga utgifterna.` }) : null,
  );

  // ---------- Kvar per månad (personligt) ----------
  let left = null;
  if (owner) {
    const totals = months.map((m) => personTotals(data, owner, pct, m));
    const hasIncome = totals.some((t) => t.income);
    left = ctx.cards.left;
    if (hasIncome) {
      const cur = totals[totals.length - 1];
      const prev = personTotals(data, owner, pct, addMonths(month, -1));
      renderChart(left, {
        title: 'Kvar per månad',
        months: totals.map((t) => ({ month: t.month, values: { left: t.left } })),
        series: [{ key: 'left', label: 'Kvar', color: 'var(--pos)' }],
        signed: true,
        selected: month,
        onSelect: ctx.onSelectMonth,
        monthName: ctx.monthName,
        headRight: trendBadge(cur.left, prev.income ? prev.left : null, { invert: true }),
        ariaLabel: 'Kvar per månad efter inkomst, andel av gemensamt och egna utgifter.',
      });
    } else {
      put(left, h('div', { class: 'chart-head' }, h('h2', { text: 'Kvar per månad' })),
        h('p', { class: 'muted small empty-inline', text: 'Lägg till inkomst under Lista för att se hur mycket som blir över varje månad.' }));
    }
  }

  put(el, controls, ctx.cards.chart, list, left);
}

/** "▲ 450 kr · 12 %" – ökning i varningsfärg, minskning i grönt. */
function changeChip(r, prevName) {
  if (!r.diff) return h('span', { class: 'delta flat', text: '± 0' });
  const up = r.diff > 0;
  const amount = kr(Math.abs(r.diff));
  const pctText = r.pct == null ? 'ny' : `${Math.abs(r.pct)} %`;
  return h('span', {
    class: 'delta ' + (up ? 'up' : 'down'),
    attrs: { title: `${up ? 'Ökning' : 'Minskning'} med ${amount}${r.pct == null ? '' : ` (${Math.abs(r.pct)} %)`} jämfört med ${prevName}` },
  }, h('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' }, text: up ? '▲' : '▼' }), `${amount} · ${pctText}`);
}
