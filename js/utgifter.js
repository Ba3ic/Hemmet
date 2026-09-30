// Utgifter: flikarna Gemensamt och en per person, var och en med Lista och Trender.
//
// Gemensamt: fasta och rörliga utgifter (owner null), hushållets inkomst och vad som blir kvar.
// Personlig flik: inkomst − andel av gemensamt − egna utgifter = kvar. Andelen räknas fram
// från de gemensamma raderna (split_percent på members, 50 %) och sparas aldrig som egna rader,
// så en ändring i Gemensamt syns direkt. Personliga flikar är privata: man ser bara sin egen
// (databasen släpper bara igenom egna personliga rader, se migrations/003).
//
// Fasta utgifter har start_month och end_month ('YYYY-MM', null = tills vidare).
// En ändring i månad M avslutar den gamla raden månaden innan och skapar en ny rad från M,
// och "ta bort" sätter end_month. Tidigare månader påverkas därför aldrig. Återkommande
// inkomster fungerar likadant, och kan dessutom justeras för en enskild månad (replaces_id).
//
// Adress: #utgifter/<gemensamt|user_id>/<YYYY-MM>[/trender]. Den gamla #utgifter/<YYYY-MM> fungerar också.
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, iconButton, kr, parseAmount, amountForInput, fmt, capitalize, monthKey, errorBox,
  skeleton, toast, toastError, confirmSheet, sheet, put, add,
} from './ui.js';
import { renderChart, trendBadge } from './utgifter-graf.js';
import {
  addMonths, fixedIn, variableIn, sum, splitOf, shareRows, incomeRows, sharedTotals, personTotals,
} from './utgifter-berakning.js';
import { categoriesFor, colorMap, fallbackOf, pickCategory, manageCategories } from './utgifter-kategorier.js';
import { renderTrends } from './utgifter-trender.js';

export const title = 'Utgifter';

const SHARED = 'gemensamt';
const MONTH_RE = /^\d{4}-\d{2}$/;

const KINDS = {
  fixed: { table: 'fixed_expenses', heading: 'Fasta utgifter', color: 'var(--c-fixed)', placeholder: 'T.ex. Hyra' },
  variable: { table: 'variable_expenses', heading: 'Rörliga utgifter', color: 'var(--c-variable)', placeholder: 'T.ex. Mat' },
};

export function monthDate(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1);
}
const monthName = (m) => capitalize(fmt.monthYear(monthDate(m)));
const monthOnly = (m) => monthDate(m).toLocaleDateString('sv-SE', { month: 'long' });
const byName = (a, b) => a.name.localeCompare(b.name, 'sv');

export function mount(root, { params }) {
  const hid = state.household.id;
  const me = state.user.id;
  const current = monthKey(new Date());

  // ---------- Läge från adressen ----------
  let who = SHARED;
  let month = current;
  let mode = 'lista';
  if (MONTH_RE.test(params[0] || '')) month = params[0];
  else {
    if (params[0]) who = params[0];
    if (MONTH_RE.test(params[1] || '')) month = params[1];
    if (params[2] === 'trender') mode = 'trender';
  }

  // ---------- Data ----------
  let members = [];          // [{ user_id, display_name, split_percent }]
  let categories = [];       // alla hushållets kategorier
  const data = { fixed: [], variable: [], incomes: [] };
  let sharedIncome = {};     // månad → hushållets inkomst (Gemensamt)
  let win = [];              // månaderna i översiktsgrafen
  let loadedFrom = null;     // första månaden med hämtade rörliga utgifter
  let loadToken = 0;
  let loaded = false;

  // Val i trendvyn (period och sortering gemensamt, filter per flik)
  const trendOpts = { n: 6, sortBy: 'amount' };
  const trendFilter = new Map();
  // Senast valda kategori per sektion, så att man kan lägga in flera i rad
  const lastCategory = new Map();

  // ---------- Skal ----------
  const subnav = h('div', { class: 'subnav' });
  const monthLabel = h('h2', { class: 'month-label', attrs: { 'aria-live': 'polite' } });
  const modeSwitch = h('div', { class: 'mode-switch' });
  const content = h('div');
  // Grafkort återanvänds mellan omritningar (de har en ResizeObserver).
  const cards = {
    overview: h('section', { class: 'card chart-card', attrs: { 'aria-label': 'Utgifter över tid' } }),
    trend: h('section', { class: 'card chart-card', attrs: { 'aria-label': 'Rörliga utgifter per kategori' } }),
    left: h('section', { class: 'card chart-card', attrs: { 'aria-label': 'Kvar per månad' } }),
  };

  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' }, h('h1', { text: 'Utgifter' })),
      h('button', { type: 'button', class: 'btn btn-sm', on: { click: openManage } }, icon('tag'), 'Kategorier'),
    ),
    subnav,
    h('div', { class: 'month-switch' },
      iconButton('left', 'Föregående månad', () => goTo(addMonths(month, -1))),
      monthLabel,
      iconButton('right', 'Nästa månad', () => goTo(addMonths(month, 1))),
    ),
    modeSwitch,
    content,
  );

  const ownerOf = (w) => (w === SHARED ? null : w);
  const memberOf = (uid) => members.find((m) => m.user_id === uid);
  const nameOf = (uid) => memberOf(uid)?.display_name || (uid === me ? 'Jag' : 'Sambo');
  const pctOf = (uid) => splitOf(memberOf(uid));

  function updateHash() {
    history.replaceState(null, '', `#utgifter/${who}/${month}${mode === 'trender' ? '/trender' : ''}`);
  }

  let refocusChart = false;
  function goTo(m, { keepScroll = false, focusChart = false } = {}) {
    month = m;
    refocusChart = focusChart;
    updateHash();
    const covered = win.includes(m) && loadedFrom && addMonths(m, -12) >= loadedFrom;
    load(!covered);
    if (!keepScroll) window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const selectMonth = (m, viaKeyboard) => goTo(m, { keepScroll: viaKeyboard, focusChart: viaKeyboard });

  function setWho(w) {
    who = w;
    updateHash();
    render();
  }
  function setMode(m) {
    mode = m;
    updateHash();
    render();
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
    // Trendvyn behöver upp till tolv månader bakåt från vald månad, plus en för jämförelse.
    const from = [w[0], addMonths(month, -12)].sort()[0];
    if (showSkeleton) put(content, skeleton(4));
    const [mem, cat, fx, vr, inc, hinc] = await Promise.all([
      sb.from('members').select('user_id, display_name, split_percent').eq('household_id', hid),
      sb.from('categories').select('*').eq('household_id', hid),
      sb.from('fixed_expenses').select('*').eq('household_id', hid).order('name'),
      sb.from('variable_expenses').select('*').eq('household_id', hid).gte('month', from).lte('month', w[11]).order('name'),
      sb.from('incomes').select('*').eq('household_id', hid).lte('month', w[11]),
      sb.from('month_income').select('*').eq('household_id', hid).gte('month', w[0]).lte('month', w[11]),
    ]);
    if (token !== loadToken) return;
    const err = mem.error || cat.error || fx.error || vr.error || inc.error || hinc.error;
    if (err) { put(content, errorBox(err, () => load(true))); return; }
    win = w;
    loadedFrom = from;
    const creator = state.household.created_by;
    members = mem.data.sort((a, b) => rank(a) - rank(b) || String(a.display_name).localeCompare(String(b.display_name), 'sv'));
    function rank(m) { return m.user_id === creator ? 0 : m.user_id === me && !creator ? 0 : 1; }
    categories = cat.data;
    data.fixed = fx.data;
    data.variable = vr.data;
    data.incomes = inc.data;
    sharedIncome = Object.fromEntries(hinc.data.map((r) => [r.month, Number(r.income) || 0]));
    if (who !== SHARED && who !== me) who = SHARED;
    loaded = true;
    render();
  }

  // ---------- Rendering ----------

  // Siffror som uppdateras utan att rita om fälten man kanske står i
  let numberUpdaters = [];
  function updateNumbers() {
    for (const fn of numberUpdaters) fn();
  }

  function render() {
    if (!loaded) return;
    monthLabel.textContent = monthName(month);
    renderSubnav();
    renderModeSwitch();
    numberUpdaters = [];
    const owner = ownerOf(who);
    const hint = nameHint();
    if (mode === 'trender') {
      const body = h('div');
      put(content, hint, body);
      renderTrends(body, {
        data,
        categories: categoriesFor(categories, owner),
        owner,
        pct: owner ? pctOf(owner) : 100,
        month,
        opts: { ...trendOpts, filter: trendFilter.get(who) || new Set() },
        setOpts: (patch) => {
          if (patch.filter) trendFilter.set(who, patch.filter);
          if (patch.n) trendOpts.n = patch.n;
          if (patch.sortBy) trendOpts.sortBy = patch.sortBy;
          // Behåll fokus på reglaget man använde när vyn ritas om
          const key = document.activeElement?.dataset?.focusKey;
          render();
          if (key) content.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
        },
        onSelectMonth: selectMonth,
        monthName,
        monthOnly,
        cards: { chart: cards.trend, left: cards.left },
        ownerLabel: owner === me ? 'din' : nameOf(owner) + 's',
      });
    } else if (owner) {
      renderPerson(owner, hint);
    } else {
      renderShared(hint);
    }
    if (refocusChart) {
      content.querySelector('.bar.sel')?.focus();
      refocusChart = false;
    }
  }

  function renderSubnav() {
    const items = [[SHARED, 'Gemensamt'], [me, nameOf(me)]];
    put(subnav, h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': 'Vems utgifter' } },
      items.map(([value, label]) => h('label', {},
        h('input', { type: 'radio', name: 'utgifter-who', value, checked: value === who, on: { change: () => setWho(value) } }),
        h('span', { text: label }),
      )),
    ));
  }

  function renderModeSwitch() {
    put(modeSwitch, h('div', { class: 'segmented compact', attrs: { role: 'radiogroup', 'aria-label': 'Visning' } },
      [['lista', 'Lista'], ['trender', 'Trender']].map(([value, label]) => h('label', {},
        h('input', { type: 'radio', name: 'utgifter-mode', value, checked: value === mode, on: { change: () => setMode(value) } }),
        h('span', { text: label }),
      )),
    ));
  }

  /** Har jag inte satt mitt namn ännu: fråga, så att fliken får rätt namn för oss båda. */
  function nameHint() {
    if (memberOf(me)?.display_name) return null;
    const input = h('input', { class: 'input', placeholder: 'Ditt namn', attrs: { 'aria-label': 'Ditt namn', maxlength: '30', autocomplete: 'given-name' } });
    return h('form', { class: 'card name-hint', on: { submit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const { error } = await sb.rpc('set_my_profile', { p_household: hid, p_name: name });
      if (error) return toastError(error);
      memberOf(me).display_name = name;
      render();
    } } },
      h('div', {}, h('strong', { text: 'Vad heter du?' }), h('p', { class: 'muted small', text: 'Namnet visas på din privata flik här i Utgifter.' })),
      h('div', { class: 'add-expense' }, input, h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Spara' })),
    );
  }

  // ---------- Gemensamt ----------

  function renderShared(hint) {
    const summary = h('section', { class: 'card summary', attrs: { 'aria-label': 'Summering' } });
    const incomeInput = h('input', {
      class: 'input amount-input', type: 'text', id: 'income-' + month,
      value: sharedIncome[month] ? amountForInput(sharedIncome[month]) : '',
      placeholder: '0', attrs: { inputmode: 'decimal', autocomplete: 'off' },
      on: { change: (e) => saveSharedIncome(e.target), keydown: blurOnEnter },
    });
    put(summary,
      h('div', { class: 'label', text: 'Totalt ' + monthOnly(month) }),
      h('div', { class: 'total-line' }, h('div', { class: 'big num', dataset: { ref: 'total' } }), h('span', { dataset: { ref: 'delta' } })),
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
    const ref = (name) => summary.querySelector(`[data-ref="${name}"]`);

    numberUpdaters.push(() => {
      const t = sharedTotals(data, month);
      ref('total').textContent = kr(t.total);
      ref('fixed').textContent = kr(t.fixed);
      ref('variable').textContent = kr(t.variable);
      splitBar(ref('bar'), [['fixed', t.fixed, 'Fasta'], ['variable', t.variable, 'Rörliga']]);
      put(ref('delta'), deltaChip(t.total, sharedTotals(data, addMonths(month, -1)).total, monthOnly(addMonths(month, -1))));
      const left = ref('left');
      const income = sharedIncome[month] || 0;
      if (income) {
        const rest = income - t.total;
        left.className = 'num strong ' + (rest < 0 ? 'neg' : 'pos');
        left.textContent = kr(rest);
      } else {
        left.className = 'muted small';
        left.textContent = 'Fyll i inkomsten för att se vad som blir kvar';
      }
      const totals = win.map((m) => sharedTotals(data, m));
      const sel = totals.find((x) => x.month === month) || totals[totals.length - 1];
      renderChart(cards.overview, {
        title: 'Utveckling',
        months: totals.map((x) => ({ month: x.month, values: { fixed: x.fixed, variable: x.variable }, line: sharedIncome[x.month] || 0 })),
        series: [{ key: 'fixed', label: 'Fasta', color: KINDS.fixed.color }, { key: 'variable', label: 'Rörliga', color: KINDS.variable.color }],
        lineLabel: 'Inkomst',
        selected: month,
        onSelect: selectMonth,
        monthName,
        headRight: trendBadge(sel.total, totals[totals.indexOf(sel) - 1]?.total),
        emptyText: 'Grafen fylls på när ni lägger in utgifter. Tryck på en månad i grafen för att hoppa dit.',
        ariaLabel: 'Utgifter per månad. Tryck på en månad för att visa den.',
      });
    });

    put(content,
      hint,
      summary,
      cards.overview,
      expenseSection('fixed', null, true, 'Gäller från och med månaden de läggs till'),
      expenseSection('variable', null, true, 'Bara ' + monthName(month).toLowerCase()),
    );
    updateNumbers();
  }

  // ---------- Personlig flik ----------

  function renderPerson(owner, hint) {
    const mine = owner === me;
    const pct = pctOf(owner);
    const name = nameOf(owner);
    const summary = h('section', { class: 'card summary person-summary', attrs: { 'aria-label': 'Summering för ' + name } });
    const line = (label, refName, cls = '') => h('div', { class: 'eq-row ' + cls }, h('span', { text: label }), h('span', { class: 'num', dataset: { ref: refName } }));
    put(summary,
      h('div', { class: 'label', dataset: { ref: 'label' } }),
      h('div', { class: 'total-line' }, h('div', { class: 'big num', dataset: { ref: 'big' } }), h('span', { dataset: { ref: 'delta' } })),
      h('div', { class: 'split-bar', attrs: { role: 'img' }, dataset: { ref: 'bar' } }),
      h('div', { class: 'eq' },
        line('Inkomst', 'income'),
        line('− Min andel av gemensamt', 'share'),
        line('− Egna utgifter', 'own'),
        line('Totalt utgifter', 'total', 'muted sub'),
        h('div', { class: 'eq-row result' }, h('span', { text: '= Kvar denna månad' }), h('span', { dataset: { ref: 'left' } })),
      ),
    );
    const ref = (n) => summary.querySelector(`[data-ref="${n}"]`);

    numberUpdaters.push(() => {
      const t = personTotals(data, owner, pct, month);
      const prev = personTotals(data, owner, pct, addMonths(month, -1));
      ref('income').textContent = kr(t.income);
      ref('share').textContent = kr(t.share);
      ref('own').textContent = kr(t.own);
      ref('total').textContent = kr(t.total);
      splitBar(ref('bar'), [['other', t.share, 'Andel av gemensamt'], ['fixed', t.ownFixed, 'Egna fasta'], ['variable', t.ownVariable, 'Egna rörliga']]);
      const left = ref('left');
      if (t.income) {
        ref('label').textContent = 'Kvar i ' + monthOnly(month);
        ref('big').textContent = kr(t.left);
        ref('big').className = 'big num ' + (t.left < 0 ? 'neg' : 'pos');
        left.className = 'num strong ' + (t.left < 0 ? 'neg' : 'pos');
        left.textContent = kr(t.left);
        put(ref('delta'), prev.income ? leftChip(t.left, prev.left, monthOnly(addMonths(month, -1))) : null);
      } else {
        ref('label').textContent = 'Utgifter ' + monthOnly(month);
        ref('big').textContent = kr(t.total);
        ref('big').className = 'big num';
        left.className = 'muted small';
        left.textContent = mine ? 'Lägg till inkomst nedan' : 'Ingen inkomst ifylld';
        put(ref('delta'), deltaChip(t.total, prev.total, monthOnly(addMonths(month, -1))));
      }
      const totals = win.map((m) => personTotals(data, owner, pct, m));
      const sel = totals.find((x) => x.month === month) || totals[totals.length - 1];
      renderChart(cards.overview, {
        title: 'Utveckling',
        months: totals.map((x) => ({ month: x.month, values: { share: x.share, fixed: x.ownFixed, variable: x.ownVariable }, line: x.income })),
        series: [
          { key: 'share', label: 'Andel gemensamt', color: 'var(--c-other)' },
          { key: 'fixed', label: 'Egna fasta', color: KINDS.fixed.color },
          { key: 'variable', label: 'Egna rörliga', color: KINDS.variable.color },
        ],
        lineLabel: 'Inkomst',
        selected: month,
        onSelect: selectMonth,
        monthName,
        headRight: trendBadge(sel.total, totals[totals.indexOf(sel) - 1]?.total),
        emptyText: 'Grafen fylls på när det finns utgifter. Tryck på en månad i grafen för att hoppa dit.',
        ariaLabel: `${name}s utgifter per månad. Tryck på en månad för att visa den.`,
      });
    });

    put(content,
      hint,
      summary,
      cards.overview,
      incomeSection(owner, mine),
      shareSection(owner, pct),
      expenseSection('fixed', owner, mine, 'Egna, gäller från och med månaden de läggs till', 'Egna fasta utgifter'),
      expenseSection('variable', owner, mine, 'Egna, bara ' + monthName(month).toLowerCase(), 'Egna rörliga utgifter'),
    );
    updateNumbers();
  }

  function shareSection(owner, pct) {
    const rows = shareRows(data, month, pct).sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'fixed' ? -1 : 1));
    const cats = categoriesFor(categories, null);
    const colors = colorMap(cats);
    const sumEl = h('span', { class: 'num section-sum' });
    numberUpdaters.push(() => { sumEl.textContent = kr(sum(shareRows(data, month, pct))); });
    return h('details', { class: 'expense-section share-block', open: true },
      h('summary', { class: 'section-head' },
        h('div', {}, h('h2', {}, h('i', { class: 'dot other' }), 'Andel av gemensamt'), h('div', { class: 'muted small', text: `${pct} % av varje gemensam utgift. Ändras i Gemensamt.` })),
        sumEl,
      ),
      rows.length
        ? h('ul', { class: 'rows expense-rows' }, rows.map((r) => h('li', { class: 'expense share-row' },
          h('div', { class: 'name-cell' },
            h('span', { class: 'share-name', text: `Gemensamt: ${r.name} (${pct} %)` }),
            h('div', { class: 'row-meta' }, catLabel(r.category_id, colors), h('span', { class: 'muted', text: r.kind === 'fixed' ? 'fast' : 'rörlig' })),
          ),
          h('span', { class: 'num share-amount', text: kr(r.amount) }),
        )))
        : h('p', { class: 'muted small empty-inline', text: 'Inga gemensamma utgifter den här månaden.' }),
    );
  }

  // ---------- Inkomst (personlig) ----------

  function incomeSection(owner, editable) {
    const items = incomeRows(data, owner, month).sort((a, b) => (b.row.recurring - a.row.recurring) || b.amount - a.amount);
    const sumEl = h('span', { class: 'num section-sum' });
    numberUpdaters.push(() => { sumEl.textContent = kr(sum(incomeRows(data, owner, month))); });

    const descIn = h('input', { class: 'input', placeholder: 'T.ex. Lön', attrs: { 'aria-label': 'Beskrivning av inkomsten', autocomplete: 'off', maxlength: '80' } });
    const amountIn = h('input', { class: 'input amount-input', placeholder: 'Belopp', attrs: { inputmode: 'decimal', 'aria-label': 'Belopp', autocomplete: 'off' } });
    const recurringIn = h('input', { type: 'checkbox', checked: !items.some((i) => i.row.recurring) });
    const addBtn = h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till inkomst', title: 'Lägg till' } }, icon('plus'));
    const form = editable ? h('form', { class: 'add-expense stacked', dataset: { key: 'income' }, on: { submit: async (e) => {
      e.preventDefault();
      const description = descIn.value.trim();
      const amount = parseAmount(amountIn.value);
      if (!description) { toast('Skriv vad inkomsten är, t.ex. "Lön".', { error: true }); descIn.focus(); return; }
      if (Number.isNaN(amount) || !amountIn.value.trim()) { toast('Beloppet ska vara ett tal, t.ex. 32000.', { error: true }); amountIn.focus(); return; }
      addBtn.disabled = true;
      const res = await sb.from('incomes').insert({ household_id: hid, owner, description, amount, month, recurring: recurringIn.checked }).select().single();
      addBtn.disabled = false;
      if (res.error) return toastError(res.error);
      data.incomes.push(res.data);
      render();
      content.querySelector('.add-expense[data-key="income"] input')?.focus();
    } } },
      h('div', { class: 'add-line' }, descIn, amountIn, addBtn),
      h('label', { class: 'check-line' }, recurringIn, h('span', { text: 'Varje månad (t.ex. lön)' })),
    ) : null;

    return h('section', { class: 'expense-section', attrs: { 'aria-label': 'Inkomst' } },
      h('div', { class: 'section-head' },
        h('div', {}, h('h2', {}, h('i', { class: 'dot income' }), 'Inkomst'), h('div', { class: 'muted small', text: 'Lön efter skatt och extra inkomster' })),
        sumEl,
      ),
      items.length
        ? h('ul', { class: 'rows expense-rows' }, items.map((it) => incomeRow(it, editable)))
        : h('p', { class: 'muted small empty-inline', text: editable ? 'Ingen inkomst den här månaden. Lägg till lönen nedan – som återkommande följer den med varje månad.' : 'Ingen inkomst ifylld den här månaden.' }),
      form,
    );
  }

  function incomeRow(it, editable) {
    const r = it.row;
    const descIn = h('input', {
      class: 'input bare', value: r.description, readOnly: !editable,
      attrs: { 'aria-label': 'Beskrivning', autocomplete: 'off', maxlength: '80' },
      on: { change: (e) => saveIncomeDescription(r, e.target), keydown: blurOnEnter },
    });
    const amountIn = h('input', {
      class: 'input bare amount-input num', value: amountForInput(it.amount), readOnly: !editable,
      attrs: { inputmode: 'decimal', 'aria-label': `Belopp för ${r.description || 'inkomst'}`, autocomplete: 'off' },
      on: { change: (e) => saveIncomeAmount(it, e.target), keydown: blurOnEnter, focus: (e) => editable && e.target.select() },
    });
    const meta = h('div', { class: 'row-meta' },
      h('span', { class: 'tag-badge', text: r.recurring ? 'Varje månad' : 'Bara ' + monthOnly(month) }),
      it.adjustment ? h('span', { class: 'muted', text: `justerad (annars ${kr(r.amount)})` }) : null,
      it.adjustment && editable ? h('button', { type: 'button', class: 'link-btn', text: 'Återställ', on: { click: () => resetAdjustment(it) } }) : null,
    );
    return h('li', { class: 'expense' },
      h('div', { class: 'name-cell' }, descIn, meta),
      h('div', { class: 'amount-wrap' }, amountIn, h('span', { class: 'unit', text: 'kr' })),
      editable ? iconButton('trash', `Ta bort ${r.description}`, () => removeIncome(it)) : null,
    );
  }

  async function saveIncomeDescription(r, input) {
    const value = input.value.trim();
    if (!value) { input.value = r.description; toast('Beskrivningen kan inte vara tom.', { error: true }); return; }
    if (value === r.description) return;
    const prev = r.description;
    r.description = value;
    const { error } = await sb.from('incomes').update({ description: value }).eq('id', r.id);
    if (error) { r.description = prev; input.value = prev; toastError(error); }
  }

  async function saveIncomeAmount(it, input) {
    const r = it.row;
    const value = parseAmount(input.value);
    if (Number.isNaN(value)) {
      toast('Beloppet ska vara ett tal, t.ex. 32000.', { error: true });
      input.value = amountForInput(it.amount);
      return;
    }
    input.value = amountForInput(value);
    if (value === it.amount) return;
    const reset = () => { input.value = amountForInput(it.amount); };

    // Redan justerad den här månaden: ändra justeringen (eller ta bort den om beloppet blir som vanligt).
    if (it.adjustment) {
      const res = value === Number(r.amount)
        ? await sb.from('incomes').delete().eq('id', it.adjustment.id)
        : await sb.from('incomes').update({ amount: value }).eq('id', it.adjustment.id);
      if (res.error) { reset(); return toastError(res.error); }
      if (value === Number(r.amount)) data.incomes = data.incomes.filter((x) => x !== it.adjustment);
      else it.adjustment.amount = value;
      return render();
    }

    if (!r.recurring) {
      const { error } = await sb.from('incomes').update({ amount: value }).eq('id', r.id);
      if (error) { reset(); return toastError(error); }
      r.amount = value;
      it.amount = value;
      return updateNumbers();
    }

    const choice = await choose({
      title: `Ändra ${r.description}`,
      message: `${kr(r.amount)} → ${kr(value)}`,
      options: [
        ['only', `Bara ${monthOnly(month)}`],
        ['from', `Från och med ${monthOnly(month)}`, true],
      ],
    });
    if (!choice) return reset();

    if (choice === 'only') {
      const res = await sb.from('incomes').insert({
        household_id: hid, owner: r.owner, description: r.description, amount: value, month, recurring: false, replaces_id: r.id,
      }).select().single();
      if (res.error) { reset(); return toastError(res.error); }
      data.incomes.push(res.data);
      toast(`Justerat för ${monthOnly(month)}. Andra månader är oförändrade.`);
      return render();
    }

    if (r.month === month) {
      const { error } = await sb.from('incomes').update({ amount: value }).eq('id', r.id);
      if (error) { reset(); return toastError(error); }
      r.amount = value;
      return render();
    }
    // Avsluta den gamla raden månaden innan och starta en ny härifrån. Justeringar
    // av senare månader flyttas med till den nya raden.
    const oldEnd = r.end_month;
    const endPrev = addMonths(month, -1);
    const up = await sb.from('incomes').update({ end_month: endPrev }).eq('id', r.id);
    if (up.error) { reset(); return toastError(up.error); }
    const ins = await sb.from('incomes').insert({
      household_id: hid, owner: r.owner, description: r.description, amount: value, month, recurring: true, end_month: oldEnd,
    }).select().single();
    if (ins.error) {
      await sb.from('incomes').update({ end_month: oldEnd }).eq('id', r.id);
      reset();
      return toastError(ins.error);
    }
    await sb.from('incomes').update({ replaces_id: ins.data.id }).eq('replaces_id', r.id).gte('month', month);
    toast(`Ändrat från och med ${monthOnly(month)}. Tidigare månader är oförändrade.`);
    load(false);
  }

  async function resetAdjustment(it) {
    const { error } = await sb.from('incomes').delete().eq('id', it.adjustment.id);
    if (error) return toastError(error);
    data.incomes = data.incomes.filter((x) => x !== it.adjustment);
    render();
  }

  async function removeIncome(it) {
    const r = it.row;
    if (!r.recurring) {
      const ok = await confirmSheet({ title: `Ta bort ${r.description}?`, message: `Den tas bort från ${monthName(month).toLowerCase()}.` });
      if (!ok) return;
      const { error } = await sb.from('incomes').delete().eq('id', r.id);
      if (error) return toastError(error);
      data.incomes = data.incomes.filter((x) => x !== r);
      return render();
    }
    const choice = await choose({
      title: `Ta bort ${r.description}?`,
      message: 'Den återkommer varje månad.',
      options: [
        ['only', `Bara ${monthOnly(month)}`],
        ['from', `Från och med ${monthOnly(month)}`, true, true],
      ],
    });
    if (!choice) return;
    if (choice === 'only') {
      // Ingen inkomst just den här månaden = en justering till 0 kr.
      const res = it.adjustment
        ? await sb.from('incomes').update({ amount: 0 }).eq('id', it.adjustment.id)
        : await sb.from('incomes').insert({ household_id: hid, owner: r.owner, description: r.description, amount: 0, month, recurring: false, replaces_id: r.id });
      if (res.error) return toastError(res.error);
      return load(false);
    }
    const res = r.month >= month
      ? await sb.from('incomes').delete().eq('id', r.id)
      : await sb.from('incomes').update({ end_month: addMonths(month, -1) }).eq('id', r.id);
    if (res.error) return toastError(res.error);
    if (r.month < month) toast(`Borttagen från och med ${monthOnly(month)}. Tidigare månader påverkas inte.`);
    load(false);
  }

  // ---------- Utgiftssektioner (gemensamma och egna) ----------

  function expenseSection(kind, owner, editable, sub, heading = KINDS[kind].heading) {
    const k = KINDS[kind];
    const rows = (kind === 'fixed' ? fixedIn(data, month, owner) : variableIn(data, month, owner)).sort(byName);
    const cats = categoriesFor(categories, owner);
    const colors = colorMap(cats);
    const sectionKey = `${kind}-${owner || SHARED}`;
    const sumEl = h('div', { class: 'num section-sum' });
    numberUpdaters.push(() => {
      sumEl.textContent = kr(sum(kind === 'fixed' ? fixedIn(data, month, owner) : variableIn(data, month, owner)));
    });

    let form = null;
    if (editable) {
      const nameIn = h('input', { class: 'input', placeholder: k.placeholder, attrs: { 'aria-label': `Namn på ny post i ${heading.toLowerCase()}`, autocomplete: 'off', maxlength: '80' } });
      const amountIn = h('input', { class: 'input amount-input', placeholder: 'Belopp', attrs: { inputmode: 'decimal', 'aria-label': 'Belopp', autocomplete: 'off' } });
      const fallback = fallbackOf(cats)?.id;
      const catSel = h('select', { class: 'input cat-select', attrs: { 'aria-label': 'Kategori för ny post' } },
        cats.map((c) => h('option', { value: c.id, text: c.owner ? `${c.name} (egen)` : c.name })));
      catSel.value = lastCategory.get(sectionKey) && cats.some((c) => c.id === lastCategory.get(sectionKey)) ? lastCategory.get(sectionKey) : fallback;
      let catTouched = lastCategory.has(sectionKey);
      catSel.addEventListener('change', () => { catTouched = true; });
      // Heter posten som en kategori (t.ex. "Mat") väljs den kategorin.
      nameIn.addEventListener('input', () => {
        if (catTouched) return;
        const match = cats.find((c) => c.name.toLowerCase() === nameIn.value.trim().toLowerCase());
        catSel.value = match ? match.id : fallback;
      });
      const addBtn = h('button', { type: 'submit', class: 'icon-btn filled', attrs: { 'aria-label': 'Lägg till i ' + heading.toLowerCase(), title: 'Lägg till' } }, icon('plus'));
      form = h('form', { class: 'add-expense stacked', dataset: { key: sectionKey }, on: { submit: async (e) => {
        e.preventDefault();
        const name = nameIn.value.trim();
        const amount = parseAmount(amountIn.value);
        if (!name) { toast(`Skriv vad det gäller, t.ex. "${k.placeholder.replace('T.ex. ', '')}".`, { error: true }); nameIn.focus(); return; }
        if (Number.isNaN(amount)) { toast('Beloppet ska vara ett tal, t.ex. 1234 eller 99,50.', { error: true }); amountIn.focus(); return; }
        const category_id = catSel.value || fallback;
        addBtn.disabled = true;
        const res = kind === 'fixed'
          ? await sb.from(k.table).insert({ household_id: hid, owner, category_id, name, amount, start_month: month, end_month: null }).select().single()
          : await sb.from(k.table).insert({ household_id: hid, owner, category_id, name, amount, month }).select().single();
        addBtn.disabled = false;
        if (res.error) return toastError(res.error);
        if (catTouched) lastCategory.set(sectionKey, category_id);
        (kind === 'fixed' ? data.fixed : data.variable).push(res.data);
        render();
        // Fortsätt skriva nästa post direkt
        content.querySelector(`.add-expense[data-key="${sectionKey}"] input`)?.focus();
      } } },
        h('div', { class: 'add-line' }, nameIn, amountIn, addBtn),
        h('label', { class: 'cat-line' }, h('span', { class: 'muted small', text: 'Kategori' }), catSel),
      );
    }

    const empty = kind === 'fixed'
      ? (owner ? 'Inga egna fasta utgifter.' : 'Inga fasta utgifter den här månaden.') + (editable ? ' Lägg till t.ex. hyra, el och abonnemang nedan – de följer med till kommande månader.' : '')
      : (owner ? 'Inga egna rörliga utgifter den här månaden.' : 'Inga rörliga utgifter den här månaden.') + (editable ? ' Lägg till t.ex. mat eller nöjen nedan.' : '');

    return h('section', { class: 'expense-section', attrs: { 'aria-label': heading } },
      h('div', { class: 'section-head' },
        h('div', {}, h('h2', {}, h('i', { class: 'dot', style: `background:${k.color}` }), heading), h('div', { class: 'muted small', text: sub })),
        sumEl,
      ),
      rows.length ? h('ul', { class: 'rows expense-rows' }, rows.map((r) => expenseRow(r, kind, editable, cats, colors))) : h('p', { class: 'muted small empty-inline', text: empty }),
      form,
    );
  }

  function catLabel(id, colors, onClick) {
    const c = categories.find((x) => x.id === id) || fallbackOf(categories);
    const parts = [h('i', { class: 'dot', style: `background:${colors.get(c?.id) || 'var(--cat-other)'}` }), c?.name || 'Övrigt'];
    return onClick
      ? h('button', { type: 'button', class: 'cat-pill', attrs: { 'aria-label': `Kategori: ${c?.name}. Tryck för att byta.` }, on: { click: onClick } }, parts)
      : h('span', { class: 'cat-pill static' }, parts);
  }

  function expenseRow(r, kind, editable, cats, colors) {
    const nameIn = h('input', {
      class: 'input bare', value: r.name, readOnly: !editable, attrs: { 'aria-label': 'Namn', autocomplete: 'off', maxlength: '80' },
      on: { change: (e) => saveField(r, kind, 'name', e.target), keydown: blurOnEnter },
    });
    const amountIn = h('input', {
      class: 'input bare amount-input num', value: amountForInput(r.amount), readOnly: !editable,
      attrs: { inputmode: 'decimal', 'aria-label': `Belopp för ${r.name}`, autocomplete: 'off' },
      on: { change: (e) => saveField(r, kind, 'amount', e.target), keydown: blurOnEnter, focus: (e) => editable && e.target.select() },
    });
    const since = kind === 'fixed' && r.start_month < month
      ? h('span', { class: 'muted', text: 'sedan ' + monthDate(r.start_month).toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' }).replace('.', '') })
      : null;
    const pill = catLabel(r.category_id, colors, editable ? async () => {
      const id = await pickCategory({ categories: cats, current: r.category_id, title: `Kategori för ${r.name}`, onManage: openManage });
      if (id && id !== r.category_id) saveCategory(r, kind, id);
    } : null);
    return h('li', { class: 'expense' },
      h('div', { class: 'name-cell' }, nameIn, h('div', { class: 'row-meta' }, pill, since)),
      h('div', { class: 'amount-wrap' }, amountIn, h('span', { class: 'unit', text: 'kr' })),
      editable ? iconButton('trash', `Ta bort ${r.name}`, () => removeRow(r, kind)) : null,
    );
  }

  // ---------- Spara ----------

  async function saveCategory(r, kind, id) {
    const prev = r.category_id;
    r.category_id = id;
    render();
    const { error } = await sb.from(KINDS[kind].table).update({ category_id: id }).eq('id', r.id);
    if (error) { r.category_id = prev; render(); toastError(error); }
  }

  async function saveField(r, kind, col, input) {
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

    if (kind !== 'fixed' || r.start_month === month) {
      // Rörlig, eller en fast utgift som började just denna månad: ändra raden direkt.
      const prev = r[col];
      r[col] = value;
      updateNumbers();
      const { error } = await sb.from(KINDS[kind].table).update({ [col]: value }).eq('id', r.id);
      if (error) { r[col] = prev; input.value = col === 'amount' ? amountForInput(prev) : prev; updateNumbers(); toastError(error); }
      return;
    }

    // Fast utgift från en tidigare månad: avsluta den gamla raden och starta en ny från denna månad.
    const oldEnd = r.end_month;
    const endPrev = addMonths(month, -1);
    const up = await sb.from('fixed_expenses').update({ end_month: endPrev }).eq('id', r.id);
    if (up.error) { input.value = col === 'amount' ? amountForInput(r[col]) : r[col]; return toastError(up.error); }
    const fresh = {
      household_id: hid, owner: r.owner ?? null, category_id: r.category_id, name: r.name, amount: r.amount,
      [col]: value, start_month: month, end_month: oldEnd,
    };
    const ins = await sb.from('fixed_expenses').insert(fresh).select().single();
    if (ins.error) {
      await sb.from('fixed_expenses').update({ end_month: oldEnd }).eq('id', r.id);
      input.value = col === 'amount' ? amountForInput(r[col]) : r[col];
      return toastError(ins.error);
    }
    // Den gamla versionen ligger kvar för tidigare månader; raden i vyn blir den nya versionen.
    data.fixed.push({ ...r, end_month: endPrev });
    Object.assign(r, ins.data);
    updateNumbers();
    toast(`Ändrat från och med ${monthOnly(month)}. Tidigare månader är oförändrade.`);
  }

  async function removeRow(r, kind) {
    if (kind === 'fixed') {
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
      if (fromNow) data.fixed = data.fixed.filter((x) => x !== r);
      else r.end_month = addMonths(month, -1);
    } else {
      const ok = await confirmSheet({ title: `Ta bort ${r.name}?`, message: `Den tas bort från ${monthName(month).toLowerCase()}.` });
      if (!ok) return;
      const { error } = await sb.from('variable_expenses').delete().eq('id', r.id);
      if (error) return toastError(error);
      data.variable = data.variable.filter((x) => x !== r);
    }
    render();
  }

  async function saveSharedIncome(input) {
    const value = parseAmount(input.value);
    if (Number.isNaN(value)) {
      toast('Inkomsten ska vara ett tal, t.ex. 32000.', { error: true });
      input.value = sharedIncome[month] ? amountForInput(sharedIncome[month]) : '';
      return;
    }
    const prev = sharedIncome[month];
    sharedIncome[month] = value;
    updateNumbers();
    const { error } = await sb.from('month_income').upsert({ household_id: hid, month, income: value }, { onConflict: 'household_id,month' });
    if (error) { sharedIncome[month] = prev; updateNumbers(); toastError(error); }
  }

  function openManage() {
    if (!loaded) return;
    manageCategories({ all: categories, me, hid, onChange: () => load(false) });
  }

  function blurOnEnter(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  }

  load(true);

  return {
    tables: ['fixed_expenses', 'variable_expenses', 'month_income', 'categories', 'incomes', 'members'],
    refresh: () => load(false),
  };
}

// ---------- Små byggstenar ----------

function splitBar(bar, parts) {
  const shown = parts.filter(([, v]) => v > 0);
  const total = shown.reduce((s, [, v]) => s + v, 0);
  bar.setAttribute('aria-label', parts.map(([, v, label]) => `${label} ${kr(v)}`).join(', '));
  put(bar, shown.length
    ? shown.map(([cls, v]) => h('span', { class: 'seg ' + cls, style: `width:${(v / total) * 100}%` }))
    : h('span', { class: 'seg none' }));
}

/** Välj ett av flera alternativ i ett blad. options: [[värde, text, primär?, fara?]]. */
function choose({ title, message, options }) {
  return new Promise((resolve) => {
    let answer = null;
    const s = sheet({
      title,
      onClose: () => resolve(answer),
      content: [
        message ? h('p', { class: 'muted', text: message, style: 'margin-bottom:16px' }) : null,
        h('div', { class: 'sheet-actions choose' },
          options.map(([value, text, primary, danger]) => h('button', {
            type: 'button', class: 'btn ' + (danger ? 'btn-danger' : primary ? 'btn-primary' : ''), text,
            on: { click: () => { answer = value; s.close(); } },
          })),
        ),
      ],
    });
  });
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

/** "▲ 1 200 kr mot augusti" för Kvar – mer över är bra (grönt). */
function leftChip(now, before, beforeName) {
  const diff = Math.round((now - before) * 100) / 100;
  if (!diff) return h('span', { class: 'delta flat', text: `± 0 kr mot ${beforeName}` });
  const up = diff > 0;
  return h('span', {
    class: 'delta ' + (up ? 'down' : 'up'),
    attrs: { title: `${up ? 'Mer' : 'Mindre'} kvar än i ${beforeName}` },
  }, h('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' }, text: up ? '▲' : '▼' }), `${kr(Math.abs(diff))} mot ${beforeName}`);
}
