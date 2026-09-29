// Angelica Mode: svagt glitter i bakgrunden och en liten katt som då och då promenerar
// längs flikraden. Allt är dekoration: pointer-events: none, aria-hidden, och ingenting
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
