import { Component, signal } from '@angular/core';
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
import {
  MenuTreeKind,
  MenuTreeViewNode,
} from '../../../features/menu-tree/store/menu-tree.model';

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
  template: `
    <nav-item
      [mode]="'folder'"
      [folderId]="'folder-f1'"
      [label]="'Folder'"
      [folderChildren]="children()"
      [expanded]="expanded()"
    ></nav-item>
  `,
  imports: [NavItemComponent],
})
class FolderHostComponent {
  readonly children = signal<MenuTreeViewNode[]>([]);
  readonly expanded = signal(false);
}

describe('NavItemComponent folder open-task count (#5931)', () => {
  let fixture: ComponentFixture<FolderHostComponent>;

  const project = (id: string, taskIds: string[]): MenuTreeViewNode =>
    ({ k: MenuTreeKind.PROJECT, project: { id, taskIds } }) as MenuTreeViewNode;
  const tag = (id: string, taskIds: string[]): MenuTreeViewNode =>
    ({ k: MenuTreeKind.TAG, tag: { id, taskIds } }) as MenuTreeViewNode;
  const folder = (id: string, children: MenuTreeViewNode[]): MenuTreeViewNode => ({
    k: MenuTreeKind.FOLDER,
    id,
    name: id,
    isExpanded: true,
    children,
  });
  const countText = (): string | undefined =>
    fixture.nativeElement.querySelector('.task-count')?.textContent?.trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FolderHostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideMockStore({ selectors: [{ selector: selectAllDoneIds, value: ['t3'] }] }),
        { provide: GlobalThemeService, useValue: { registerSvgIcon: () => undefined } },
        { provide: MagicNavConfigService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderHostComponent);
  });

  it('shows no count for an empty folder', () => {
    fixture.detectChanges();
    expect(countText()).toBeUndefined();
  });

  it('sums the open tasks of the projects inside, skipping done ones', () => {
    fixture.componentInstance.children.set([
      project('p1', ['t1', 't2']),
      project('p2', ['t3', 't4']),
    ]);
    fixture.detectChanges();

    expect(countText()).toBe('3');
  });

  it('includes nested folders', () => {
    fixture.componentInstance.children.set([
      project('p1', ['t1']),
      folder('inner', [project('p2', ['t2']), folder('deep', [project('p3', ['t5'])])]),
    ]);
    fixture.detectChanges();

    expect(countText()).toBe('3');
  });

  it('counts a task that is in several tags only once', () => {
    fixture.componentInstance.children.set([tag('a', ['t1', 't2']), tag('b', ['t2'])]);
    fixture.detectChanges();

    expect(countText()).toBe('2');
  });

  it('hides the count while the folder is expanded', () => {
    fixture.componentInstance.children.set([project('p1', ['t1', 't2'])]);
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    expect(countText()).toBeUndefined();

    fixture.componentInstance.expanded.set(false);
    fixture.detectChanges();

    expect(countText()).toBe('2');
  });
});
