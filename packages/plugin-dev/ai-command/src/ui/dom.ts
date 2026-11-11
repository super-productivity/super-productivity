// Tiny DOM helpers. All text goes through textContent: titles are user and
// model content and never become markup.

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const button = (
  label: string,
  onClick: () => void,
  cls?: string,
): HTMLButtonElement => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

export const heading = (text: string): HTMLHeadingElement => el('h3', undefined, text);
