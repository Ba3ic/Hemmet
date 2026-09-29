// Utgifter – byggs i en senare etapp.
import { h, emptyState } from './ui.js';

export const title = 'Utgifter';

export function mount(root) {
  root.append(
    h('header', { class: 'topbar' }, h('div', { class: 'grow' }, h('h1', { text: 'Utgifter' }))),
    emptyState({ iconName: 'wallet', title: 'Kommer snart', text: 'Den här fliken byggs i nästa etapp.' }),
  );
  return {};
}
