// Idag – startsida: hälsning, väder från SMHI och kalenderhändelser.
import {
  h, icon, iconButton, put, add, fmt, capitalize, ymd, startOfDay, addDays, sameDay, emptyState,
  errorBox,
} from './ui.js';
import { fetchEvents, occursOn, sortEvents, eventRow, eventSheet, timeText } from './events.js';
import { getWeather, weatherIcon, describe, isNight, fmtTemp, fmtMm, PLACE } from './weather.js';

export const title = 'Idag';

export function greeting(d = new Date()) {
  const hr = d.getHours();
  if (hr < 5) return 'God natt';
  if (hr < 10) return 'God morgon';
  if (hr < 13) return 'God förmiddag';
  if (hr < 18) return 'God eftermiddag';
  return 'God kväll';
}

export function mount(root, { navigate }) {
  const greet = h('h1');
  const dateLine = h('div', { class: 'sub' });
  const weatherCard = h('section', { class: 'card weather', attrs: { 'aria-label': 'Väder i ' + PLACE } });
  const todayBox = h('div');
  const upcomingBox = h('div');
  let token = 0;

  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' }, greet, dateLine),
      iconButton('gear', 'Inställningar', () => navigate('#installningar')),
    ),
    weatherCard,
    h('div', { class: 'section-head' },
      h('h2', { text: 'Idag' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: () => eventSheet(null, { date: new Date(), onSaved: loadEvents }) } }, icon('plus'), 'Ny händelse'),
    ),
    todayBox,
    h('div', { class: 'section-head' },
      h('h2', { text: 'Kommande 7 dagar' }),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#kalender' }, 'Kalender', icon('chevron')),
    ),
    upcomingBox,
  );

  function renderHeader() {
    const now = new Date();
    greet.textContent = greeting(now);
    dateLine.textContent = capitalize(fmt.full(now));
  }

  // ---------- Väder ----------

  async function loadWeather(force = false) {
    if (!weatherCard.firstChild) put(weatherCard, h('div', { class: 'skeleton', style: 'height:150px;margin:0' }));
    try {
      renderWeather(await getWeather({ force }));
    } catch (err) {
      put(weatherCard,
        h('div', { class: 'weather-error', attrs: { role: 'alert' } },
          icon('alert'),
          h('div', {},
            h('strong', { text: 'Vädret kunde inte hämtas' }),
            h('p', { class: 'muted small', text: err.message }),
          ),
        ),
        h('button', { type: 'button', class: 'btn btn-sm', text: 'Försök igen', on: { click: () => loadWeather(true) } }),
      );
    }
  }

  function renderWeather(w) {
    const c = w.current;
    const desc = describe(c.symbol);
    const rainNext = w.hourly.filter((x) => x !== c).slice(0, 3).reduce((s, x) => s + x.precip, 0);
    put(weatherCard,
      h('div', { class: 'weather-now' },
        weatherIcon(c.symbol, { night: isNight(c.time), size: 72, label: desc }),
        h('div', { class: 'weather-temp num', text: fmtTemp(c.temp) }),
        h('div', { class: 'weather-desc' },
          h('strong', { text: desc }),
          h('span', { class: 'muted small', text: PLACE }),
        ),
      ),
      h('div', { class: 'weather-facts' },
        fact('drop', 'Nederbörd',
          c.precip >= 0.1 ? `${fmtMm(c.precip)} per timme` : (rainNext >= 0.1 ? `${fmtMm(rainNext)} närmaste 3 h` : 'Uppehåll'),
          c.precipProb != null ? `${Math.round(c.precipProb)} % risk` : null),
        fact('wind', 'Vind', c.wind != null ? `${Math.round(c.wind)} m/s` : '–', c.gust != null ? `i byarna ${Math.round(c.gust)} m/s` : null),
      ),
      w.hourly.length ? h('ol', { class: 'hourly', attrs: { 'aria-label': 'Prognos timme för timme' } },
        w.hourly.map((x, i) => h('li', {},
          h('span', { class: 'muted small num', text: i === 0 && x === c ? 'Nu' : fmt.time(x.time) }),
          weatherIcon(x.symbol, { night: isNight(x.time), size: 32, label: describe(x.symbol) }),
          h('strong', { class: 'num', text: fmtTemp(x.temp) }),
          h('span', { class: 'rain num', text: x.precip >= 0.1 ? fmtMm(x.precip) : '' }),
        ))) : null,
      h('ol', { class: 'daily', attrs: { 'aria-label': 'Prognos för kommande dagar' } },
        w.daily.map((d, i) => h('li', {},
          h('span', { class: 'day', text: i === 0 ? 'Idag' : capitalize(d.date.toLocaleDateString('sv-SE', { weekday: 'long' })) }),
          weatherIcon(d.symbol, { size: 30, label: describe(d.symbol) }),
          h('span', { class: 'rain num', text: d.precip >= 0.1 ? fmtMm(d.precip) : '' }),
          h('span', { class: 'range num' },
            h('span', { class: 'muted', text: fmtTemp(d.min) }),
            h('span', { class: 'sep', attrs: { 'aria-hidden': 'true' }, text: '/' }),
            h('strong', { text: fmtTemp(d.max) }),
          ),
        ))),
      h('p', { class: 'weather-src muted', text: `Källa: SMHI · hämtad ${fmt.time(w.fetchedAt)}` }),
    );
  }

  function fact(iconName, label, value, extra) {
    return h('div', { class: 'fact' },
      icon(iconName),
      h('div', {},
        h('div', { class: 'muted small', text: label }),
        h('div', { class: 'strong', text: value }),
        extra ? h('div', { class: 'muted small', text: extra }) : null,
      ),
    );
  }

  // ---------- Händelser ----------

  async function loadEvents() {
    const t = ++token;
    const today = startOfDay(new Date());
    let events;
    try {
      events = await fetchEvents(today, addDays(today, 8));
    } catch (err) {
      if (t !== token) return;
      put(todayBox, errorBox(err, loadEvents));
      put(upcomingBox);
      return;
    }
    if (t !== token) return;
    const open = (ev) => eventSheet(ev, { onSaved: loadEvents });

    const todays = sortEvents(events.filter((e) => occursOn(e, today)));
    put(todayBox, todays.length
      ? h('ul', { class: 'rows' }, todays.map((e) => eventRow(e, today, open)))
      : emptyState({
          iconName: 'calendar',
          title: 'Inget i kalendern idag',
          text: 'Lägg till din första händelse, så syns den här och i kalendern för er båda.',
          action: h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => eventSheet(null, { date: today, onSaved: loadEvents }) } }, icon('plus'), 'Lägg till händelse'),
        }));

    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      const list = sortEvents(events.filter((e) => occursOn(e, d)));
      if (list.length) days.push({ d, list });
    }
    put(upcomingBox, days.length
      ? h('ul', { class: 'rows upcoming' }, days.map(({ d, list }) => h('li', { class: 'upcoming-day' },
          h('a', { class: 'upcoming-date', href: '#kalender/' + ymd(d), attrs: { 'aria-label': 'Visa ' + fmt.full(d) + ' i kalendern' } },
            h('span', { class: 'wd', text: capitalize(d.toLocaleDateString('sv-SE', { weekday: 'short' })) }),
            h('span', { class: 'dn num', text: String(d.getDate()) }),
          ),
          h('ul', { class: 'upcoming-events' }, list.map((e) => h('li', {},
            h('button', { type: 'button', class: 'upcoming-event', on: { click: () => open(e) } },
              h('span', { class: 'event-time' + (e.all_day ? ' all-day' : ''), text: timeText(e, d) }),
              h('span', { class: 'title', text: e.title }),
            ),
          ))),
        )))
      : h('p', { class: 'muted small empty-inline', text: 'Inget planerat de kommande 7 dagarna.' }));
  }

  renderHeader();
  loadWeather();
  loadEvents();

  let lastDay = new Date();
  return {
    tables: ['events'],
    handlesTyping: true,
    refresh(tables) {
      renderHeader();
      // Efter uppvaknande eller ny dag: hämta vädret igen (cachen avgör om det behövs).
      if (tables.includes('*') || !sameDay(lastDay, new Date())) {
        lastDay = new Date();
        loadWeather();
      }
      loadEvents();
    },
  };
}
