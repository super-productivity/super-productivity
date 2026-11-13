import { marked } from 'marked';
import { markedOptionsFactory } from './marked-options-factory';

describe('Rendered markdown checklist layout', () => {
  let preview: HTMLDivElement;

  beforeEach(() => {
    preview = document.createElement('div');
    preview.className = 'markdown';
    preview.style.width = '400px';
    document.body.appendChild(preview);
  });

  afterEach(() => preview.remove());

  for (const direction of ['ltr', 'rtl']) {
    for (const checked of [false, true]) {
      it(`keeps the ${checked ? 'checked' : 'unchecked'} icon clear of ${direction} text`, () => {
        preview.dir = direction;
        const label = direction === 'rtl' ? 'متن کار' : 'Task label';
        preview.innerHTML = marked.parse(
          `- [${checked ? 'x' : ' '}] ${label}`,
          markedOptionsFactory(),
        ) as string;

        const icon = preview.querySelector<HTMLElement>('.checkbox')!;
        const text = preview.querySelector<HTMLElement>('.checkbox-label')!;
        const iconBounds = icon.getBoundingClientRect();
        const textBounds = text.getBoundingClientRect();

        expect(iconBounds.width).toBeGreaterThan(0);
        expect(textBounds.width).toBeGreaterThan(0);
        if (direction === 'rtl') {
          expect(textBounds.right).toBeLessThanOrEqual(iconBounds.left);
        } else {
          expect(textBounds.left).toBeGreaterThanOrEqual(iconBounds.right);
        }
      });
    }
  }
});
