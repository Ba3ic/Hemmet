// Kalender – byggs i en senare etapp.
import { h, emptyState, add } from './ui.js';

export const title = 'Kalender';

export function mount(root) {
  add(root,
    h('header', { class: 'topbar' }, h('div', { class: 'grow' }, h('h1', { text: 'Kalender' }))),
    emptyState({ iconName: 'calendar', title: 'Kommer snart', text: 'Den här fliken byggs i nästa etapp.' }),
  );
  return {};
}
