import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';

import { NavItemComponent } from './nav-item.component';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { selectAllDoneIds } from '../../../features/tasks/store/task.selectors';

@Component({
  template: `
    <nav-item
      [container]="'group'"
      [label]="'Projects'"
      [expanded]="expanded()"
      [ariaControls]="'projects-children'"
      [menuTriggerFor]="withMenu() ? menu : null"
    ></nav-item>
    <mat-menu #menu="matMenu">
      <button mat-menu-item>Item</button>
    </mat-menu>
  `,
  imports: [NavItemComponent, MatMenu, MatMenuItem],
})
class HostComponent {
  readonly expanded = signal(false);
  readonly withMenu = signal(false);
}

describe('NavItemComponent group header', () => {
  let fixture: ComponentFixture<HostComponent>;

  const headerBtn = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('nav-item button.nav-link');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore({ selectors: [{ selector: selectAllDoneIds, value: [] }] }),
        { provide: GlobalThemeService, useValue: { registerSvgIcon: () => undefined } },
        { provide: MagicNavConfigService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
  });

  it('exposes its expanded state when it has no menu', () => {
    fixture.detectChanges();
    expect(headerBtn().getAttribute('aria-expanded')).toBe('false');
    expect(headerBtn().getAttribute('aria-controls')).toBe('projects-children');
    expect(headerBtn().hasAttribute('aria-haspopup')).toBeFalse();

    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    expect(headerBtn().getAttribute('aria-expanded')).toBe('true');
  });

  it('reports a section that starts expanded as expanded', () => {
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    expect(headerBtn().getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves aria-expanded to the menu trigger when it has a menu', () => {
    fixture.componentInstance.withMenu.set(true);
    fixture.detectChanges();

    expect(headerBtn().getAttribute('aria-haspopup')).toBe('menu');
    expect(headerBtn().getAttribute('aria-expanded')).toBe('false');

    headerBtn().click();
    fixture.detectChanges();

    expect(headerBtn().getAttribute('aria-expanded')).toBe('true');
  });
});
