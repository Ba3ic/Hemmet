// Gemensamma UI-hjälpare. All användartext sätts via textContent – aldrig innerHTML.

// ---------- DOM ----------

/**
 * Bygg ett element. props: class, text, attrs (objekt), dataset, on (objekt med händelser),
 * samt vanliga egenskaper (type, value, checked, disabled, hidden, id, href …).
 * Barn kan vara noder, strängar (blir textnoder), arrayer eller null/false (hoppas över).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av != null && av !== false) el.setAttribute(a, av === true ? '' : av); }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'href') { const safe = safeUrl(v, { allowRelative: true }); if (safe) el.setAttribute('href', safe); }
    else el[k] = v;
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Lägg till barn (samma regler som h(): arrayer plattas ut, null/false hoppas över). */
export function add(el, ...children) {
  append(el, children);
  return el;
}

/** Ersätt allt innehåll i el med children. */
export function put(el, ...children) {
  return add(clear(el), ...children);
}

// ---------- Länkar ----------

/** Returnera en säker URL-sträng (bara http/https) eller null. */
export function safeUrl(input, { allowRelative = false } = {}) {
  if (!input) return null;
  const s = String(input).trim();
  if (allowRelative && (s.startsWith('#') || /^\.{0,2}\/?[\w-]/.test(s)) && !/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  let candidate = s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

export function prettyHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ---------- Ikoner (statiska SVG-strängar, ingen användartext) ----------

const P = {
  today: '<path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.2h.01M12 17.2h.01"/>',
  list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="m4 6.3 1.2 1.2L7.4 5.3M4 11.8l1.2 1.2 2.2-2.2"/><circle cx="5.6" cy="17.5" r="1.2"/>',
  note: '<path d="M6 3.5h9l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14.5 3.5V8h4.5M8.5 12.5h7M8.5 16h5"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2"/><path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5z"/><path d="M16 14.5h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9.5 8.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V19a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  broom: '<path d="M14 4 9.5 12.5M6 13h8l1.5 7h-11z"/><path d="M8.5 16.5v3.5M12 16.5v3.5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  offline: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4.4-2.4M19 12.8a10 10 0 0 0-2.1-1.5M2 9a15 15 0 0 1 4.2-2.6M22 9a15 15 0 0 0-11.1-3.9M12 20h.01"/>',
  drop: '<path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  cart: '<circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/><path d="M3 4h2.2l2.3 11h10.8l2-7.5H6.2"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = P[name] || '';
  return svg;
}

export function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: 'icon-btn ' + cls, attrs: { 'aria-label': label, title: label }, on: { click: onClick } }, icon(name));
}

// ---------- Format (sv-SE) ----------

export const LOCALE = 'sv-SE';
const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234 → "1 234 kr" */
export function kr(value) {
  const n = Number(value) || 0;
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? nf0 : nf2).format(r) + ' kr';
}

/** Tolka ett belopp som användaren skrivit: "1 234,50" → 1234.5. Returnerar NaN vid fel. */
export function parseAmount(str) {
  const s = String(str ?? '').replace(/[\s kr]/gi, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Formatera tal för ett redigerbart fält: 1234.5 → "1234,5" */
export function amountForInput(n) {
  return String(Number(n) || 0).replace('.', ',');
}

export const fmt = {
  weekday: (d) => d.toLocaleDateString(LOCALE, { weekday: 'long' }),
  dayMonth: (d) => d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' }),
  full: (d) => d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
  short: (d) => d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }),
  monthYear: (d) => d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }),
  time: (d) => d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  relativeUpdated(d) {
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'nyss';
    if (sameDay(d, now)) return fmt.time(d);
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'igår';
    if (diff < 6 * 86400) return d.toLocaleDateString(LOCALE, { weekday: 'long' });
    return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  },
};

export function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ---------- Datum ----------

export const pad = (n) => String(n).padStart(2, '0');
/** Lokalt datum → "YYYY-MM-DD" */
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Lokalt datum → "YYYY-MM" */
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** "YYYY-MM-DD" + "HH:MM" → Date i lokal tid */
export function fromLocal(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}
/** Måndag = 0 … söndag = 6 */
export const weekdayMon = (d) => (d.getDay() + 6) % 7;

// ---------- Fel ----------

/** Översätt fel från Supabase/nätet till begriplig svenska med en ledtråd om vad man kan göra. */
export function errorMessage(err) {
  const msg = String(err?.message || err?.error_description || err || '');
  const code = err?.code || '';
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Ingen kontakt med servern. Kontrollera internetanslutningen och försök igen.';
  }
  if (/invalid login credentials/i.test(msg)) return 'Fel e-post eller lösenord. Kontrollera stavningen och försök igen.';
  if (/already registered|already been registered|user_already_exists/i.test(msg)) return 'Det finns redan ett konto med den e-postadressen. Logga in i stället.';
  if (/email not confirmed/i.test(msg)) return 'E-postadressen är inte bekräftad ännu. Klicka på länken i mejlet vi skickade och logga sedan in.';
  if (/password should be at least|weak.?password/i.test(msg)) return 'Lösenordet är för svagt. Använd minst 8 tecken.';
  if (/unable to validate email|invalid email|email address .* is invalid/i.test(msg)) return 'E-postadressen ser inte giltig ut. Kontrollera stavningen.';
  if (/rate limit|too many requests/i.test(msg) || err?.status === 429) return 'För många försök på kort tid. Vänta en minut och försök igen.';
  if (/ogiltig kod/i.test(msg)) return 'Koden hittades inte. Kontrollera att du skrivit alla 8 tecken rätt.';
  if (/inte inloggad|jwt|not authenticated/i.test(msg)) return 'Du är utloggad. Logga in igen och försök på nytt.';
  if (code === '42703' || /column .* does not exist/i.test(msg)) return 'Databasen saknar nya kolumner. Kör migreringen i mappen migrations/ i Supabase (SQL Editor) och ladda om sidan.';
  if (/row-level security|permission denied/i.test(msg) || code === '42501') return 'Du har inte behörighet att göra det här. Kontrollera att du är med i hushållet.';
  if (/payload too large|exceeded the maximum/i.test(msg)) return 'Filen är för stor. Välj en mindre bild.';
  return msg ? `Något gick fel: ${msg}` : 'Något gick fel. Försök igen.';
}

// ---------- Toast ----------

let toastHost;
export function toast(message, { error = false, ms = 3200 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast' + (error ? ' error' : ''), text: message });
  toastHost.append(t);
  setTimeout(() => t.remove(), error ? ms + 2500 : ms);
}

export const toastError = (err) => toast(errorMessage(err), { error: true });

// ---------- Blad (bottom sheet) ----------

let openSheets = 0;
export const isSheetOpen = () => openSheets > 0;

/**
 * Öppna ett blad. content: nod eller array. Returnerar { el, body, close }.
 * Stängs med Esc, klick på bakgrunden eller close().
 */
export function sheet({ title, content, onClose, label }) {
  const prevFocus = document.activeElement;
  const titleId = 'sheet-' + Math.random().toString(36).slice(2, 8);
  const body = h('div', { class: 'sheet-body' }, content);
  const panel = h('div', {
    class: 'sheet',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null, 'aria-label': title ? null : label },
  },
    title ? h('div', { class: 'sheet-head' },
      h('h2', { id: titleId, text: title }),
      iconButton('close', 'Stäng', () => close()),
    ) : null,
    body,
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
  let closed = false;

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(e, panel);
  });

  function close(result) {
    if (closed) return;
    closed = true;
    openSheets--;
    const done = () => {
      backdrop.remove();
      if (!openSheets) document.body.style.overflow = '';
      if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
      onClose?.(result);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else { backdrop.classList.add('closing'); setTimeout(done, 170); }
  }

  openSheets++;
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);
  requestAnimationFrame(() => {
    const first = panel.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select') || panel.querySelector('button');
    first?.focus({ preventScroll: true });
  });
  return { el: panel, body, close };
}

function trapFocus(e, root) {
  const f = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Bekräftelseblad. Returnerar Promise<boolean>. */
export function confirmSheet({ title, message, confirm = 'Ta bort', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    const s = sheet({
      title,
      onClose: () => resolve(answer),
      content: [
        message ? h('p', { class: 'muted', text: message, style: 'margin-bottom:16px' }) : null,
        h('div', { class: 'sheet-actions' },
          h('button', { type: 'button', class: 'btn', text: 'Avbryt', on: { click: () => s.close() } }),
          h('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), text: confirm, on: { click: () => { answer = true; s.close(); } } }),
        ),
      ],
    });
  });
}

// ---------- Små byggstenar ----------

export function emptyState({ iconName, title, text, action }) {
  return h('div', { class: 'empty' },
    iconName ? icon(iconName) : null,
    h('h2', { text: title }),
    text ? h('p', { text }) : null,
    action || null,
  );
}

export function errorBox(err, retry) {
  return h('div', { class: 'error-box', attrs: { role: 'alert' } },
    h('strong', { text: 'Kunde inte hämta datan' }),
    h('p', { text: errorMessage(err) }),
    retry ? h('button', { type: 'button', class: 'btn btn-sm', text: 'Försök igen', on: { click: retry } }) : null,
  );
}

export function skeleton(n = 3) {
  return Array.from({ length: n }, () => h('div', { class: 'skeleton', attrs: { 'aria-hidden': 'true' } }));
}

export function field(labelText, input, hint) {
  return h('label', { class: 'field' }, h('span', { text: labelText }), input, hint ? h('small', { class: 'muted small', text: hint }) : null);
}

export function formError() {
  return h('div', { class: 'form-error', hidden: true, attrs: { role: 'alert' } });
}
export function showFormError(box, err) {
  if (!err) { box.hidden = true; box.textContent = ''; return; }
  box.textContent = typeof err === 'string' ? err : errorMessage(err);
  box.hidden = false;
}

/** Enkel debounce */
export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Sätt knappens "arbetar"-läge */
export async function busy(button, fn) {
  const prev = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { button.disabled = prev; button.removeAttribute('aria-busy'); }
}
