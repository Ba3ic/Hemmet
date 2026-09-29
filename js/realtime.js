// Realtidssynk: en kanal för alla hushållets tabeller.
// Ändringar skickas vidare till lyssnare som laddar om sin vy.
import { sb } from './supabase.js';

const TABLES = ['events', 'lists', 'list_items', 'notes', 'fixed_expenses', 'variable_expenses', 'month_income'];
const listeners = new Set();
let channel = null;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(table, payload) {
  for (const fn of listeners) {
    try { fn(table, payload); } catch (e) { console.error(e); }
  }
}

export function startRealtime(householdId) {
  stopRealtime();
  channel = sb.channel('hemmet-' + householdId);
  for (const table of TABLES) {
    // RLS gör att vi bara får rader från vårt eget hushåll. Borttagningar går inte att
    // filtrera och innehåller bara id – det räcker, eftersom vyn laddar om sin data.
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => emit(table, payload));
  }
  let wasSubscribed = false;
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      // Efter återanslutning kan vi ha missat ändringar – be vyn ladda om.
      if (wasSubscribed) emit('*', null);
      wasSubscribed = true;
    }
  });
}

export function stopRealtime() {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
}
