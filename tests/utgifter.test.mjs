// Kör med: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, monthRange, personTotals, sharedTotals, shareRows, incomeRows, variableByCategory, categoryTrend, change,
} from '../js/utgifter-berakning.js';

const L = 'lucas-id';
const A = 'angelica-id';

function data() {
  return {
    fixed: [
      { id: 'hyra', owner: null, name: 'Hyra', amount: 12000, start_month: '2026-01', end_month: null, category_id: 'boende' },
      { id: 'el', owner: null, name: 'El', amount: 801, start_month: '2026-01', end_month: '2026-08', category_id: 'boende' },
      { id: 'gym', owner: L, name: 'Gym', amount: 400, start_month: '2026-03', end_month: null, category_id: 'noje' },
      { id: 'mobil', owner: A, name: 'Mobil', amount: 299, start_month: '2026-01', end_month: null, category_id: 'ovrigt' },
    ],
    variable: [
      { owner: null, amount: 4000, month: '2026-09', category_id: 'mat' },
      { owner: null, amount: 1000, month: '2026-08', category_id: 'mat' },
      { owner: null, amount: 600, month: '2026-09', category_id: 'utemat' },
      { owner: L, amount: 250, month: '2026-09', category_id: 'utemat' },
      { owner: A, amount: 900, month: '2026-09', category_id: 'utemat' },
    ],
    incomes: [
      { id: 'lon', owner: L, amount: 30000, month: '2026-01', recurring: true, end_month: null, replaces_id: null },
      { id: 'lon-sep', owner: L, amount: 33000, month: '2026-09', recurring: false, end_month: null, replaces_id: 'lon' },
      { id: 'bonus', owner: L, amount: 2000, month: '2026-09', recurring: false, end_month: null, replaces_id: null },
      { id: 'lon-a', owner: A, amount: 28000, month: '2026-05', recurring: true, end_month: '2026-08', replaces_id: null },
    ],
  };
}

test('månadshjälp', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('gemensam hyra 12 000 kr blir 6 000 kr i varje personlig flik', () => {
  const d = { fixed: [data().fixed[0]], variable: [], incomes: [] };
  for (const who of [L, A]) {
    const t = personTotals(d, who, 50, '2026-09');
    assert.equal(t.share, 6000);
    assert.equal(t.own, 0);
    assert.equal(t.total, 6000);
  }
  const rows = shareRows(d, '2026-09', 50);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Hyra');
  assert.equal(rows[0].amount, 6000);
});

test('andelen följer gemensamma ändringar och fasta utgifters giltighet', () => {
  const d = data();
  // Augusti: hyra 12000 + el 801 + mat 1000 = 13801 → 6900,5 var
  assert.equal(sharedTotals(d, '2026-08').total, 13801);
  assert.equal(personTotals(d, L, 50, '2026-08').share, 6900.5);
  // September: el har upphört. 12000 + 4000 + 600 = 16600 → 8300
  assert.equal(personTotals(d, L, 50, '2026-09').share, 8300);
  d.fixed[0].amount = 14000; // ändring i Gemensamt slår igenom direkt
  assert.equal(personTotals(d, A, 50, '2026-09').share, 9300);
});

test('split_percent styr fördelningen', () => {
  const d = { fixed: [data().fixed[0]], variable: [], incomes: [] };
  assert.equal(personTotals(d, L, 60, '2026-09').share, 7200);
  assert.equal(personTotals(d, A, 40, '2026-09').share, 4800);
});

test('egna utgifter syns bara hos ägaren', () => {
  const d = data();
  const l = personTotals(d, L, 50, '2026-09');
  const a = personTotals(d, A, 50, '2026-09');
  assert.equal(l.ownFixed, 400);
  assert.equal(l.ownVariable, 250);
  assert.equal(a.ownFixed, 299);
  assert.equal(a.ownVariable, 900);
  assert.equal(sharedTotals(d, '2026-09').total, 16600); // personliga räknas inte i gemensamt
});

test('återkommande lön, justering för en månad och engångsinkomst', () => {
  const d = data();
  const aug = incomeRows(d, L, '2026-08');
  assert.deepEqual(aug.map((r) => r.amount), [30000]);
  const sep = incomeRows(d, L, '2026-09');
  assert.equal(sep.length, 2);
  assert.equal(sep.find((r) => r.row.id === 'lon').amount, 33000);
  assert.equal(sep.find((r) => r.row.id === 'lon').adjustment.id, 'lon-sep');
  assert.deepEqual(incomeRows(d, L, '2026-10').map((r) => r.amount), [30000]);
  // Angelicas lön slutade i augusti
  assert.equal(incomeRows(d, A, '2026-08')[0].amount, 28000);
  assert.equal(incomeRows(d, A, '2026-09').length, 0);
});

test('kvar = inkomst − andel − egna', () => {
  const t = personTotals(data(), L, 50, '2026-09');
  assert.equal(t.income, 35000);
  assert.equal(t.left, 35000 - 8300 - 650);
  const a = personTotals(data(), A, 50, '2026-09');
  assert.equal(a.left, 0 - 8300 - 1199);
  assert.ok(a.left < 0);
});

test('rörliga per kategori: gemensamt och personligt med andel', () => {
  const months = ['2026-08', '2026-09'];
  const shared = variableByCategory(data(), months);
  assert.equal(shared.get('mat').get('2026-09'), 4000);
  assert.equal(shared.get('utemat').get('2026-09'), 600);
  const lucas = variableByCategory(data(), months, { owner: L, pct: 50 });
  assert.equal(lucas.get('mat').get('2026-09'), 2000);
  assert.equal(lucas.get('utemat').get('2026-09'), 300 + 250);
  const angelica = variableByCategory(data(), months, { owner: A, pct: 50 });
  assert.equal(angelica.get('utemat').get('2026-09'), 300 + 900);
});

test('trendrader: förändring och sortering', () => {
  const cats = [{ id: 'mat', name: 'Mat' }, { id: 'utemat', name: 'Utemat' }, { id: 'noje', name: 'Nöje' }];
  const months = ['2026-08', '2026-09'];
  const byCat = variableByCategory(data(), months);
  const rows = categoryTrend(byCat, cats, months, 'amount');
  assert.deepEqual(rows.map((r) => r.category.id), ['mat', 'utemat']); // Nöje saknar belopp
  const mat = rows[0];
  assert.equal(mat.diff, 3000);
  assert.equal(mat.pct, 300);
  const utemat = rows[1];
  assert.equal(utemat.pct, null); // 0 kr i augusti → ingen procent
  assert.deepEqual(change(800, 1000), { diff: -200, pct: -20 });
  byCat.get('utemat').set('2026-08', 5000); // −4400 kr → störst förändring
  assert.deepEqual(categoryTrend(byCat, cats, months, 'change').map((r) => r.category.id), ['utemat', 'mat']);
});
