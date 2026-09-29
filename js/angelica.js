// Angelica Mode: svagt glitter i bakgrunden, en liten katt som då och då promenerar
// längs flikraden och en pixelkatt som strövar runt på skärmen. Allt är dekoration: pointer-events: none, aria-hidden, och ingenting
// skapas alls när användaren vill ha reducerad rörelse.

const reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
let layer = null;
let cat = null;
let timer = null;
let active = false;

reduce.addEventListener?.('change', () => {
  if (!active) return;
  if (reduce.matches) removeAll();
  else build();
});

export function startDecor() {
  active = true;
  if (!reduce.matches) build();
}

export function stopDecor() {
  active = false;
  removeAll();
}

function removeAll() {
  clearTimeout(timer);
  timer = null;
  layer?.remove();
  cat?.remove();
  layer = cat = null;
  removePixelCat();
}

// ---------- Glitter ----------

function build() {
  if (layer) return;
  layer = document.createElement('div');
  layer.className = 'angelica-sparkles';
  layer.setAttribute('aria-hidden', 'true');
  const count = window.innerWidth < 600 ? 14 : 22;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    // Några få blir små fyruddiga stjärnor, resten mjuka prickar.
    s.className = i % 5 === 0 ? 'spark star' : 'spark';
    s.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    s.style.top = `${(Math.random() * 100).toFixed(2)}%`;
    s.style.setProperty('--d', `${(5 + Math.random() * 6).toFixed(2)}s`);
    s.style.setProperty('--delay', `${(-Math.random() * 10).toFixed(2)}s`);
    s.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
    layer.append(s);
  }
  document.body.append(layer);
  buildCat();
  buildPixelCat();
}

// ---------- Katten ----------

// Egen SVG: en gående och en sittande pose som tonas mellan i CSS-animationen.
const CAT_SVG = `
<svg viewBox="0 0 64 44" width="54" height="37" aria-hidden="true" focusable="false">
  <g class="cat-walk">
    <path class="cat-tail" d="M14 23c-7-1-10-8-7-15"/>
    <g class="legs-a"><path d="M20 29v11"/><path d="M42 29v11"/></g>
    <g class="legs-b"><path d="M25 29v11"/><path d="M46 29v11"/></g>
    <ellipse class="cat-fill" cx="31" cy="24" rx="17" ry="8.5"/>
    <g class="cat-head">
      <path class="cat-fill" d="M43 12l1.5-7.5 5 5.2h4.2l4.8-5.2 1.3 7.7c1.7 1.8 2.7 4 2.7 6.3 0 5.5-4.7 8.7-10 8.7s-10-3.2-10-8.7c0-2.3.6-4.6.5-6.5z"/>
      <path class="cat-ear" d="M45.4 8.6l.8-3 2.4 2.6zM56.2 8.2l1.8-2.6.6 3.1z"/>
      <circle class="cat-eye" cx="50" cy="17.5" r="1.1"/>
      <circle class="cat-eye" cx="56.4" cy="17.5" r="1.1"/>
      <path class="cat-nose" d="M52.4 20.3h1.8l-.9 1z"/>
    </g>
  </g>
  <g class="cat-sit">
    <path class="cat-tail" d="M22 40c-7 1-11-2-9-6"/>
    <path class="cat-fill" d="M20 40c0-9 3-17 11-19 8 2 11 10 11 19z"/>
    <path class="cat-fill" d="M22 13l1.5-7.5 5 5.2h4.2l4.8-5.2 1.3 7.7c1.7 1.8 2.7 4 2.7 6.3 0 5.5-4.7 8.7-10 8.7s-10-3.2-10-8.7c0-2.3.6-4.6.5-6.5z"/>
    <path class="cat-ear" d="M24.4 9.6l.8-3 2.4 2.6zM35.2 9.2l1.8-2.6.6 3.1z"/>
    <path class="cat-eye-closed" d="M27.3 18.6q1.5 1.2 3 0M33.3 18.6q1.5 1.2 3 0"/>
    <path class="cat-nose" d="M31.1 21.2h1.8l-.9 1z"/>
  </g>
</svg>`;

function buildCat() {
  if (cat) return;
  cat = document.createElement('div');
  cat.className = 'angelica-cat';
  cat.setAttribute('aria-hidden', 'true');
  cat.innerHTML = CAT_SVG; // statisk sträng, ingen användartext
  cat.addEventListener('animationend', (e) => {
    if (e.animationName !== 'cat-stroll') return;
    cat.classList.remove('strolling', 'leftward');
    scheduleWalk(20000 + Math.random() * 40000);
  });
  document.body.append(cat);
  scheduleWalk(2500);
}

function scheduleWalk(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!cat) return;
    // Pausa när appen inte syns – ingen idé att animera i bakgrunden.
    if (document.visibilityState !== 'visible') return scheduleWalk(10000);
    cat.classList.toggle('leftward', Math.random() < 0.5);
    cat.style.setProperty('--sit-at', `${Math.round(25 + Math.random() * 50)}vw`);
    void cat.offsetWidth; // starta om animationen
    cat.classList.add('strolling');
  }, ms);
}

// ---------- Pixelkatten ----------
// Ritas från en pixelkarta (16 × 12) som små rutor med skarpa kanter.
// o = kontur, f = päls, l = ljus päls, p = rosa, e = öga

const PIXEL_FRAMES = {
  walk1: [
    '................',
    '..........o...o.',
    '.........opo.opo',
    '..o......offfffo',
    '.ofo.....ofefefo',
    '.ofo.....offpffo',
    '..ofoooooofflllo',
    '...offffffffllo.',
    '...offffffffffo.',
    '...offoooooooffo',
    '...ofo.......of.',
    '...oo........oo.',
  ],
  walk2: [
    '................',
    '..........o...o.',
    '.........opo.opo',
    '.o.......offfffo',
    'ofo......ofefefo',
    '.ofo.....offpffo',
    '..ofoooooofflllo',
    '...offffffffllo.',
    '...offffffffffo.',
    '....offoooooffo.',
    '....ofo.....ofo.',
    '.....oo.....oo..',
  ],
  sit: [
    '......o...o.....',
    '.....opo.opo....',
    '.....offfffo....',
    '.....ofefefo....',
    '.....offpffo....',
    '......oflllo....',
    '.....offlllfo...',
    '.....offlllfo...',
    '....offfffffo...',
    '....offfffffo...',
    '.oooofofffofo...',
    '..ooooooooooo...',
  ],
  sleep: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........o...o.',
    '.....ooooopo.opo',
    '...ooffffoffffff',
    '..offfffffoeefee',
    '.offffffffoffpff',
    '.ofoooooooooooo.',
    '..oo............',
  ],
};
const PX = 3;                 // skärmpixlar per kattpixel → 48 × 36 px
const CAT_W = 16 * PX, CAT_H = 12 * PX;
const SPEED = 42;             // px per sekund
const AVOID = 'button, a, input, textarea, select, label, [role="button"], [role="gridcell"], .item-image';

let pcat = null;
let pTimer = null;
let pos = { x: 0, y: 0 };

function pixelSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 12');
  svg.setAttribute('width', CAT_W);
  svg.setAttribute('height', CAT_H);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [name, rows] of Object.entries(PIXEL_FRAMES)) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'px-' + name);
    rows.forEach((row, y) => {
      // Rutor i samma färg bredvid varandra slås ihop till ett rect – färre element.
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        let w = 1;
        while (row[x + w] === ch) w++;
        if (ch !== '.') {
          const r = document.createElementNS(NS, 'rect');
          r.setAttribute('x', x);
          r.setAttribute('y', y);
          r.setAttribute('width', w);
          r.setAttribute('height', 1);
          r.setAttribute('class', 'c-' + ch);
          g.append(r);
        }
        x += w;
      }
    });
    svg.append(g);
  }
  return svg;
}

function buildPixelCat() {
  if (pcat) return;
  pcat = document.createElement('div');
  pcat.className = 'pixel-cat sitting';
  pcat.setAttribute('aria-hidden', 'true');
  const zzz = document.createElement('span');
  zzz.className = 'zzz';
  zzz.textContent = 'z';
  pcat.append(pixelSvg(), zzz);
  const b = bounds();
  pos = { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y1 };
  place(0);
  document.body.append(pcat);
  pTimer = setTimeout(nextMove, 1500);
}

function removePixelCat() {
  clearTimeout(pTimer);
  pTimer = null;
  pcat?.remove();
  pcat = null;
}

/** Området katten får röra sig i: hela skärmen utom flikraden. */
function bounds() {
  const tab = document.querySelector('.tabbar');
  const bottom = tab ? tab.getBoundingClientRect().top : window.innerHeight;
  return { x0: 6, x1: Math.max(6, window.innerWidth - CAT_W - 6), y0: 10, y1: Math.max(10, bottom - CAT_H - 4) };
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/** Välj ett mål. På bred skärm håller katten sig oftast i marginalerna bredvid innehållet. */
function pickTarget() {
  const b = bounds();
  const side = (window.innerWidth - 740) / 2;
  let x;
  if (side > CAT_W + 20 && Math.random() < 0.75) {
    x = Math.random() < 0.5
      ? 6 + Math.random() * (side - CAT_W - 12)
      : window.innerWidth - side + 6 + Math.random() * (side - CAT_W - 12);
  } else {
    // Inte för långa promenader – högst ungefär halva skärmen åt gången.
    const maxStep = Math.max(160, window.innerWidth / 2);
    x = pos.x + (Math.random() * 2 - 1) * maxStep;
  }
  const y = b.y0 + Math.random() * (b.y1 - b.y0);
  return { x: clamp(x, b.x0, b.x1), y: clamp(y, b.y0, b.y1) };
}

/** Ligger platsen ovanpå något man kan trycka på? Katten själv har pointer-events: none och räknas inte. */
function overInteractive({ x, y }) {
  const pts = [[x + 6, y + 6], [x + CAT_W - 6, y + 6], [x + 6, y + CAT_H - 4], [x + CAT_W - 6, y + CAT_H - 4], [x + CAT_W / 2, y + CAT_H / 2]];
  return pts.some(([px, py]) => document.elementFromPoint(px, py)?.closest(AVOID));
}

function place(ms) {
  pcat.style.transitionDuration = `${ms}ms`;
  pcat.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
}

function nextMove() {
  if (!pcat) return;
  if (document.visibilityState !== 'visible') { pTimer = setTimeout(nextMove, 5000); return; }
  const target = pickTarget();
  const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
  const ms = Math.max(600, (dist / SPEED) * 1000);
  pcat.classList.toggle('left', target.x < pos.x);
  pcat.classList.remove('sitting', 'sleeping');
  pcat.classList.add('walking');
  pos = target;
  place(ms);
  pTimer = setTimeout(arrive, ms);
}

function arrive() {
  if (!pcat) return;
  // Vila bara där den inte skymmer knappar, länkar eller fält – annars går den vidare direkt.
  const r = Math.random();
  if (r < 0.25 || overInteractive(pos)) { pTimer = setTimeout(nextMove, 50); return; }
  pcat.classList.remove('walking');
  if (r < 0.8) {
    pcat.classList.add('sitting');
    pTimer = setTimeout(nextMove, 3000 + Math.random() * 5000);
  } else {
    pcat.classList.add('sleeping');
    pTimer = setTimeout(nextMove, 9000 + Math.random() * 9000);
  }
}

// Håll katten inom skärmen när fönstret ändrar storlek.
window.addEventListener('resize', () => {
  if (!pcat) return;
  const b = bounds();
  pos = { x: clamp(pos.x, b.x0, b.x1), y: clamp(pos.y, b.y0, b.y1) };
  place(0);
});
