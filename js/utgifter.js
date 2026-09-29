// Utgifter: fasta (gäller från en månad och framåt), rörliga och övrigt (per månad),
// inkomst, vad som blir kvar och en graf över de senaste tolv månaderna.
//
// Fasta utgifter har start_month och end_month ('YYYY-MM', null = tills vidare).
// En ändring i månad M avslutar den gamla raden månaden innan och skapar en ny rad från M,
// och "ta bort" sätter end_month. Tidigare månader påverkas därför aldrig.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, iconButton, kr, parseAmount, amountForInput, fmt, capitalize, monthKey, errorBox,
  skeleton, toast, toastError, confirmSheet, put, add,
} from './ui.js';
import { renderChart } from './utgifter-graf.js';

export const title = 'Utgifter';

const CATS = {
  fixed: { heading: 'Fasta utgifter', color: 'fixed', legend: 'Fasta', placeholder: 'T.ex. Hyra' },
  rorlig: { heading: 'Rörliga utgifter', color: 'variable', legend: 'Rörliga', placeholder: 'T.ex. Mat' },
  ovrigt: { heading: 'Övrigt', color: 'other', legend: 'Övrigt', placeholder: 'T.ex. Present' },
};

// ---------- Månadshjälp ('YYYY-MM') ----------

export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number);
  return monthKey(new Date(y, mo - 1 + n, 1));
}
export function monthDate(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1);
}
const monthName = (m) => capitalize(fmt.monthYear(monthDate(m)));
const monthOnly = (m) => monthDate(m).toLocaleDateString('sv-SE', { month: 'long' });

/** Gäller den fasta utgiften månaden m? */
const activeIn = (r, m) => r.start_month <= m && (!r.end_month || r.end_month >= m);
const sum = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'sv');

export function mount(root, { params }) {
  const hid = state.household.id;
  const current = monthKey(new Date());
  let month = /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : current;

  // Data för hela graffönstret
  let fixedAll = [];       // alla fasta rader (alla versioner)
  let variableAll = [];    // rörliga + övrigt inom fönstret
  let incomes = {};        // månad → inkomst
  let win = [];            // månaderna i grafen
  let loadToken = 0;

  const monthLabel = h('h2', { class: 'month-label', attrs: { 'aria-live': 'polite' } });
  const content = h('div');

  add(root,
    h('header', { class: 'topbar' }, h('div', { class: 'grow' }, h('h1', { text: 'Utgifter' }))),
    h('div', { class: 'month-switch' },
      iconButton('left', 'Föregående månad', () => goTo(addMonths(month, -1))),
      monthLabel,
      iconButton('right', 'Nästa månad', () => goTo(addMonths(month, 1))),
    ),
    content,
  );

  let refocusChart = false;
  function goTo(m, { keepScroll = false, focusChart = false } = {}) {
    month = m;
    refocusChart = focusChart;
    history.replaceState(null, '', '#utgifter/' + month);
    load(!win.includes(m));
    if (!keepScroll) window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  /** Tolv månader. Står man i närtid slutar fönstret i innevarande månad, annars runt vald månad. */
  function windowFor(m) {
    let end = current;
    if (m > current) end = m;
    else if (m < addMonths(current, -11)) end = addMonths(m, 6);
    return Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
  }

  async function load(showSkeleton) {
    const token = ++loadToken;
    monthLabel.textContent = monthName(month);
    const w = windowFor(month);
    if (showSkeleton) put(content, skeleton(4));
    const [fx, vr, inc] = await Promise.all([
      sb.from('fixed_expenses').select('*').eq('household_id', hid).order('name'),
      sb.from('variable_expenses').select('*').eq('household_id', hid).gte('month', w[0]).lte('month', w[11]).order('name'),
      sb.from('month_income').select('*').eq('household_id', hid).gte('month', w[0]).lte('month', w[11]),
    ]);
    if (token !== loadToken) return;
    const err = fx.error || vr.error || inc.error;
    if (err) { put(content, errorBox(err, () => load(true))); return; }
    win = w;
    fixedAll = fx.data;
    variableAll = vr.data.map((r) => ({ ...r, category: r.category === 'ovrigt' ? 'ovrigt' : 'rorlig' }));
    incomes = Object.fromEntries(inc.data.map((r) => [r.month, Number(r.income) || 0]));
    render();
  }

  // ---------- Beräkningar ----------

  const rowsFor = (cat, m = month) => cat === 'fixed'
    ? fixedAll.filter((r) => activeIn(r, m)).sort(byName)
    : variableAll.filter((r) => r.month === m && r.category === cat).sort(byName);

  function totals(m) {
    const fixed = sum(rowsFor('fixed', m));
    const variable = sum(rowsFor('rorlig', m));
    const other = sum(rowsFor('ovrigt', m));
    return { month: m, fixed, variable, other, total: fixed + variable + other, income: incomes[m] || 0 };
  }

  // ---------- Rendering ----------

  let summaryEl, chartEl;
  let rendering = false;

  function render() {
    summaryEl = h('section', { class: 'card summary', attrs: { 'aria-label': 'Summering' } });
    // Grafkortet återanvänds mellan omritningar (det har en ResizeObserver).
    chartEl ||= h('section', { class: 'card chart-card', attrs: { 'aria-label': 'Utgifter över tid' } });
    rendering = true; // grafen ritas först när allt är på plats (annars tappas fokus)
    renderSummary();
    rendering = false;
    put(content,
      summaryEl,
      chartEl,
      section('fixed', 'Gäller från och med månaden de läggs till'),
      section('rorlig', 'Bara ' + monthName(month).toLowerCase()),
      section('ovrigt', 'Engångsköp, presenter och annat'),
    );
    drawChart();
  }

  function renderSummary() {
    const incomeInput = h('input', {
      class: 'input amount-input', type: 'text', id: 'income-' + month,
      value: incomes[month] ? amountForInput(incomes[month]) : '',
      placeholder: '0', attrs: { inputmode: 'decimal', autocomplete: 'off' },
      on: { change: (e) => saveIncome(e.target), keydown: blurOnEnter },
    });
    put(summaryEl,
      h('div', { class: 'label', text: 'Totalt ' + monthOnly(month) }),
      h('div', { class: 'total-line' },
        h('div', { class: 'big num', dataset: { ref: 'total' } }),
        h('span', { dataset: { ref: 'delta' } }),
      ),
      h('div', { class: 'split-bar', attrs: { role: 'img' }, dataset: { ref: 'bar' } }),
      h('div', { class: 'legend' },
        Object.entries(CATS).map(([cat, c]) => h('span', {},
          h('i', { class: 'dot ' + c.color }), c.legend + ' ', h('b', { class: 'num', dataset: { ref: cat } }))),
      ),
      h('div', { class: 'income-row' },
        h('label', { class: 'label', text: 'Inkomst', attrs: { for: 'income-' + month } }),
        h('div', { class: 'amount-wrap' }, incomeInput, h('span', { class: 'unit', text: 'kr' })),
      ),
      h('div', { class: 'left-row' }, h('span', { text: 'Kvar' }), h('span', { dataset: { ref: 'left' } })),
    );
    updateNumbers();
  }

  /** Uppdatera siffror, stapel och graf utan att rita om fälten man kanske står i. */
  function updateNumbers() {
    const t = totals(month);
    const ref = (name) => summaryEl.querySelector(`[data-ref="${name}"]`);
    ref('total').textContent = kr(t.total);
    ref('fixed').textContent = kr(t.fixed);
    ref('rorlig').textContent = kr(t.variable);
    ref('ovrigt').textContent = kr(t.other);

    const bar = ref('bar');
    bar.setAttribute('aria-label', `Fasta ${kr(t.fixed)}, rörliga ${kr(t.variable)}, övrigt ${kr(t.other)}`);
    const parts = [['fixed', t.fixed], ['variable', t.variable], ['other', t.other]].filter(([, v]) => v > 0);
    put(bar, parts.length
      ? parts.map(([cls, v]) => h('span', { class: 'seg ' + cls, style: `width:${(v / t.total) * 100}%` }))
      : h('span', { class: 'seg none' }));

    put(ref('delta'), deltaChip(t.total, totals(addMonths(month, -1)).total, monthOnly(addMonths(month, -1))));

    const left = ref('left');
    if (t.income) {
      const rest = t.income - t.total;
      left.className = 'num strong ' + (rest < 0 ? 'neg' : 'pos');
      left.textContent = kr(rest);
    } else {
      left.className = 'muted small';
      left.textContent = 'Fyll i inkomsten för att se vad som blir kvar';
    }
    for (const cat of Object.keys(CATS)) {
      const el = content.querySelector(`[data-sum="${cat}"]`);
      if (el) el.textContent = kr(sum(rowsFor(cat)));
    }
    drawChart();
  }

  function drawChart() {
    if (!chartEl || rendering) return;
    renderChart(chartEl, {
      months: win.map(totals),
      selected: month,
      onSelect: (m, viaKeyboard) => goTo(m, { keepScroll: viaKeyboard, focusChart: viaKeyboard }),
      monthName,
      focusSelected: refocusChart,
    });
    refocusChart = false;
  }

  // ---------- Sektioner ----------

  function section(cat, sub) {
    const c = CATS[cat];
    const rows = rowsFor(cat);
    const list = h('ul', { class: 'rows expense-rows' }, rows.map((r) => expenseRow(r, cat)));

    const nameIn = h('input', { class: 'input', placeholder: c.placeholder, attrs: { 'aria-label': `Namn på ny post i ${c.heading.toLowerCase()}`, autocomplete: 'off', maxlength: '80' } });
    const amountIn = h('input', { class: 'input amount-input', placeholder: 'Belopp', attrs: { inputmode: 'decimal', 'aria-label': 'Belopp', autocomplete: 'off' } });
    const addBtn = h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till i ' + c.heading.toLowerCase(), title: 'Lägg till' } }, icon('plus'));
    const form = h('form', { class: 'add-expense', dataset: { cat }, on: { submit: async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      const amount = parseAmount(amountIn.value);
      if (!name) { toast(`Skriv vad det gäller, t.ex. "${c.placeholder.replace('T.ex. ', '')}".`, { error: true }); nameIn.focus(); return; }
      if (Number.isNaN(amount)) { toast('Beloppet ska vara ett tal, t.ex. 1234 eller 99,50.', { error: true }); amountIn.focus(); return; }
      addBtn.disabled = true;
      const res = cat === 'fixed'
        ? await sb.from('fixed_expenses').insert({ household_id: hid, name, amount, start_month: month, end_month: null }).select().single()
        : await sb.from('variable_expenses').insert({ household_id: hid, name, amount, month, category: cat }).select().single();
      addBtn.disabled = false;
      if (res.error) return toastError(res.error);
      if (cat === 'fixed') fixedAll.push(res.data);
      else variableAll.push({ ...res.data, category: cat });
      render();
      // Fortsätt skriva nästa post direkt
      content.querySelector(`.add-expense[data-cat="${cat}"] input`)?.focus();
    } } }, nameIn, amountIn, addBtn);

    const empty = {
      fixed: 'Inga fasta utgifter den här månaden. Lägg till t.ex. hyra, el och abonnemang nedan – de följer med till kommande månader.',
      rorlig: 'Inga rörliga utgifter den här månaden. Lägg till t.ex. mat eller nöjen nedan.',
      ovrigt: 'Inget övrigt den här månaden. Här hamnar engångsköp och presenter.',
    }[cat];

    return h('section', { class: 'expense-section cat-' + c.color, attrs: { 'aria-label': c.heading } },
      h('div', { class: 'section-head' },
        h('div', {}, h('h2', {}, h('i', { class: 'dot ' + c.color }), c.heading), h('div', { class: 'muted small', text: sub })),
        h('div', { class: 'num section-sum', dataset: { sum: cat }, text: kr(sum(rows)) }),
      ),
      rows.length ? list : h('p', { class: 'muted small empty-inline', text: empty }),
      form,
    );
  }

  function expenseRow(r, cat) {
    const nameIn = h('input', {
      class: 'input bare', value: r.name, attrs: { 'aria-label': 'Namn', autocomplete: 'off', maxlength: '80' },
      on: { change: (e) => saveField(r, cat, 'name', e.target), keydown: blurOnEnter },
    });
    const amountIn = h('input', {
      class: 'input bare amount-input num', value: amountForInput(r.amount),
      attrs: { inputmode: 'decimal', 'aria-label': `Belopp för ${r.name}`, autocomplete: 'off' },
      on: { change: (e) => saveField(r, cat, 'amount', e.target), keydown: blurOnEnter, focus: (e) => e.target.select() },
    });
    const since = cat === 'fixed' && r.start_month < month
      ? h('span', { class: 'since muted', text: 'sedan ' + monthDate(r.start_month).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' }).replace('.', '') })
      : null;
    return h('li', { class: 'expense' },
      h('div', { class: 'name-cell' }, nameIn, since),
      h('div', { class: 'amount-wrap' }, amountIn, h('span', { class: 'unit', text: 'kr' })),
      iconButton('trash', `Ta bort ${r.name}`, () => removeRow(r, cat)),
    );
  }

  // ---------- Spara ----------

  async function saveField(r, cat, col, input) {
    let value;
    if (col === 'amount') {
      value = parseAmount(input.value);
      if (Number.isNaN(value)) {
        toast('Beloppet ska vara ett tal, t.ex. 1234 eller 99,50.', { error: true });
        input.value = amountForInput(r.amount);
        return;
      }
      input.value = amountForInput(value);
    } else {
      value = input.value.trim();
      if (!value) { input.value = r.name; toast('Namnet kan inte vara tomt.', { error: true }); return; }
    }
    if (r[col] === value || (col === 'amount' && Number(r[col]) === value)) return;

    if (cat !== 'fixed' || r.start_month === month) {
      // Rörligt/övrigt, eller en fast utgift som började just denna månad: ändra raden direkt.
      const table = cat === 'fixed' ? 'fixed_expenses' : 'variable_expenses';
      const prev = r[col];
      r[col] = value;
      updateNumbers();
      const { error } = await sb.from(table).update({ [col]: value }).eq('id', r.id);
      if (error) { r[col] = prev; input.value = col === 'amount' ? amountForInput(prev) : prev; updateNumbers(); toastError(error); }
      return;
    }

    // Fast utgift från en tidigare månad: avsluta den gamla raden och starta en ny från denna månad.
    const oldEnd = r.end_month;
    const endPrev = addMonths(month, -1);
    const up = await sb.from('fixed_expenses').update({ end_month: endPrev }).eq('id', r.id);
    if (up.error) { input.value = col === 'amount' ? amountForInput(r[col]) : r[col]; return toastError(up.error); }
    const fresh = { household_id: hid, name: r.name, amount: r.amount, [col]: value, start_month: month, end_month: oldEnd };
    const ins = await sb.from('fixed_expenses').insert(fresh).select().single();
    if (ins.error) {
      await sb.from('fixed_expenses').update({ end_month: oldEnd }).eq('id', r.id);
      input.value = col === 'amount' ? amountForInput(r[col]) : r[col];
      return toastError(ins.error);
    }
    // Den gamla versionen ligger kvar för tidigare månader; raden i vyn blir den nya versionen.
    fixedAll.push({ ...r, end_month: endPrev });
    Object.assign(r, ins.data);
    updateNumbers();
    toast(`Ändrat från och med ${monthOnly(month)}. Tidigare månader är oförändrade.`);
  }

  async function removeRow(r, cat) {
    if (cat === 'fixed') {
      const fromNow = r.start_month >= month;
      const ok = await confirmSheet({
        title: `Ta bort ${r.name}?`,
        message: fromNow
          ? `Den tas bort från och med ${monthOnly(month)}.`
          : `Den tas bort från och med ${monthOnly(month)}. ${capitalize(monthOnly(addMonths(month, -1)))} och tidigare månader påverkas inte.`,
      });
      if (!ok) return;
      const res = fromNow
        ? await sb.from('fixed_expenses').delete().eq('id', r.id)
        : await sb.from('fixed_expenses').update({ end_month: addMonths(month, -1) }).eq('id', r.id);
      if (res.error) return toastError(res.error);
      if (fromNow) fixedAll = fixedAll.filter((x) => x !== r);
      else r.end_month = addMonths(month, -1);
    } else {
      const ok = await confirmSheet({ title: `Ta bort ${r.name}?`, message: `Den tas bort från ${monthName(month).toLowerCase()}.` });
      if (!ok) return;
      const { error } = await sb.from('variable_expenses').delete().eq('id', r.id);
      if (error) return toastError(error);
      variableAll = variableAll.filter((x) => x !== r);
    }
    render();
  }

  async function saveIncome(input) {
    const value = parseAmount(input.value);
    if (Number.isNaN(value)) {
      toast('Inkomsten ska vara ett tal, t.ex. 32000.', { error: true });
      input.value = incomes[month] ? amountForInput(incomes[month]) : '';
      return;
    }
    const prev = incomes[month];
    incomes[month] = value;
    updateNumbers();
    const { error } = await sb.from('month_income').upsert({ household_id: hid, month, income: value }, { onConflict: 'household_id,month' });
    if (error) { incomes[month] = prev; updateNumbers(); toastError(error); }
  }

  function blurOnEnter(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  }

  load(true);

  return {
    tables: ['fixed_expenses', 'variable_expenses', 'month_income'],
    refresh: () => load(false),
  };
}

/** "▲ 12 % mot augusti" – ökade utgifter visas i varningsfärg, minskade i grönt. */
export function deltaChip(now, before, beforeName) {
  if (!before || !now) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return h('span', { class: 'delta flat', text: `± 0 % mot ${beforeName}` });
  const up = pct > 0;
  return h('span', {
    class: 'delta ' + (up ? 'up' : 'down'),
    attrs: { title: `${up ? 'Ökning' : 'Minskning'} med ${Math.abs(pct)} % jämfört med ${beforeName}` },
  }, h('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' }, text: up ? '▲' : '▼' }), `${Math.abs(pct)} % mot ${beforeName}`);
}
