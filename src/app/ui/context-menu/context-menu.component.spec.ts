import { Component, ElementRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    ></context-menu>
  `,
})
class HostComponent {
  readonly triggerRef = viewChild.required<ElementRef<HTMLElement>>('trigger');
  readonly contextMenu = viewChild.required(ContextMenuComponent);
  isEnabled = true;
}

const dispatchRightClick = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
};

describe('ContextMenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  // Returns a spy on the underlying menu trigger so tests can assert whether
  // the menu actually opened.
  const setup = (isEnabled: boolean): jasmine.Spy => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.isEnabled = isEnabled;
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
});
