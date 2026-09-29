// Anteckningar – byggs i en senare etapp.
import { h, emptyState } from './ui.js';

export const title = 'Anteckningar';

export function mount(root) {
  root.append(
    h('header', { class: 'topbar' }, h('div', { class: 'grow' }, h('h1', { text: 'Anteckningar' }))),
    emptyState({ iconName: 'note', title: 'Kommer snart', text: 'Den här fliken byggs i nästa etapp.' }),
  );
  return {};
}
