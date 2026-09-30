// Graf över månader: staplade staplar (valfria serier) och en valfri linje (t.ex. inkomst).
// Med signed: true kan värdena vara negativa (t.ex. "Kvar"), och staplarna färgas grönt/rött.
// Ritas i SVG utan bibliotek. Färger kommer från CSS-variabler, så den följer temat.
import { h, put, kr } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const GAP = 2; // yta mellan staplade segment

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
const axisLabel = (v) => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  return a >= 1000 ? `${sign}${String(Math.round(a / 100) / 10).replace('.', ',')} tkr` : `${sign}${Math.round(a)} kr`;
};
const shortMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
};

/**
 * Rita grafen i el.
 * opts: {
 *   title, subtitle, headRight (nod),
 *   months: [{ month, values: { key: belopp }, line? }],
 *   series: [{ key, label, color }]   color = CSS-värde, t.ex. 'var(--c-fixed)'
 *   lineLabel,                         namn på linjen (visas i förklaringen om någon månad har värde)
 *   signed,                            tillåt negativa värden (en serie, grönt/rött)
 *   selected, onSelect(m, viaKeyboard), monthName(m), focusSelected, emptyText, ariaLabel
 * }
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

function draw(el, o) {
  const { months, series, selected, onSelect, monthName, focusSelected, signed } = o;
  const totalOf = (m) => series.reduce((acc, se) => acc + (m.values[se.key] || 0), 0);
  const sel = months.find((m) => m.month === selected) || months[months.length - 1];

  const head = h('div', { class: 'chart-head' },
    h('div', {},
      h('h2', { text: o.title }),
      h('div', { class: 'muted small', text: o.subtitle || `${monthName(months[0].month)} – ${monthName(months[months.length - 1].month)}` }),
    ),
    o.headRight || null,
  );
  const hasLine = months.some((m) => m.line);
  const legend = series.length > 1 || hasLine
    ? h('div', { class: 'legend chart-legend' },
      series.length > 1 ? series.map((se) => h('span', {}, h('i', { class: 'dot', style: `background:${se.color}` }), se.label)) : null,
      hasLine ? h('span', {}, h('i', { class: 'line-key' }), o.lineLabel) : null,
    )
    : null;

  const totals = months.map(totalOf);
  const maxV = Math.max(0, ...totals, ...months.map((m) => m.line || 0));
  const minV = signed ? Math.min(0, ...totals) : 0;
  if (!maxV && !minV) {
    put(el, head, h('p', { class: 'muted small empty-inline', text: o.emptyText || 'Grafen fylls på när ni lägger in utgifter.' }));
    return;
  }

  const W = Math.max(260, Math.round(el.clientWidth - 32 || 600));
  const H = W < 480 ? 200 : 240;
  const padL = 46, padR = 8, padT = 12, padB = 26;
  const plotH = H - padT - padB;
  const step = niceStep((maxV - minV) / 3);
  const top = maxV > 0 ? Math.ceil((maxV * 1.04) / step) * step : 0;
  const bottom = minV < 0 ? Math.floor((minV * 1.04) / step) * step : 0;
  const y = (v) => padT + plotH * ((top - v) / (top - bottom));
  const band = (W - padL - padR) / months.length;
  const bw = Math.min(30, band * 0.62);
  const cx = (i) => padL + band * i + band / 2;
  const r = Math.min(4, bw / 3);

  const svg = s('svg', {
    class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group',
    'aria-label': o.ariaLabel || 'Belopp per månad. Tryck på en månad för att visa den.',
  });

  // Rutnät och y-axel
  for (let v = bottom; v <= top + step / 100; v += step) {
    svg.append(
      s('line', { class: 'grid' + (Math.abs(v) < step / 100 ? ' zero' : ''), x1: padL, x2: W - padR, y1: y(v), y2: y(v) }),
      s('text', { class: 'axis', x: padL - 6, y: y(v) + 4, 'text-anchor': 'end' }, axisLabel(v)),
    );
  }

  const defs = s('defs');
  svg.append(defs);
  const uid = Math.random().toString(36).slice(2, 7);

  months.forEach((m, i) => {
    const isSel = m === sel;
    const x = cx(i) - bw / 2;
    const total = totals[i];
    const lines = series.filter((se) => m.values[se.key]).map((se) => `${se.label} ${kr(m.values[se.key])}`);
    const summary = series.length > 1 ? [...lines, `Totalt ${kr(total)}`] : [`${series[0].label} ${kr(total)}`];
    if (m.line) summary.push(`${o.lineLabel} ${kr(m.line)}`);
    const g = s('g', {
      class: 'bar' + (isSel ? ' sel' : ''), tabindex: isSel ? '0' : '-1', role: 'button',
      'aria-label': `${monthName(m.month)}: ${summary.join(', ')}` + (isSel ? ' (visas)' : ''),
      'aria-pressed': String(isSel),
    });
    g.append(s('title', {}, `${monthName(m.month)}\n${summary.join('\n')}`));
    // Markering bakom vald månad + osynlig yta som tar emot tryck i hela kolumnen
    g.append(s('rect', { class: isSel ? 'band sel' : 'band', x: padL + band * i + 1, y: padT - 6, width: band - 2, height: plotH + 6 + padB, rx: 8 }));

    if (signed && total !== 0) {
      const y0 = y(0), y1 = y(total);
      const clipId = `c${uid}${i}`;
      const yTop = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
      defs.append(s('clipPath', { id: clipId }, s('rect', { x, y: yTop, width: bw, height: hgt, rx: r })));
      // Rundad bara i datadelen: platt mot nollinjen
      g.append(s('g', { 'clip-path': `url(#${clipId})` },
        s('rect', { class: total < 0 ? 'seg-neg' : 'seg-pos', x, y: total < 0 ? yTop - r : yTop, width: bw, height: hgt + r })));
    } else if (!signed && total > 0) {
      const clipId = `c${uid}${i}`;
      const barTop = y(total);
      defs.append(s('clipPath', { id: clipId }, s('rect', { x, y: barTop, width: bw, height: y(0) - barTop + r, rx: r })));
      const segs = s('g', { 'clip-path': `url(#${clipId})` });
      let acc = 0;
      const present = series.filter((se) => (m.values[se.key] || 0) > 0);
      present.forEach((se, k) => {
        const v = m.values[se.key];
        const yTop = y(acc + v);
        const isTop = k === present.length - 1;
        // Ett glapp mot segmentet ovanför, så att färgerna hålls isär
        const height = Math.max(0.5, y(acc) - yTop - (isTop ? 0 : GAP));
        segs.append(s('rect', { style: `fill:${se.color}`, class: 'seg', x, y: isTop ? yTop : yTop + GAP, width: bw, height }));
        acc += v;
      });
      g.append(segs);
    } else {
      g.append(s('rect', { class: 'seg-empty', x, y: y(0) - 1, width: bw, height: 2, rx: 1 }));
    }
    const label = band < 34 ? shortMonth(m.month).slice(0, 3) : shortMonth(m.month);
    g.append(s('text', { class: 'axis x' + (isSel ? ' sel' : ''), x: cx(i), y: H - 8, 'text-anchor': 'middle' }, label));

    if (onSelect) {
      g.addEventListener('click', (e) => onSelect(m.month, e.detail === 0));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m.month, true); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const next = months[i + (e.key === 'ArrowLeft' ? -1 : 1)];
          if (next) onSelect(next.month, true);
        }
      });
    }
    svg.append(g);
  });

  // Linje (bryts där värde saknas)
  let d = '';
  let pen = false;
  months.forEach((m, i) => {
    if (m.line > 0) { d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(m.line).toFixed(1)} `; pen = true; }
    else pen = false;
  });
  if (d) {
    const line = s('g', { class: 'income', 'aria-hidden': 'true' }, s('path', { d }));
    months.forEach((m, i) => { if (m.line > 0) line.append(s('circle', { cx: cx(i), cy: y(m.line), r: m === sel ? 4.5 : 3 })); });
    svg.append(line);
  }

  put(el, head, h('div', { class: 'chart-wrap' }, svg), legend);
  if (focusSelected) svg.querySelector('.bar.sel')?.focus();
}

/** Belopp + ▲▼ % mot föregående månad (ökade utgifter i varningsfärg). invert: ökning är bra (t.ex. Kvar). */
export function trendBadge(cur, prev, { invert = false } = {}) {
  if (cur == null) return null;
  const big = h('strong', { class: 'num', text: kr(cur) });
  if (!prev || !cur) return h('div', { class: 'chart-trend' }, big);
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const up = pct > 0;
  const good = invert ? up : !up;
  return h('div', { class: 'chart-trend' },
    big,
    h('span', { class: 'delta ' + (pct === 0 ? 'flat' : good ? 'down' : 'up') },
      pct === 0 ? '± 0 %' : [h('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' }, text: up ? '▲' : '▼' }), `${Math.abs(pct)} %`],
    ),
  );
}
