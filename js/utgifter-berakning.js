// Utgifter: beräkningar utan DOM, så att de kan testas med Node (se tests/utgifter.test.mjs).
//
// data = { fixed, variable, incomes }
//   fixed:    fasta utgifter (alla versioner), { owner, amount, start_month, end_month, category_id }
//   variable: rörliga utgifter, { owner, amount, month, category_id }
//   incomes:  personliga inkomster, { owner, amount, month, recurring, end_month, replaces_id }
// owner null = gemensam. Personens andel av gemensamt räknas fram här och sparas aldrig.

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' + n månader */
export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Månaderna from … to, båda inklusive. */
export function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Gäller den fasta utgiften (eller återkommande inkomsten) månaden m? */
export const activeIn = (r, m, startKey = 'start_month') => r[startKey] <= m && (!r.end_month || r.end_month >= m);
export const sum = (rows, key = 'amount') => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
export const round2 = (n) => Math.round(n * 100) / 100;
const sameOwner = (r, owner) => (r.owner ?? null) === (owner ?? null);

export const fixedIn = (data, m, owner = null) => data.fixed.filter((r) => sameOwner(r, owner) && activeIn(r, m));
export const variableIn = (data, m, owner = null) => data.variable.filter((r) => sameOwner(r, owner) && r.month === m);

/** Personens andel i procent (split_percent, standard 50). */
export const splitOf = (member) => {
  const p = Number(member?.split_percent);
  return Number.isFinite(p) ? p : 50;
};
export const shareOf = (amount, pct) => round2((Number(amount) || 0) * pct / 100);

/** Andelsrader: en per gemensam utgift, med beloppet * pct / 100. */
export function shareRows(data, m, pct) {
  const mk = (r, kind) => ({ source: r, kind, category_id: r.category_id, name: r.name, amount: shareOf(r.amount, pct) });
  return [
    ...fixedIn(data, m).map((r) => mk(r, 'fixed')),
    ...variableIn(data, m).map((r) => mk(r, 'variable')),
  ];
}

/**
 * Inkomstrader för personen månaden m.
 * Återkommande rader som gäller m tas med; finns en justering för m ersätter den beloppet.
 * Returnerar [{ row, adjustment, amount }] där row är grundraden (återkommande eller engångs).
 */
export function incomeRows(data, owner, m) {
  const mine = data.incomes.filter((r) => r.owner === owner);
  const adjustments = new Map(mine.filter((r) => r.replaces_id && r.month === m).map((r) => [r.replaces_id, r]));
  const out = [];
  for (const r of mine) {
    if (r.replaces_id) continue;
    if (r.recurring ? !activeIn(r, m, 'month') : r.month !== m) continue;
    const adj = r.recurring ? adjustments.get(r.id) || null : null;
    out.push({ row: r, adjustment: adj, amount: Number((adj || r).amount) || 0 });
  }
  return out;
}

/** Gemensamma summor för månaden. */
export function sharedTotals(data, m) {
  const fixed = sum(fixedIn(data, m));
  const variable = sum(variableIn(data, m));
  return { month: m, fixed, variable, total: fixed + variable };
}

/** Personens summor för månaden: inkomst − andel av gemensamt − egna utgifter = kvar. */
export function personTotals(data, owner, pct, m) {
  const shared = sharedTotals(data, m);
  const shareFixed = shareOf(shared.fixed, pct);
  const shareVariable = shareOf(shared.variable, pct);
  const share = round2(shareFixed + shareVariable);
  const ownFixed = sum(fixedIn(data, m, owner));
  const ownVariable = sum(variableIn(data, m, owner));
  const own = round2(ownFixed + ownVariable);
  const income = round2(sum(incomeRows(data, owner, m)));
  const total = round2(share + own);
  return { month: m, income, share, shareFixed, shareVariable, ownFixed, ownVariable, own, total, left: round2(income - total) };
}

/**
 * Rörliga utgifter per kategori och månad.
 * owner null → bara gemensamma. owner satt → egna + pct % av gemensamma.
 * Returnerar Map(category_id → Map(month → belopp)).
 */
export function variableByCategory(data, months, { owner = null, pct = 100 } = {}) {
  const set = new Set(months);
  const out = new Map();
  const addTo = (cat, m, v) => {
    if (!out.has(cat)) out.set(cat, new Map());
    const row = out.get(cat);
    row.set(m, round2((row.get(m) || 0) + v));
  };
  for (const r of data.variable) {
    if (!set.has(r.month)) continue;
    const shared = (r.owner ?? null) === null;
    if (owner === null && !shared) continue;
    if (owner !== null && !shared && r.owner !== owner) continue;
    const v = Number(r.amount) || 0;
    addTo(r.category_id, r.month, owner !== null && shared ? shareOf(v, pct) : v);
  }
  return out;
}

/** Förändring mellan två belopp: { diff, pct } där pct är null om föregående är 0. */
export function change(now, before) {
  const diff = round2(now - before);
  const pct = before ? Math.round((diff / before) * 100) : null;
  return { diff, pct };
}

/**
 * Trendrader per kategori för months (sista = vald månad).
 * categories: [{ id, name }]. Kategorier utan belopp i hela perioden hoppas över.
 * sortBy: 'amount' (vald månad, störst först) eller 'change' (störst förändring i kr, oavsett riktning).
 */
export function categoryTrend(byCat, categories, months, sortBy = 'amount') {
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const rows = [];
  for (const c of categories) {
    const perMonth = byCat.get(c.id);
    if (!perMonth) continue;
    const values = months.map((m) => perMonth.get(m) || 0);
    if (!values.some(Boolean)) continue;
    const now = perMonth.get(cur) || 0;
    const before = prev ? perMonth.get(prev) || 0 : 0;
    rows.push({ category: c, values, now, before, ...change(now, before) });
  }
  const cmp = sortBy === 'change'
    ? (a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.now - a.now
    : (a, b) => b.now - a.now || Math.abs(b.diff) - Math.abs(a.diff);
  return rows.sort((a, b) => cmp(a, b) || a.category.name.localeCompare(b.category.name, 'sv'));
}
