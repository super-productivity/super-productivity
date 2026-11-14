import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';

import { NavItemComponent } from './nav-item.component';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { MagicNavConfigService } from '../magic-nav-config.service';
import {
  selectTaskSchedulingSnapshot,
  selectAllTasks,
} from '../../../features/tasks/store/task.selectors';
import { selectArchivedProjectIds } from '../../../features/project/store/project.selectors';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';
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
        provideMockStore({
          selectors: [{ selector: selectTaskSchedulingSnapshot, value: [] }],
        }),
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
        provideMockStore({
          selectors: [{ selector: selectTaskSchedulingSnapshot, value: [] }],
        }),
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

describe('NavItemComponent open-task count', () => {
  let fixture: ComponentFixture<NavItemComponent>;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavItemComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectAllTasks,
              value: [
                {
                  ...DEFAULT_TASK,
                  id: 'active-open',
                  projectId: 'active',
                  isDone: false,
                  subTaskIds: [],
                },
                {
                  ...DEFAULT_TASK,
                  id: 'active-done',
                  projectId: 'active',
                  isDone: true,
                  subTaskIds: [],
                },
                {
                  ...DEFAULT_TASK,
                  id: 'archived-open',
                  projectId: 'archived',
                  isDone: false,
                  subTaskIds: [],
                },
                {
                  ...DEFAULT_TASK,
                  id: 'archived-done',
                  projectId: 'archived',
                  isDone: true,
                  subTaskIds: [],
                },
              ] as Task[],
            },
            { selector: selectArchivedProjectIds, value: new Set(['archived']) },
          ],
        }),
        { provide: GlobalThemeService, useValue: {} },
        { provide: MagicNavConfigService, useValue: {} },
      ],
    }).overrideComponent(NavItemComponent, { set: { template: '', imports: [] } });
    fixture = TestBed.createComponent(NavItemComponent);
    store = TestBed.inject(MockStore);
    fixture.componentRef.setInput('workContext', {
      id: 'tag',
      title: 'Tag',
      advancedCfg: {},
      theme: {},
      taskIds: [
        'active-open',
        'active-done',
        'archived-open',
        'archived-done',
        'missing',
      ],
    });
    fixture.detectChanges();
  });

  it('counts only existing undone tasks in active projects', () => {
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(1);
  });

  it('updates after archiving and unarchiving a project', () => {
    const archivedIds = store.overrideSelector(
      selectArchivedProjectIds,
      new Set<string>(),
    );
    store.refreshState();
    fixture.detectChanges();
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(2);

    archivedIds.setResult(new Set(['active', 'archived']));
    store.refreshState();
    fixture.detectChanges();
    expect(fixture.componentInstance.nrOfOpenTasks()).toBe(0);
  });
});
