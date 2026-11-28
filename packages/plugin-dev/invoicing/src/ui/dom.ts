type Props<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  text?: string;
};

/** Small element factory; `text` sets textContent so user text is never parsed as HTML. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  const { text, ...rest } = props;
  Object.assign(node, rest);
  if (text !== undefined) node.textContent = text;
  node.append(...children);
  return node;
};

/** A labelled form control inside the UI kit's `.field` wrapper. */
export const field = (
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  hint?: string,
): HTMLDivElement => {
  control.id ||= `f-${Math.random().toString(36).slice(2)}`;
  return el('div', { className: 'field' }, [
    el('label', { htmlFor: control.id, text: label }),
    control,
    ...(hint ? [el('p', { className: 'field-hint', text: hint })] : []),
  ]);
};

export const numberInput = (value: number, step = '0.01'): HTMLInputElement =>
  el('input', { type: 'number', min: '0', step, value: String(value) });
