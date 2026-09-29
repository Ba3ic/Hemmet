// Händelser: hämtning, datumlogik och bladet för att skapa/redigera (används av Kalender och Idag).
import { sb } from './supabase.js';
import { state } from './state.js';
import {
  h, icon, field, formError, showFormError, busy, sheet, confirmSheet, fmt, ymd, hm, fromLocal,
  startOfDay, addDays,
} from './ui.js';

export const REMINDERS = [
  { value: '', label: 'Ingen' },
  { value: '0', label: 'Vid start' },
  { value: '10', label: '10 min innan' },
  { value: '60', label: '1 timme innan' },
  { value: '1440', label: '1 dag innan' },
];

/** Hämta händelser som berör intervallet [from, to). */
export async function fetchEvents(from, to) {
  // Hämta även sådant som startat en tid innan (pågående händelser över midnatt).
  const { data, error } = await sb.from('events')
    .select('*')
    .eq('household_id', state.household.id)
    .gte('starts_at', addDays(from, -7).toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at');
  if (error) throw error;
  return data.filter((e) => eventEnd(e) >= from);
}

export function eventStart(e) { return new Date(e.starts_at); }
export function eventEnd(e) {
  if (e.ends_at) return new Date(e.ends_at);
  const s = eventStart(e);
  return e.all_day ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 59) : s;
}

/** Berör händelsen dagen d? */
export function occursOn(e, d) {
  const dayStart = startOfDay(d);
  const dayEnd = addDays(dayStart, 1);
  const s = eventStart(e), en = eventEnd(e);
  return s < dayEnd && (en > dayStart || +en === +s && s >= dayStart);
}

/** Sortera: heldag först, sedan på starttid. */
export function sortEvents(list) {
  return [...list].sort((a, b) => (b.all_day - a.all_day) || (eventStart(a) - eventStart(b)));
}

/** Tidstext för en händelse sett från dagen d, t.ex. "08:00–09:30", "Heldag", "Fortsätter till 02:00". */
export function timeText(e, d = eventStart(e)) {
  if (e.all_day) return 'Heldag';
  const s = eventStart(e);
  const en = e.ends_at ? new Date(e.ends_at) : null;
  const startsToday = ymd(s) === ymd(d);
  if (!startsToday) return en ? `Fortsätter till ${fmt.time(en)}` : fmt.time(s);
  return en ? `${fmt.time(s)}–${fmt.time(en)}` : fmt.time(s);
}

export function reminderLabel(minutes) {
  const r = REMINDERS.find((x) => x.value === String(minutes ?? ''));
  return r ? r.label : `${minutes} min innan`;
}

/** Rad i en händelselista. */
export function eventRow(e, day, onClick) {
  return h('li', {},
    h('button', { type: 'button', class: 'row event-row', on: { click: () => onClick(e) } },
      h('span', { class: 'event-time' + (e.all_day ? ' all-day' : ''), text: timeText(e, day) }),
      h('span', { class: 'grow' },
        h('span', { class: 'title', text: e.title }),
        e.notes ? h('span', { class: 'meta ellipsis', text: e.notes }) : null,
      ),
      e.remind_minutes != null ? h('span', { class: 'bell', attrs: { title: 'Notis: ' + reminderLabel(e.remind_minutes) } }, icon('bell')) : null,
    ),
  );
}

function nextFullHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/**
 * Öppna bladet för ny eller befintlig händelse.
 * opts.date: förvalt datum (Date) för ny händelse. onSaved(): anropas efter sparat/borttaget.
 */
export function eventSheet(ev, { date, onSaved } = {}) {
  const isNew = !ev;
  const s0 = ev ? eventStart(ev) : null;
  let defStart = nextFullHour();
  if (date && ymd(date) !== ymd(new Date())) defStart = fromLocal(ymd(date), '09:00');
  else if (date) defStart = fromLocal(ymd(date), hm(defStart));
  const defEnd = new Date(defStart.getTime() + 60 * 60 * 1000);

  const title = h('input', { class: 'input', required: true, value: ev?.title || '', placeholder: 'T.ex. Tandläkare', attrs: { maxlength: '120', autocomplete: 'off' } });
  const dateIn = h('input', { class: 'input', type: 'date', required: true, value: ymd(s0 || date || defStart) });
  const allDay = h('input', { type: 'checkbox', checked: !!ev?.all_day, on: { change: syncAllDay } });
  const startIn = h('input', { class: 'input', type: 'time', value: s0 && !ev.all_day ? hm(s0) : hm(defStart), attrs: { step: '300' } });
  const endIn = h('input', { class: 'input', type: 'time', value: ev ? (ev.ends_at && !ev.all_day ? hm(new Date(ev.ends_at)) : '') : hm(defEnd), attrs: { step: '300' } });
  const notes = h('textarea', { class: 'textarea', value: ev?.notes || '', attrs: { rows: '3', placeholder: 'Adress, vad som ska med …' } });
  const remind = h('select', { class: 'input' },
    REMINDERS.map((r) => h('option', { value: r.value, text: r.label, selected: String(ev?.remind_minutes ?? '') === r.value })));
  const timeRow = h('div', { class: 'row-fields' }, field('Start', startIn), field('Slut (valfritt)', endIn));
  const err = formError();

  function syncAllDay() { timeRow.hidden = allDay.checked; }
  syncAllDay();

  const save = h('button', { type: 'submit', class: 'btn btn-primary', text: isNew ? 'Lägg till' : 'Spara' });

  const s = sheet({
    title: isNew ? 'Ny händelse' : 'Redigera händelse',
    content: h('form', { attrs: { novalidate: true }, on: { submit: async (e) => {
      e.preventDefault();
      showFormError(err, null);
      const t = title.value.trim();
      if (!t) return showFormError(err, 'Ge händelsen en titel.');
      if (!dateIn.value) return showFormError(err, 'Välj ett datum.');
      let startsAt, endsAt = null;
      if (allDay.checked) {
        startsAt = fromLocal(dateIn.value, '00:00');
      } else {
        if (!startIn.value) return showFormError(err, 'Välj en starttid, eller bocka i Heldag.');
        startsAt = fromLocal(dateIn.value, startIn.value);
        if (endIn.value) {
          endsAt = fromLocal(dateIn.value, endIn.value);
          if (endsAt <= startsAt) endsAt = addDays(endsAt, 1); // slutar efter midnatt
        }
      }
      const row = {
        title: t,
        notes: notes.value.trim() || null,
        all_day: allDay.checked,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        remind_minutes: remind.value === '' ? null : Number(remind.value),
      };
      await busy(save, async () => {
        const res = isNew
          ? await sb.from('events').insert({ ...row, household_id: state.household.id }).select().single()
          : await sb.from('events').update(row).eq('id', ev.id).select().single();
        if (res.error) return showFormError(err, res.error);
        s.close();
        onSaved?.(res.data);
      });
    } } },
      err,
      field('Titel', title),
      field('Datum', dateIn),
      h('label', { class: 'check', style: 'margin:-4px 0 10px' }, allDay, 'Heldag'),
      timeRow,
      field('Anteckning', notes),
      field('Notis', remind, 'Påminnelsen sparas nu. Notiser till telefonen slås på i en senare version.'),
      h('div', { class: 'sheet-actions' },
        isNew
          ? h('button', { type: 'button', class: 'btn', text: 'Avbryt', on: { click: () => s.close() } })
          : h('button', { type: 'button', class: 'btn btn-danger', on: { click: async () => {
              const ok = await confirmSheet({ title: `Ta bort ${ev.title}?`, message: 'Händelsen tas bort för er båda.' });
              if (!ok) return;
              const { error } = await sb.from('events').delete().eq('id', ev.id);
              if (error) return showFormError(err, error);
              s.close();
              onSaved?.(null);
            } } }, icon('trash'), 'Ta bort'),
        save,
      ),
    ),
  });
  return s;
}
