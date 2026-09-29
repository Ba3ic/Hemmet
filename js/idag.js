// Idag – startsida. (Byggs ut i etapp 4 med väder och händelser.)
import { h, iconButton, fmt, capitalize, add } from './ui.js';

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
  add(root,
    h('header', { class: 'topbar' },
      h('div', { class: 'grow' },
        h('h1', { text: greeting() }),
        h('div', { class: 'sub', text: capitalize(fmt.full(new Date())) }),
      ),
      iconButton('gear', 'Inställningar', () => navigate('#installningar')),
    ),
  );
  return {};
}
