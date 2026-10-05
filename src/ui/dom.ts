type Attrs = Record<string, string | boolean | number | undefined | null>;
type Child = Node | string | null | undefined | false;

/** Minimal element builder. Boolean attrs: true sets, false/null skips. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c);
  }
  return el;
}

/** Parse a trusted, static SVG string from icons.ts. */
export function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
