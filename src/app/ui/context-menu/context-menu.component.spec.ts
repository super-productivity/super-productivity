import { Component, ElementRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ContextMenuComponent } from './context-menu.component';

@Component({
  standalone: true,
  imports: [ContextMenuComponent],
  template: `
    <div #trigger></div>
    <ng-template #menuTpl><span>menu item</span></ng-template>
    <context-menu
      [rightClickTriggerEl]="trigger"
      [contextMenu]="menuTpl"
      [isEnabled]="isEnabled"
      [isTouchLongPress]="isTouchLongPress"
    ></context-menu>
  `,
})
class HostComponent {
  readonly triggerRef = viewChild.required<ElementRef<HTMLElement>>('trigger');
  readonly contextMenu = viewChild.required(ContextMenuComponent);
  isEnabled = true;
  isTouchLongPress = false;
}

const dispatchTouch = (
  el: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend',
  x = 10,
  y = 10,
): TouchEvent => {
  const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  const ev = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: [touch],
  });
  el.dispatchEvent(ev);
  return ev;
};

const dispatchRightClick = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
};

describe('ContextMenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  // Returns a spy on the underlying menu trigger so tests can assert whether
  // the menu actually opened.
  const setup = (isEnabled: boolean, isTouchLongPress = false): jasmine.Spy => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.isEnabled = isEnabled;
    host.isTouchLongPress = isTouchLongPress;
    fixture.detectChanges();
    return spyOn(host.contextMenu().contextMenuTriggerEl(), 'openMenu');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    });
  });

  it('opens the menu on right-click when enabled', () => {
    const openMenuSpy = setup(true);
    dispatchRightClick(host.triggerRef().nativeElement);
    expect(openMenuSpy).toHaveBeenCalled();
  });

  it('does not open the menu on right-click when disabled (#7734)', () => {
    const openMenuSpy = setup(false);
    dispatchRightClick(host.triggerRef().nativeElement);
    expect(openMenuSpy).not.toHaveBeenCalled();
  });

  describe('touch long-press', () => {
    it('opens the menu after a stationary long-press and eats the click', fakeAsync(() => {
      const openMenuSpy = setup(true, true);
      const el = host.triggerRef().nativeElement;

      dispatchTouch(el, 'touchstart');
      tick(599);
      expect(openMenuSpy).not.toHaveBeenCalled();
      tick(1);
      expect(openMenuSpy).toHaveBeenCalledTimes(1);

      // Prevented, so no click follows to navigate the row.
      expect(dispatchTouch(el, 'touchend').defaultPrevented).toBeTrue();
    }));

    it('leaves a short tap alone', fakeAsync(() => {
      const openMenuSpy = setup(true, true);
      const el = host.triggerRef().nativeElement;

      dispatchTouch(el, 'touchstart');
      tick(200);
      expect(dispatchTouch(el, 'touchend').defaultPrevented).toBeFalse();
      tick(1000);
      expect(openMenuSpy).not.toHaveBeenCalled();
    }));

    it('treats a press that moves as a scroll or drag', fakeAsync(() => {
      const openMenuSpy = setup(true, true);
      const el = host.triggerRef().nativeElement;

      dispatchTouch(el, 'touchstart', 10, 10);
      tick(300);
      dispatchTouch(el, 'touchmove', 10, 15);
      tick(1000);
      expect(openMenuSpy).not.toHaveBeenCalled();
    }));

    it('ignores jitter below the drag threshold', fakeAsync(() => {
      const openMenuSpy = setup(true, true);
      const el = host.triggerRef().nativeElement;

      dispatchTouch(el, 'touchstart', 10, 10);
      dispatchTouch(el, 'touchmove', 12, 11);
      tick(600);
      expect(openMenuSpy).toHaveBeenCalledTimes(1);
    }));

    it('closes the menu again when the finger moves on into a drag', fakeAsync(() => {
      setup(true, true);
      const trigger = host.contextMenu().contextMenuTriggerEl();
      const closeMenuSpy = spyOn(trigger, 'closeMenu');
      const el = host.triggerRef().nativeElement;

      dispatchTouch(el, 'touchstart', 10, 10);
      tick(600);
      dispatchTouch(el, 'touchmove', 10, 30);
      expect(closeMenuSpy).toHaveBeenCalled();
      expect(dispatchTouch(el, 'touchend', 10, 30).defaultPrevented).toBeFalse();
    }));

    it('stays off unless the consumer opts in', fakeAsync(() => {
      const openMenuSpy = setup(true);
      dispatchTouch(host.triggerRef().nativeElement, 'touchstart');
      tick(1000);
      expect(openMenuSpy).not.toHaveBeenCalled();
    }));

    it('does not open when disabled', fakeAsync(() => {
      const openMenuSpy = setup(false, true);
      dispatchTouch(host.triggerRef().nativeElement, 'touchstart');
      tick(1000);
      expect(openMenuSpy).not.toHaveBeenCalled();
    }));
  });
});
