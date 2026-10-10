import { MAX_NAME } from '../data/tags';
import { h } from './dom';

export interface TagCardHooks {
  save(name: string): void;
  /** Only for a place that's already tagged. */
  remove?: () => void;
  /** Escape. */
  cancel(): void;
}

/**
 * The card for pressing and holding the map (right-click with a mouse): name
 * the spot and tag it, or rename or remove a tag that's already there. The
 * name starts as the town (filled in once it's found) and can be changed.
 */
export function tagCard(name: string | null, hooks: TagCardHooks): { el: HTMLElement; setName(found: string): void } {
  const existing = !!hooks.remove;
  const input = h('input', {
    class: 'tag-input',
    type: 'text',
    value: name ?? '',
    placeholder: name == null ? 'Finding the place…' : 'Name',
    maxlength: String(MAX_NAME),
    enterkeyhint: 'done',
    autocomplete: 'off',
    'aria-label': 'Name for this place',
  }) as HTMLInputElement;
  // A name the person started typing wins over the one the lookup brings back.
  let typed = false;
  input.addEventListener('input', () => (typed = true));
  input.addEventListener('focus', () => input.select());

  const save = h('button', { type: 'submit', class: 'tag-save' }, existing ? 'Save' : 'Tag');
  const actions = h('div', { class: 'tag-actions' }, save);
  if (hooks.remove) {
    const remove = h('button', { type: 'button', class: 'tag-remove' }, 'Remove');
    remove.addEventListener('click', () => hooks.remove!());
    actions.append(remove);
  }
  const form = h(
    'form',
    { class: 'tip-body tag-form' },
    h('p', { class: 'tip-kicker' }, existing ? 'Tagged place' : 'Tag this place'),
    input,
    actions,
  );
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hooks.cancel();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    hooks.save(input.value);
  });
  return {
    el: form,
    setName(found: string) {
      input.placeholder = 'Name';
      if (typed) return;
      input.value = found;
      if (document.activeElement === input) input.select();
    },
  };
}
