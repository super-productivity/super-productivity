import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { liveMarkdown } from './live-markdown-extension';

describe('liveMarkdown interactions', () => {
  let host: HTMLElement;
  let view: EditorView;

  const mount = (doc: string): void => {
    host = document.createElement('div');
    document.body.appendChild(host);
    view = new EditorView({
      parent: host,
      state: EditorState.create({ doc, extensions: [liveMarkdown()] }),
    });
  };

  const clickLink = (): void => {
    const link = view.contentDOM.querySelector('.cm-md-link')!;
    expect(link).not.toBeNull();
    link.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    view.contentDOM.dispatchEvent(
      new MouseEvent('mouseup', { button: 0, bubbles: true }),
    );
  };

  afterEach(() => {
    view?.destroy();
    host?.remove();
  });

  for (const button of [1, 2]) {
    it(`does not toggle a checkbox with mouse button ${button}`, () => {
      mount('- [ ] task');
      view.contentDOM
        .querySelector('.cm-md-task-checkbox')!
        .dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));

      expect(view.state.doc.toString()).toBe('- [ ] task');
    });
  }

  it('toggles a checkbox with the primary mouse button', () => {
    mount('- [ ] task');
    view.contentDOM
      .querySelector('.cm-md-task-checkbox')!
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));

    expect(view.state.doc.toString()).toBe('- [x] task');
  });

  for (const markdown of [
    '[docs](https://example.com/docs)',
    '[docs](<https://example.com/docs>)',
    '[docs][ref]\n\n[ref]: https://example.com/docs',
    '[docs][]\n\n[docs]: https://example.com/docs',
    '[docs]\n\n[docs]: https://example.com/docs',
    '[docs][REF]\n\n[ref]: <https://example.com/docs>',
    'https://example.com/docs',
    '<https://example.com/docs>',
  ]) {
    it(`opens ${markdown}`, () => {
      mount(markdown);
      const open = spyOn(window, 'open').and.returnValue(null);

      clickLink();

      expect(open).toHaveBeenCalledOnceWith(
        'https://example.com/docs',
        '_blank',
        'noopener,noreferrer',
      );
    });
  }

  for (const markdown of [
    '[docs](<javascript:alert(1)>)',
    '[docs][ref]\n\n[ref]: javascript:alert(1)',
    '[docs][missing]',
  ]) {
    it(`does not open ${markdown}`, () => {
      mount(markdown);
      const open = spyOn(window, 'open').and.returnValue(null);

      clickLink();

      expect(open).not.toHaveBeenCalled();
    });
  }
});
