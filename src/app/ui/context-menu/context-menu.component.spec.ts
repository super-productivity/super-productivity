import { Component, ElementRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FocusMonitor } from '@angular/cdk/a11y';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { ContextMenuComponent } from './context-menu.component';

@Component({
  standalone: true,
  imports: [ContextMenuComponent, MatMenu, MatMenuItem],
  template: `
    <div
      #trigger
      tabindex="0"
    ></div>
    <button
      #more
      style="position: fixed; left: 50px; top: 60px; height: 20px"
    >
      more
    </button>
    <mat-menu #menu="matMenu"><button mat-menu-item>menu item</button></mat-menu>
    <context-menu
      [rightClickTriggerEl]="trigger"
      [leftClickTriggerEl]="more"
      [menu]="menu"
      [isEnabled]="isEnabled"
      [isTouchLongPress]="isTouchLongPress"
    ></context-menu>
  `,
})
class HostComponent {
  readonly triggerRef = viewChild.required<ElementRef<HTMLElement>>('trigger');
  readonly moreRef = viewChild.required<ElementRef<HTMLButtonElement>>('more');
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

  describe('opened from its button by keyboard', () => {
    // Enter or Space on a button fires a click with detail 0 and no position.
    const pressMore = (): HTMLButtonElement => {
      const more = host.moreRef().nativeElement;
      more.focus();
      more.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      fixture.detectChanges();
      return more;
    };

    it('opens below the button, not in the corner', () => {
      setup(true);
      pressMore();
      expect(host.contextMenu().contextMenuPosition).toEqual({ x: '50px', y: '80px' });
    });

    it('gives the focus back to the button on close', () => {
      setup(true).and.callThrough();
      const more = pressMore();
      // Focus sits in the menu while it is open.
      more.blur();
      expect(document.activeElement).not.toBe(more);
      host.contextMenu().contextMenuTriggerEl().closeMenu();
      expect(document.activeElement).toBe(more);
    });

    // A plain focus() counts as program focus, which Material highlights: the
    // row stayed grey after a menu closed by mouse.
    it('gives the focus back as mouse focus when the menu is closed by mouse', fakeAsync(() => {
      setup(true).and.callThrough();
      const more = pressMore();
      TestBed.inject(FocusMonitor).monitor(more);
      more.blur();
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, buttons: 1, detail: 1 }),
      );
      // A real click closes the menu well after its mousedown; the focus
      // monitor only links a focus to a mousedown within 1ms.
      tick(100);
      host.contextMenu().contextMenuTriggerEl().closeMenu();
      expect(document.activeElement).toBe(more);
      expect(more.classList).toContain('cdk-mouse-focused');
      expect(more.classList).not.toContain('cdk-program-focused');
      TestBed.inject(FocusMonitor).stopMonitoring(more);
      flush();
    }));

    // A side-menu row's ⋮ hides once the row loses its hover.
    it('gives the focus to the row when the button has gone', () => {
      setup(true).and.callThrough();
      const more = pressMore();
      more.blur();
      more.style.display = 'none';
      host.contextMenu().contextMenuTriggerEl().closeMenu();
      expect(document.activeElement).toBe(host.triggerRef().nativeElement);
    });
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
