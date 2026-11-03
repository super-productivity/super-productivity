import { TranslateService } from '@ngx-translate/core';
import { MockStore } from '@ngrx/store/testing';
import { selectDueTaskCounts } from '../../../features/tasks/store/task.selectors';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { WorkContextMenuComponent } from '../../work-context-menu/work-context-menu.component';
import { Component, input, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';

import { NavItemComponent } from './nav-item.component';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { selectAllDoneIds } from '../../../features/tasks/store/task.selectors';
import { ContextMenuComponent } from '../../../ui/context-menu/context-menu.component';

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

@Component({
  template: `
    <nav-item
      [container]="'route'"
      [navRoute]="'/planner'"
      [label]="'Planner'"
      [icon]="'edit_calendar'"
      [featureConfigKey]="'isPlannerEnabled'"
    ></nav-item>
  `,
  imports: [NavItemComponent],
})
class FeatureRowHostComponent {}

describe('NavItemComponent row menu', () => {
  let fixture: ComponentFixture<FeatureRowHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureRowHostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideMockStore({ selectors: [{ selector: selectAllDoneIds, value: [] }] }),
        { provide: GlobalThemeService, useValue: { registerSvgIcon: () => undefined } },
        { provide: MagicNavConfigService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureRowHostComponent);
    fixture.detectChanges();
  });

  // On touch the "more" button is hidden, so the row itself must open the menu.
  it('opts its row menu into touch long-press', () => {
    const contextMenu = fixture.debugElement
      .query(By.directive(ContextMenuComponent))
      .injector.get(ContextMenuComponent);

    expect(contextMenu.isTouchLongPress()).toBeTrue();
  });

  // The button stays in the DOM (and the tab order) for keyboard and
  // screen-reader users; only touch styling takes it out of sight.
  it('keeps the more-actions button in the DOM', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.additional-btn');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });
});

@Component({
  selector: 'work-context-menu',
  imports: [MatMenu],
  template: '<mat-menu />',
})
class CountTestContextMenuComponent {
  readonly contextId = input('');
  readonly contextType = input<WorkContextType>();
  readonly menu = viewChild.required(MatMenu);
}
describe('NavItemComponent Today count', () => {
  let fixture: ComponentFixture<NavItemComponent>;
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.overrideComponent(NavItemComponent, {
      remove: { imports: [WorkContextMenuComponent] },
      add: { imports: [CountTestContextMenuComponent] },
    })
      .configureTestingModule({
        imports: [NavItemComponent, NoopAnimationsModule, TranslateModule.forRoot()],
        providers: [
          provideRouter([]),
          provideMockStore({
            selectors: [
              { selector: selectAllDoneIds, value: ['done'] },
              {
                selector: selectDueTaskCounts,
                value: { today: 8, overdue: 7, total: 15 },
              },
            ],
          }),
          { provide: GlobalThemeService, useValue: { registerSvgIcon: () => undefined } },
          { provide: MagicNavConfigService, useValue: {} },
        ],
      })
      .compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      G: { TODAY_TASK_COUNT: '{{today}} today · {{overdue}} overdue' },
    });
    translate.use('en');
    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(NavItemComponent);
    fixture.componentRef.setInput('type', WorkContextType.TAG);
    fixture.componentRef.setInput('workContext', { ...TODAY_TAG, taskIds: ['one'] });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the shared badge total and the Today/overdue tooltip on both the row and count', () => {
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(15);
    expect(fixture.nativeElement.querySelector('.task-count').textContent.trim()).toBe(
      '15',
    );
    expect(fixture.nativeElement.querySelector('.nav-link').getAttribute('title')).toBe(
      '8 today · 7 overdue',
    );
    expect(fixture.nativeElement.querySelector('.task-count').getAttribute('title')).toBe(
      '8 today · 7 overdue',
    );
  });

  it('includes overdue tasks even when the stored Today ordering is empty', () => {
    fixture.componentRef.setInput('workContext', { ...TODAY_TAG, taskIds: [] });
    store.overrideSelector(selectDueTaskCounts, { today: 0, overdue: 7, total: 7 });
    store.refreshState();
    fixture.detectChanges();
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(7);
    expect(fixture.nativeElement.querySelector('.task-count').getAttribute('title')).toBe(
      '0 today · 7 overdue',
    );
  });

  it('updates the total and breakdown together when tasks change', () => {
    store.overrideSelector(selectDueTaskCounts, { today: 7, overdue: 6, total: 13 });
    store.refreshState();
    fixture.detectChanges();
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(13);
    expect(fixture.nativeElement.querySelector('.nav-link').getAttribute('title')).toBe(
      '7 today · 6 overdue',
    );
  });

  it('preserves project counts and leaves them without the Today tooltip', async () => {
    fixture.componentRef.setInput('type', WorkContextType.PROJECT);
    fixture.componentRef.setInput('workContext', {
      ...TODAY_TAG,
      id: 'project',
      taskIds: ['one', 'done'],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.nav-link').getAttribute('title'),
    ).toBeNull();
  });
});
