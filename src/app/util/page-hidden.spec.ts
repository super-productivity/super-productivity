import { pageHidden$ } from './page-hidden';

describe('pageHidden$', () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    visibility = 'visible';
    spyOnProperty(document, 'visibilityState', 'get').and.callFake(() => visibility);
  });

  it('emits when the document becomes hidden', () => {
    const spy = jasmine.createSpy();
    const sub = pageHidden$().subscribe(spy);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    sub.unsubscribe();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not emit when the document becomes visible', () => {
    const spy = jasmine.createSpy();
    const sub = pageHidden$().subscribe(spy);
    document.dispatchEvent(new Event('visibilitychange'));
    sub.unsubscribe();
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits on pagehide', () => {
    const spy = jasmine.createSpy();
    const sub = pageHidden$().subscribe(spy);
    window.dispatchEvent(new Event('pagehide'));
    sub.unsubscribe();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
