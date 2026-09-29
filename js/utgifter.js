// Utgifter: fasta (alla månader) och rörliga (per månad), inkomst och vad som blir kvar.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, iconButton, kr, parseAmount, amountForInput, fmt, capitalize, monthKey, errorBox,
  skeleton, toast, toastError, confirmSheet, put, add,
} from './ui.js';

export const title = 'Utgifter';

export function mount(root, { params }) {
  const hid = state.household.id;
  const initial = /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : monthKey(new Date());
  let month = initial;
  let data = { fixed: [], variable: [], income: 0 };
  let loadToken = 0;

  const monthLabel = h('h2', { class: 'month-label', attrs: { 'aria-live': 'polite' } });
  const content = h('div');

  add(root,
    h('header', { class: 'topbar' }, h('div', { class: 'grow' }, h('h1', { text: 'Utgifter' }))),
    h('div', { class: 'month-switch' },
      iconButton('left', 'Föregående månad', () => shiftMonth(-1)),
      monthLabel,
      iconButton('right', 'Nästa månad', () => shiftMonth(1)),
    ),
    content,
  );

  function shiftMonth(delta) {
    const [y, m] = month.split('-').map(Number);
    month = monthKey(new Date(y, m - 1 + delta, 1));
    history.replaceState(null, '', '#utgifter/' + month);
    load(true);
  }

  async function load(showSkeleton) {
    const token = ++loadToken;
    const [y, m] = month.split('-').map(Number);
    monthLabel.textContent = capitalize(fmt.monthYear(new Date(y, m - 1, 1)));
    if (showSkeleton) put(content, skeleton(4));
    const [fx, vr, inc] = await Promise.all([
      sb.from('fixed_expenses').select('*').eq('household_id', hid).order('name'),
      sb.from('variable_expenses').select('*').eq('household_id', hid).eq('month', month).order('name'),
      sb.from('month_income').select('*').eq('household_id', hid).eq('month', month).maybeSingle(),
    ]);
    if (token !== loadToken) return;
    const err = fx.error || vr.error || inc.error;
    if (err) { put(content, errorBox(err, () => load(true))); return; }
    data = { fixed: fx.data, variable: vr.data, income: Number(inc.data?.income) || 0 };
    render();
  }

  // ---------- Rendering ----------

  const sum = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  let summaryEl;

  function render() {
    summaryEl = h('section', { class: 'card summary', attrs: { 'aria-label': 'Summering' } });
    renderSummary();
    put(content, 
      summaryEl,
      section('fixed', 'Fasta utgifter', 'Gäller alla månader'),
      section('variable', 'Rörliga utgifter', 'Bara ' + monthLabel.textContent.toLowerCase()),
    );
  }

  function renderSummary() {
    const incomeInput = h('input', {
      class: 'input amount-input', type: 'text', id: 'income-' + month,
      value: data.income ? amountForInput(data.income) : '',
      placeholder: '0', attrs: { inputmode: 'decimal', autocomplete: 'off' },
      on: { change: (e) => saveIncome(e.target), keydown: blurOnEnter },
    });
    put(summaryEl, 
      h('div', { class: 'label', text: 'Totalt denna månad' }),
      h('div', { class: 'big num', dataset: { ref: 'total' } }),
      h('div', { class: 'split-bar', attrs: { role: 'img' }, dataset: { ref: 'bar' } }),
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'dot fixed' }), 'Fasta ', h('b', { class: 'num', dataset: { ref: 'fixed' } })),
        h('span', {}, h('i', { class: 'dot variable' }), 'Rörliga ', h('b', { class: 'num', dataset: { ref: 'variable' } })),
      ),
      h('div', { class: 'income-row' },
        h('label', { class: 'label', text: 'Inkomst', attrs: { for: 'income-' + month } }),
        h('div', { class: 'amount-wrap' }, incomeInput, h('span', { class: 'unit', text: 'kr' })),
      ),
      h('div', { class: 'left-row' }, h('span', { text: 'Kvar' }), h('span', { dataset: { ref: 'left' } })),
    );
    updateNumbers();
  }

  // Uppdatera siffror och stapel utan att rita om fälten man kanske står i.
  function updateNumbers() {
    const f = sum(data.fixed), v = sum(data.variable), total = f + v;
    const ref = (name) => summaryEl.querySelector(`[data-ref="${name}"]`);
    ref('total').textContent = kr(total);
    ref('fixed').textContent = kr(f);
    ref('variable').textContent = kr(v);
    const bar = ref('bar');
    bar.setAttribute('aria-label', `Fasta ${kr(f)}, rörliga ${kr(v)}`);
    const pf = total > 0 ? (f / total) * 100 : 0;
    put(bar, ...(total > 0
      ? [h('span', { class: 'seg fixed', style: `width:${pf}%` }), h('span', { class: 'seg variable', style: `width:${100 - pf}%` })]
      : [h('span', { class: 'seg none' })]));
    const left = ref('left');
    if (data.income) {
      const rest = data.income - total;
      left.className = 'num strong ' + (rest < 0 ? 'neg' : 'pos');
      left.textContent = kr(rest);
    } else {
      left.className = 'muted small';
      left.textContent = 'Fyll i inkomsten för att se vad som blir kvar';
    }
    const sums = content.querySelectorAll('.section-sum');
    if (sums[0]) sums[0].textContent = kr(f);
    if (sums[1]) sums[1].textContent = kr(v);
  }

  function section(kind, heading, sub) {
    const rows = kind === 'fixed' ? data.fixed : data.variable;
    const table = kind === 'fixed' ? 'fixed_expenses' : 'variable_expenses';
    const list = h('ul', { class: 'rows expense-rows' });
    for (const r of rows) list.append(expenseRow(r, table, kind));

    const nameIn = h('input', { class: 'input', placeholder: kind === 'fixed' ? 'T.ex. Hyra' : 'T.ex. Mat', attrs: { 'aria-label': 'Namn på ny utgift', autocomplete: 'off', maxlength: '80' } });
    const amountIn = h('input', { class: 'input amount-input', placeholder: 'Belopp', attrs: { inputmode: 'decimal', 'aria-label': 'Belopp', autocomplete: 'off' } });
    const addBtn = h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till utgift', title: 'Lägg till' } }, icon('plus'));
    const form = h('form', { class: 'add-expense', on: { submit: async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      const amount = parseAmount(amountIn.value);
      if (!name) { toast('Skriv vad utgiften heter, t.ex. "Hyra".', { error: true }); nameIn.focus(); return; }
      if (Number.isNaN(amount)) { toast('Beloppet ska vara ett tal, t.ex. 1234 eller 99,50.', { error: true }); amountIn.focus(); return; }
      addBtn.disabled = true;
      const row = { household_id: hid, name, amount };
      if (kind === 'variable') row.month = month;
      const { data: inserted, error } = await sb.from(table).insert(row).select().single();
      addBtn.disabled = false;
      if (error) return toastError(error);
      rows.push(inserted);
      rows.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      nameIn.value = ''; amountIn.value = '';
      render();
      // Fortsätt skriva nästa utgift direkt
      content.querySelector(`.add-expense[data-kind="${kind}"] input`)?.focus();
    } } }, nameIn, amountIn, addBtn);
    form.dataset.kind = kind;

    return h('section', { attrs: { 'aria-label': heading } },
      h('div', { class: 'section-head' },
        h('div', {}, h('h2', { text: heading }), h('div', { class: 'muted small', text: sub })),
        h('div', { class: 'num section-sum', text: kr(sum(rows)) }),
      ),
      rows.length ? list : h('p', { class: 'muted small empty-inline', text: kind === 'fixed'
        ? 'Inga fasta utgifter ännu. Lägg till t.ex. hyra, el och abonnemang nedan.'
        : 'Inga rörliga utgifter den här månaden. Lägg till t.ex. mat eller nöjen nedan.' }),
      form,
    );
  }

  function expenseRow(r, table, kind) {
    const nameIn = h('input', {
      class: 'input bare', value: r.name, attrs: { 'aria-label': 'Namn', autocomplete: 'off', maxlength: '80' },
      on: { change: (e) => saveField(r, table, 'name', e.target), keydown: blurOnEnter },
    });
    const amountIn = h('input', {
      class: 'input bare amount-input num', value: amountForInput(r.amount),
      attrs: { inputmode: 'decimal', 'aria-label': `Belopp för ${r.name}`, autocomplete: 'off' },
      on: { change: (e) => saveField(r, table, 'amount', e.target), keydown: blurOnEnter, focus: (e) => e.target.select() },
    });
    return h('li', { class: 'expense' },
      nameIn,
      h('div', { class: 'amount-wrap' }, amountIn, h('span', { class: 'unit', text: 'kr' })),
      iconButton('trash', `Ta bort ${r.name}`, async () => {
        const ok = await confirmSheet({ title: `Ta bort ${r.name}?`, message: kind === 'fixed' ? 'Den försvinner från alla månader.' : 'Den tas bort från den här månaden.' });
        if (!ok) return;
        const { error } = await sb.from(table).delete().eq('id', r.id);
        if (error) return toastError(error);
        const arr = kind === 'fixed' ? data.fixed : data.variable;
        arr.splice(arr.indexOf(r), 1);
        render();
      }),
    );
  }

  async function saveField(r, table, col, input) {
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
    const prev = r[col];
    r[col] = value;
    updateNumbers();
    const { error } = await sb.from(table).update({ [col]: value }).eq('id', r.id);
    if (error) {
      r[col] = prev;
      input.value = col === 'amount' ? amountForInput(prev) : prev;
      updateNumbers();
      toastError(error);
    }
  }

  async function saveIncome(input) {
    const value = parseAmount(input.value);
    if (Number.isNaN(value)) {
      toast('Inkomsten ska vara ett tal, t.ex. 32000.', { error: true });
      input.value = data.income ? amountForInput(data.income) : '';
      return;
    }
    const prev = data.income;
    data.income = value;
    updateNumbers();
    const { error } = await sb.from('month_income').upsert({ household_id: hid, month, income: value }, { onConflict: 'household_id,month' });
    if (error) { data.income = prev; updateNumbers(); toastError(error); }
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
