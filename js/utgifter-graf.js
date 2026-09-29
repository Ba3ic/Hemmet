// Graf över utgifter per månad: staplade staplar (fasta, rörliga, övrigt) och inkomst som linje.
// Ritas i SVG utan bibliotek. Färger kommer från CSS-variabler, så den följer temat.
import { h, put, kr } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const SERIES = [
  ['fixed', 'Fasta'],
  ['variable', 'Rörliga'],
  ['other', 'Övrigt'],
];

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
const axisLabel = (v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', ',')} tkr` : `${Math.round(v)} kr`);
const shortMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
};

/**
 * Rita grafen i el.
 * opts: { months: [{month, fixed, variable, other, total, income}], selected, onSelect(m, viaKeyboard), monthName(m), focusSelected }
 */
export function renderChart(el, opts) {
  el._chartOpts = opts;
  if (!el._ro && 'ResizeObserver' in window) {
    // Rita om när bredden ändras (t.ex. när telefonen vrids).
    let lastW = 0;
    el._ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      if (w && Math.abs(w - lastW) > 4) { lastW = w; draw(el, el._chartOpts); }
    });
    el._ro.observe(el);
  }
  draw(el, opts);
}

function draw(el, { months, selected, onSelect, monthName, focusSelected }) {
  const sel = months.find((m) => m.month === selected) || months[months.length - 1];
  const selIdx = months.indexOf(sel);
  const prev = months[selIdx - 1];
  const maxV = Math.max(0, ...months.map((m) => Math.max(m.total, m.income)));

  const head = h('div', { class: 'chart-head' },
    h('div', {},
      h('h2', { text: 'Utveckling' }),
      h('div', { class: 'muted small', text: `${monthName(months[0].month)} – ${monthName(months[months.length - 1].month)}` }),
    ),
    trend(sel, prev),
  );
  const legend = h('div', { class: 'legend chart-legend' },
    SERIES.map(([k, label]) => h('span', {}, h('i', { class: 'dot ' + k }), label)),
    months.some((m) => m.income) ? h('span', {}, h('i', { class: 'line-key' }), 'Inkomst') : null,
  );

  if (!maxV) {
    put(el, head, h('p', { class: 'muted small empty-inline', text: 'Grafen fylls på när ni lägger in utgifter. Tryck på en månad i grafen för att hoppa dit.' }));
    return;
  }

  const W = Math.max(260, Math.round(el.clientWidth - 32 || 600));
  const H = W < 480 ? 200 : 240;
  const padL = 44, padR = 8, padT = 12, padB = 26;
  const plotH = H - padT - padB;
  const step = niceStep(maxV / 3);
  const top = Math.ceil((maxV * 1.04) / step) * step;
  const y = (v) => padT + plotH * (1 - v / top);
  const band = (W - padL - padR) / months.length;
  const bw = Math.min(30, band * 0.62);
  const cx = (i) => padL + band * i + band / 2;

  const svg = s('svg', {
    class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group',
    'aria-label': 'Utgifter per månad. Tryck på en månad för att visa den.',
  });

  // Rutnät och y-axel
  for (let v = 0; v <= top + 0.5; v += step) {
    svg.append(
      s('line', { class: 'grid', x1: padL, x2: W - padR, y1: y(v), y2: y(v) }),
      s('text', { class: 'axis', x: padL - 6, y: y(v) + 4, 'text-anchor': 'end' }, axisLabel(v)),
    );
  }

  const defs = s('defs');
  svg.append(defs);
  const uid = Math.random().toString(36).slice(2, 7);

  months.forEach((m, i) => {
    const isSel = m === sel;
    const x = cx(i) - bw / 2;
    const g = s('g', {
      class: 'bar' + (isSel ? ' sel' : ''), tabindex: isSel ? '0' : '-1', role: 'button',
      'aria-label': `${monthName(m.month)}: totalt ${kr(m.total)}` + (m.income ? `, inkomst ${kr(m.income)}` : '') + (isSel ? ' (visas)' : ''),
      'aria-pressed': String(isSel),
    });
    g.append(s('title', {}, `${monthName(m.month)}\nFasta ${kr(m.fixed)}\nRörliga ${kr(m.variable)}\nÖvrigt ${kr(m.other)}\nTotalt ${kr(m.total)}` + (m.income ? `\nInkomst ${kr(m.income)}` : '')));
    // Markering bakom vald månad + osynlig yta som tar emot tryck i hela kolumnen
    g.append(s('rect', { class: isSel ? 'band sel' : 'band', x: padL + band * i + 1, y: padT - 6, width: band - 2, height: plotH + 6 + padB, rx: 8 }));
    if (m.total > 0) {
      const clipId = `c${uid}${i}`;
      const barTop = y(m.total);
      defs.append(s('clipPath', { id: clipId }, s('rect', { x, y: barTop, width: bw, height: y(0) - barTop, rx: Math.min(6, bw / 3) })));
      const segs = s('g', { 'clip-path': `url(#${clipId})` });
      let acc = 0;
      for (const [k] of SERIES) {
        const v = m[k];
        if (v <= 0) continue;
        segs.append(s('rect', { class: 'seg-' + k, x, y: y(acc + v), width: bw, height: y(acc) - y(acc + v) + 0.5 }));
        acc += v;
      }
      g.append(segs);
    } else {
      g.append(s('rect', { class: 'seg-empty', x, y: y(0) - 2, width: bw, height: 2, rx: 1 }));
    }
    const label = band < 34 ? shortMonth(m.month).slice(0, 3) : shortMonth(m.month);
    g.append(s('text', { class: 'axis x' + (isSel ? ' sel' : ''), x: cx(i), y: H - 8, 'text-anchor': 'middle' }, label));

    g.addEventListener('click', (e) => onSelect(m.month, e.detail === 0));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m.month, true); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = months[i + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (next) onSelect(next.month, true);
      }
    });
    svg.append(g);
  });

  // Inkomstlinje (bryts där inkomst saknas)
  let d = '';
  let pen = false;
  months.forEach((m, i) => {
    if (m.income > 0) { d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(m.income).toFixed(1)} `; pen = true; }
    else pen = false;
  });
  if (d) {
    const line = s('g', { class: 'income', 'aria-hidden': 'true' }, s('path', { d }));
    months.forEach((m, i) => { if (m.income > 0) line.append(s('circle', { cx: cx(i), cy: y(m.income), r: m === sel ? 4.5 : 3 })); });
    svg.append(line);
  }

  put(el, head, h('div', { class: 'chart-wrap' }, svg), legend);
  if (focusSelected) svg.querySelector('.bar.sel')?.focus();
}

function trend(cur, prev) {
  if (!cur || !prev || !prev.total || !cur.total) return h('span', { class: 'muted small', text: cur ? kr(cur.total) : '' });
  const pct = Math.round(((cur.total - prev.total) / prev.total) * 100);
  const up = pct > 0;
  return h('div', { class: 'chart-trend' },
    h('strong', { class: 'num', text: kr(cur.total) }),
    h('span', { class: 'delta ' + (pct === 0 ? 'flat' : up ? 'up' : 'down') },
      pct === 0 ? '± 0 %' : [h('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' }, text: up ? '▲' : '▼' }), `${Math.abs(pct)} %`],
    ),
  );
}
