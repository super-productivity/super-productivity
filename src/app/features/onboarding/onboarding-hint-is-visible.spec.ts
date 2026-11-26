import { isVisible } from './onboarding-hint.component';

describe('onboarding hint isVisible', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    el.style.cssText = 'position: fixed; top: 0; width: 100px; height: 40px;';
    document.body.appendChild(el);
  });

  afterEach(() => el.remove());

  it('accepts an element inside the viewport', () => {
    el.style.left = '0';
    expect(isVisible(el)).toBe(true);
  });

  // Browsers without checkVisibility (iOS < 17.4) keep the closed mobile drawer
  // laid out off-screen; its rows must not count as hint targets (#10820).
  it('rejects an element laid out beyond the right viewport edge', () => {
    el.style.left = `${window.innerWidth + 1}px`;
    const noCheck = el as unknown as { checkVisibility?: unknown };
    noCheck.checkVisibility = undefined;
    expect(isVisible(el)).toBe(false);
  });
});
