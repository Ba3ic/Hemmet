// Väder från SMHI:s öppna prognos-API (SNOW1gv1, ersatte PMP3gv2 2025).
// Dokumentation: https://opendata.smhi.se/metfcst/snow1gv1
// API:et skickar Access-Control-Allow-Origin: * så det kan anropas direkt från webbläsaren.
import { h } from './ui.js';

const LAT = 59.27;
const LON = 18.05;
export const PLACE = 'Bandhagen';
const URL_ = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${LON}/lat/${LAT}/data.json`;
const TTL = 10 * 60 * 1000; // cacha i minnet i 10 minuter

let cache = null;   // { at, data }
let pending = null;

/** Hämta och tolka prognosen. Kastar ett fel med svensk text om det inte går. */
export async function getWeather({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (pending) return pending;
  pending = (async () => {
    let res;
    try {
      res = await fetch(URL_);
    } catch {
      throw new Error('Kunde inte nå SMHI. Kontrollera internetanslutningen och försök igen.');
    }
    if (!res.ok) throw new Error(`SMHI svarade med fel (${res.status}). Försök igen om en stund.`);
    const json = await res.json();
    const data = parse(json);
    cache = { at: Date.now(), data };
    return data;
  })();
  try { return await pending; } finally { pending = null; }
}

function parse(json) {
  const series = (json.timeSeries || []).map((t) => {
    const d = t.data || {};
    const end = new Date(t.time);
    const start = t.intervalParametersStartTime ? new Date(t.intervalParametersStartTime) : end;
    return {
      time: end,
      hours: Math.max(1, (end - start) / 3600000),
      temp: num(d.air_temperature),
      symbol: num(d.symbol_code),
      precip: Math.max(0, num(d.precipitation_amount_mean) ?? 0), // mm under intervallet
      precipProb: num(d.probability_of_precipitation),
      wind: num(d.wind_speed),
      gust: num(d.wind_speed_of_gust),
    };
  }).filter((x) => x.temp != null);
  if (!series.length) throw new Error('SMHI skickade ingen prognos just nu. Försök igen om en stund.');

  const now = Date.now();
  // Nuvarande: första tidpunkten som inte redan passerat med mer än 30 minuter.
  const currentIdx = Math.max(0, series.findIndex((x) => x.time.getTime() > now - 30 * 60 * 1000));
  const current = series[currentIdx];
  const hourly = series.slice(currentIdx).filter((x) => x.hours <= 1).slice(0, 12);

  // Dagar: gruppera på lokalt datum
  const days = new Map();
  for (const x of series.slice(currentIdx)) {
    const key = x.time.toDateString();
    let d = days.get(key);
    if (!d) days.set(key, d = { date: new Date(x.time.getFullYear(), x.time.getMonth(), x.time.getDate()), min: Infinity, max: -Infinity, precip: 0, points: [] });
    d.min = Math.min(d.min, x.temp);
    d.max = Math.max(d.max, x.temp);
    d.precip += x.precip;
    d.points.push(x);
  }
  const daily = [...days.values()].slice(0, 5).map((d) => {
    // Symbol runt mitt på dagen säger mest om dagen
    const mid = d.points.reduce((best, p) => Math.abs(p.time.getHours() - 13) < Math.abs(best.time.getHours() - 13) ? p : best);
    return { date: d.date, min: d.min, max: d.max, precip: d.precip, symbol: mid.symbol };
  });

  return { current, hourly, daily, fetchedAt: new Date(), approvedTime: json.approvedTime || json.createdTime };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- Vädersymboler (SMHI Wsymb2, 1–27) ----------

export const SYMBOLS = {
  1: 'Klart', 2: 'Nästan klart', 3: 'Växlande molnighet', 4: 'Halvklart', 5: 'Molnigt', 6: 'Mulet',
  7: 'Dimma', 8: 'Lätta regnskurar', 9: 'Regnskurar', 10: 'Kraftiga regnskurar', 11: 'Åskskurar',
  12: 'Lätta skurar av snöblandat regn', 13: 'Skurar av snöblandat regn', 14: 'Kraftiga skurar av snöblandat regn',
  15: 'Lätta snöbyar', 16: 'Snöbyar', 17: 'Kraftiga snöbyar', 18: 'Lätt regn', 19: 'Regn', 20: 'Kraftigt regn',
  21: 'Åska', 22: 'Lätt snöblandat regn', 23: 'Snöblandat regn', 24: 'Kraftigt snöblandat regn',
  25: 'Lätt snöfall', 26: 'Snöfall', 27: 'Kraftigt snöfall',
};
export const describe = (s) => SYMBOLS[s] || 'Okänt väder';

// Ungefärlig soluppgång/solnedgång i Stockholm per månad (lokal tid, timmar).
const SUN = [[8.6, 15.2], [7.6, 16.5], [6.3, 17.8], [6.0, 20.0], [4.5, 21.1], [3.6, 22.0], [3.9, 21.8], [5.1, 20.6], [6.4, 19.0], [7.6, 17.4], [7.9, 15.4], [8.7, 14.8]];
export function isNight(d) {
  const [up, down] = SUN[d.getMonth()];
  const t = d.getHours() + d.getMinutes() / 60;
  return t < up || t >= down;
}

// Ritade ikoner i SVG (inga externa bilder). Färger via CSS-klasser.
const SVG_NS = 'http://www.w3.org/2000/svg';
const PARTS = {
  sun: '<g class="w-sun"><circle cx="24" cy="24" r="8"/><path d="M24 7v4M24 37v4M7 24h4M37 24h4M12 12l2.8 2.8M33.2 33.2 36 36M12 36l2.8-2.8M33.2 14.8 36 12"/></g>',
  sunSmall: '<g class="w-sun"><circle cx="17" cy="17" r="6"/><path d="M17 5v3M5 17h3M8.5 8.5l2 2M25.5 8.5l-2 2M8.5 25.5l2-2"/></g>',
  moon: '<g class="w-moon"><path d="M30 10a13 13 0 1 0 8 20 11 11 0 0 1-8-20z"/></g>',
  moonSmall: '<g class="w-moon"><path d="M20 6a9 9 0 1 0 6 14 7.5 7.5 0 0 1-6-14z"/></g>',
  cloud: '<path class="w-cloud" d="M15 36h19a8 8 0 0 0 .6-16A11 11 0 0 0 13.5 23 6.5 6.5 0 0 0 15 36z"/>',
  cloudDark: '<path class="w-cloud dark" d="M15 34h19a8 8 0 0 0 .6-16A11 11 0 0 0 13.5 21 6.5 6.5 0 0 0 15 34z"/>',
  fog: '<g class="w-fog"><path d="M9 18h30M6 24h36M9 30h30M13 36h22"/></g>',
  rain1: '<g class="w-rain"><path d="M20 38l-1.5 4M28 38l-1.5 4"/></g>',
  rain2: '<g class="w-rain"><path d="M17 38l-1.5 4M24 38l-1.5 4M31 38l-1.5 4"/></g>',
  rain3: '<g class="w-rain"><path d="M15 37l-2 6M21 37l-2 6M27 37l-2 6M33 37l-2 6"/></g>',
  snow1: '<g class="w-snow"><circle cx="20" cy="40" r="1.6"/><circle cx="28" cy="41" r="1.6"/></g>',
  snow2: '<g class="w-snow"><circle cx="16" cy="39" r="1.6"/><circle cx="24" cy="41" r="1.6"/><circle cx="32" cy="39" r="1.6"/></g>',
  snow3: '<g class="w-snow"><circle cx="14" cy="39" r="1.7"/><circle cx="20" cy="42" r="1.7"/><circle cx="26" cy="39" r="1.7"/><circle cx="32" cy="42" r="1.7"/></g>',
  sleet: '<g class="w-rain"><path d="M18 38l-1.5 4M30 38l-1.5 4"/></g><g class="w-snow"><circle cx="24" cy="41" r="1.6"/></g>',
  bolt: '<path class="w-bolt" d="M25 32l-4 7h5l-3 7"/>',
};

function parts(symbol, night) {
  const sm = night ? PARTS.moonSmall : PARTS.sunSmall;
  const big = night ? PARTS.moon : PARTS.sun;
  switch (symbol) {
    case 1: return big;
    case 2: case 3: return sm + PARTS.cloud;
    case 4: return sm + PARTS.cloud;
    case 5: case 6: return PARTS.cloud;
    case 7: return PARTS.fog;
    case 8: return sm + PARTS.cloudDark + PARTS.rain1;
    case 9: return sm + PARTS.cloudDark + PARTS.rain2;
    case 10: return sm + PARTS.cloudDark + PARTS.rain3;
    case 11: return sm + PARTS.cloudDark + PARTS.bolt + PARTS.rain1;
    case 12: case 13: case 14: return sm + PARTS.cloudDark + PARTS.sleet;
    case 15: return sm + PARTS.cloudDark + PARTS.snow1;
    case 16: return sm + PARTS.cloudDark + PARTS.snow2;
    case 17: return sm + PARTS.cloudDark + PARTS.snow3;
    case 18: return PARTS.cloudDark + PARTS.rain1;
    case 19: return PARTS.cloudDark + PARTS.rain2;
    case 20: return PARTS.cloudDark + PARTS.rain3;
    case 21: return PARTS.cloudDark + PARTS.bolt;
    case 22: case 23: case 24: return PARTS.cloudDark + PARTS.sleet;
    case 25: return PARTS.cloudDark + PARTS.snow1;
    case 26: return PARTS.cloudDark + PARTS.snow2;
    case 27: return PARTS.cloudDark + PARTS.snow3;
    default: return PARTS.cloud;
  }
}

export function weatherIcon(symbol, { night = false, size = 48, label } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'wicon');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = parts(symbol, night); // statiska strängar, ingen användartext
  return svg;
}

export const fmtTemp = (t) => `${Math.round(t) === 0 ? 0 : Math.round(t)}°`;
export const fmtMm = (mm) => (mm < 0.05 ? '0 mm' : `${mm < 10 ? mm.toFixed(1).replace('.', ',') : Math.round(mm)} mm`);

export function tempSpan(t) {
  return h('span', { class: 'num', text: fmtTemp(t) });
}
