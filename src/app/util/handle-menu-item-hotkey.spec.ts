import { handleMenuItemHotkey } from './handle-menu-item-hotkey';

describe('handleMenuItemHotkey', () => {
  let panel: HTMLElement;
  let tagsItem: HTMLButtonElement;
  let estimateItem: HTMLButtonElement;

  const item = (label: string, key: string, menu = panel): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = 'mat-mdc-menu-item';
    btn.innerHTML = `<span>${label}</span><span class="key-i">${key}</span>`;
    menu.appendChild(btn);
    return btn;
  };

  const press = (target: HTMLElement, key: string, code: string): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  };

  beforeEach(() => {
    panel = document.createElement('div');
    panel.className = 'mat-mdc-menu-panel';
    document.body.appendChild(panel);
    tagsItem = item('Toggle tags', 'G');
    estimateItem = item('Estimate', 'T');
    item('No shortcut', '');
  });

  afterEach(() => panel.remove());

  it('runs the item whose listed shortcut matches, not the label type-ahead', () => {
    const tagsClick = spyOn(tagsItem, 'click');
    const estimateClick = spyOn(estimateItem, 'click');
    const ev = press(tagsItem, 't', 'KeyT');

    expect(handleMenuItemHotkey(ev)).toBeTrue();
    expect(estimateClick).toHaveBeenCalled();
    expect(tagsClick).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBeTrue();
  });

  it('acts on the topmost open menu when focus stayed outside it (mouse-opened)', () => {
    const submenu = document.createElement('div');
    submenu.className = 'mat-mdc-menu-panel';
    document.body.appendChild(submenu);
    const submenuItem = item('Sub', 'T', submenu);
    const estimateClick = spyOn(estimateItem, 'click');
    const submenuClick = spyOn(submenuItem, 'click');

    expect(handleMenuItemHotkey(press(document.body, 't', 'KeyT'))).toBeTrue();
    expect(submenuClick).toHaveBeenCalled();
    expect(estimateClick).not.toHaveBeenCalled();
    submenu.remove();
  });

  it('skips disabled items', () => {
    estimateItem.setAttribute('aria-disabled', 'true');
    const estimateClick = spyOn(estimateItem, 'click');

    expect(handleMenuItemHotkey(press(tagsItem, 't', 'KeyT'))).toBeFalse();
    expect(estimateClick).not.toHaveBeenCalled();
  });

  it('does nothing when no menu is open', () => {
    panel.remove();
    expect(handleMenuItemHotkey(press(document.body, 't', 'KeyT'))).toBeFalse();
  });

  it('leaves typing in inputs and menu navigation keys alone', () => {
    const input = document.createElement('input');
    panel.appendChild(input);
    item('Enter-bound', 'Enter');

    expect(handleMenuItemHotkey(press(input, 't', 'KeyT'))).toBeFalse();
    expect(handleMenuItemHotkey(press(tagsItem, 'Enter', 'Enter'))).toBeFalse();
  });

  it('leaves unlisted keys to the menu', () => {
    expect(handleMenuItemHotkey(press(tagsItem, 'x', 'KeyX'))).toBeFalse();
  });
});
