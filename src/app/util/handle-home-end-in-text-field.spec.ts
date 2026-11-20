import { handleHomeEndInTextField } from './handle-home-end-in-text-field';

describe('handleHomeEndInTextField', () => {
  let field: HTMLTextAreaElement;

  const press = (
    key: string,
    opts: KeyboardEventInit = {},
    target: HTMLElement = field,
  ): { handled: boolean; ev: KeyboardEvent } => {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true, ...opts });
    Object.defineProperty(ev, 'target', { value: target });
    return { handled: handleHomeEndInTextField(ev), ev };
  };

  beforeEach(() => {
    field = document.createElement('textarea');
    field.value = 'first line\nsecond line';
    document.body.appendChild(field);
    field.focus();
  });

  afterEach(() => field.remove());

  it('moves the caret to the start of the current line on Home and cancels the scroll', () => {
    field.setSelectionRange(16, 16); // inside "second"
    const { handled, ev } = press('Home');
    expect(handled).toBeTrue();
    expect(ev.defaultPrevented).toBeTrue();
    expect([field.selectionStart, field.selectionEnd]).toEqual([11, 11]);
  });

  it('moves the caret to the end of the current line on End', () => {
    field.setSelectionRange(2, 2); // inside "first"
    press('End');
    expect([field.selectionStart, field.selectionEnd]).toEqual([10, 10]);
  });

  it('extends the selection to the line start on Shift+Home', () => {
    field.setSelectionRange(16, 16);
    press('Home', { shiftKey: true });
    expect([field.selectionStart, field.selectionEnd]).toEqual([11, 16]);
  });

  it('extends the selection to the line end on Shift+End', () => {
    field.setSelectionRange(2, 2);
    press('End', { shiftKey: true });
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 10]);
  });

  it('works for single-line text inputs', () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(3, 3);
    press('Home', {}, input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 0]);
    input.remove();
  });

  it('keeps the caret at 0 on Home when the value starts with a newline', () => {
    field.value = '\nabc';
    field.setSelectionRange(0, 0);
    press('Home');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0]);
  });

  it('moves to the start of the wrapped visual line, not the paragraph', () => {
    field.style.cssText = 'width: 60px; font: 16px monospace; white-space: pre-wrap;';
    field.value = 'aaaa bbbb cccc dddd';
    const caret = field.value.length;
    field.setSelectionRange(caret, caret);
    press('Home');
    expect(field.selectionStart).toBeGreaterThan(0);
    expect(field.selectionStart).toBeLessThan(caret);
  });

  it('ignores Home during IME composition', () => {
    expect(press('Home', { isComposing: true }).handled).toBeFalse();
  });

  it('ignores Home with a modifier', () => {
    field.setSelectionRange(16, 16);
    const { handled, ev } = press('Home', { metaKey: true });
    expect(handled).toBeFalse();
    expect(ev.defaultPrevented).toBeFalse();
  });

  it('ignores other keys', () => {
    expect(press('a').handled).toBeFalse();
  });

  it('ignores non-text targets', () => {
    const div = document.createElement('div');
    const { handled, ev } = press('Home', {}, div);
    expect(handled).toBeFalse();
    expect(ev.defaultPrevented).toBeFalse();
  });
});
