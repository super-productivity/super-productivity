import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideAnimations,
  provideNoopAnimations,
} from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { DEFAULT_PROJECT } from '../../../features/project/project.const';
import { Project } from '../../../features/project/project.model';
import { MenuTreeKind } from '../../../features/menu-tree/store/menu-tree.model';
import { MenuTreeService } from '../../../features/menu-tree/menu-tree.service';
import { selectAllDoneIds } from '../../../features/tasks/store/task.selectors';
import { TreeDndComponent } from '../../../ui/tree-dnd/tree.component';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { NavItem, NavTreeItem } from '../magic-side-nav.model';
import { NavItemComponent } from '../nav-item/nav-item.component';
import {
  getProjectVisibilityIconColor,
  NavListTreeComponent,
} from './nav-list-tree.component';

const createProject = (
  overrides: Omit<Partial<Project>, 'theme'> & {
    theme?: Partial<Project['theme']>;
  },
): Project => ({
  ...DEFAULT_PROJECT,
  id: 'project-id',
  title: 'Project',
  ...overrides,
  theme: {
    ...DEFAULT_PROJECT.theme,
    ...overrides.theme,
  },
});

describe('getProjectVisibilityIconColor', () => {
  it('returns the project primary color for material icons', () => {
    const project = createProject({
      icon: 'work',
      theme: { primary: '#123456' },
    });

    expect(getProjectVisibilityIconColor(project)).toBe('#123456');
  });

  it('does not color emoji project icons', () => {
    const project = createProject({
      icon: '\u{1F680}',
      theme: { primary: '#123456' },
    });

    expect(getProjectVisibilityIconColor(project)).toBeNull();
  });

  it('uses the default material icon when a project has no icon', () => {
    const project = createProject({
      icon: undefined,
      theme: { primary: '#abcdef' },
    });

    expect(getProjectVisibilityIconColor(project)).toBe('#abcdef');
  });

  it('does not throw for a project persisted without a theme (#9139)', () => {
    // A project entity can reach the store with no `theme` at all. This helper
    // renders once per project in the side nav on every launch, and because
    // DEFAULT_PROJECT_ICON is not an emoji the theme branch is the DEFAULT
    // path — so an unguarded deref crashed the app at startup.
    // No `icon` here on purpose: that is the fall-through the comment
    // describes, so the fixture exercises the path it claims to.
    const project = createProject({});
    delete (project as unknown as Record<string, unknown>).theme;

    expect(getProjectVisibilityIconColor(project)).toBeNull();
  });
});

@Component({
  standalone: true,
  imports: [NavListTreeComponent],
  template: `<nav-list-tree
    [item]="item"
    [isExpanded]="isExpanded()"
  ></nav-list-tree>`,
})
class NavListTreeHostComponent {
  readonly item: NavTreeItem = {
    type: 'tree',
    id: 'projects',
    label: 'Projects',
    icon: 'list',
    treeKind: MenuTreeKind.PROJECT,
    tree: [],
  };
  readonly isExpanded = signal(true);
}

describe('NavListTreeComponent expand/collapse animation', () => {
  let fixture: ComponentFixture<NavListTreeHostComponent>;

  const getChildrenEls = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.nav-children'));
  const getChildrenEl = (): HTMLElement | null => getChildrenEls()[0] ?? null;

  const setExpanded = (isExpanded: boolean): void => {
    fixture.componentInstance.isExpanded.set(isExpanded);
    fixture.detectChanges();
  };

  const waitForAnimationsToFinish = async (el: HTMLElement): Promise<void> => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
    // The engine detaches a leaving element in a task queued after the end.
    await new Promise((resolve) => setTimeout(resolve));
  };

  // Seeks the element's height animation and returns its computed style there.
  const sampleAnimationAt = (el: HTMLElement, progress: number): CSSStyleDeclaration => {
    const [animation] = el.getAnimations();
    const duration = animation.effect!.getComputedTiming().duration as number;
    animation.currentTime = duration * progress;
    return getComputedStyle(el);
  };

  const getMarginSum = (cs: CSSStyleDeclaration): number =>
    parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavListTreeHostComponent, TranslateModule.forRoot()],
      providers: [
        provideAnimations(),
        provideRouter([]),
        {
          provide: MagicNavConfigService,
          useValue: {
            allUnarchivedProjects: signal([]),
            archivedProjectsCount: signal(0),
          },
        },
        { provide: MenuTreeService, useValue: {} },
      ],
    })
      .overrideComponent(NavListTreeComponent, {
        remove: { imports: [NavItemComponent, TreeDndComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(NavListTreeHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('does not animate the list on initial render', () => {
    expect(getChildrenEl()?.getAnimations().length).toBe(0);
  });

  it('animates collapsing and removes the list afterwards (#10471)', async () => {
    setExpanded(false);

    // The :leave animation keeps the element in the DOM until it finishes.
    const leavingEl = getChildrenEl();
    expect(leavingEl).not.toBeNull();
    expect(leavingEl!.getAnimations().length).toBeGreaterThan(0);

    await waitForAnimationsToFinish(leavingEl!);
    expect(getChildrenEl()).toBeNull();
  });

  it('animates expanding', async () => {
    setExpanded(false);
    await waitForAnimationsToFinish(getChildrenEl()!);
    expect(getChildrenEl()).toBeNull();

    setExpanded(true);

    expect(getChildrenEls().length).toBe(1);
    expect(getChildrenEl()!.getAnimations().length).toBeGreaterThan(0);
  });

  // overflow is discrete: if it changed between keyframes it would flip at 50%
  // and let the items spill over the content below until then. Margins that do
  // not shrink with the height make the content below jump on insert/removal.
  it('clips the list and shrinks its margins while collapsing', () => {
    setExpanded(false);
    const leavingEl = getChildrenEl()!;

    expect(sampleAnimationAt(leavingEl, 0.25).overflow).toBe('hidden');
    expect(sampleAnimationAt(leavingEl, 0.75).overflow).toBe('hidden');
    expect(getMarginSum(sampleAnimationAt(leavingEl, 0.999))).toBeLessThan(0.5);
  });

  it('clips the list and grows its margins from zero while expanding', async () => {
    setExpanded(false);
    await waitForAnimationsToFinish(getChildrenEl()!);
    setExpanded(true);
    const enteringEl = getChildrenEl()!;

    expect(getMarginSum(sampleAnimationAt(enteringEl, 0.001))).toBeLessThan(0.5);
    expect(sampleAnimationAt(enteringEl, 0.25).overflow).toBe('hidden');
    expect(sampleAnimationAt(enteringEl, 0.75).overflow).toBe('hidden');
  });
});

@Component({
  standalone: true,
  imports: [NavListTreeComponent],
  template: `<nav-list-tree
    [item]="item()"
    [isExpanded]="isExpanded()"
    (itemClick)="clickedItems.push($event)"
  ></nav-list-tree>`,
})
class ArchivedProjectsLinkHostComponent {
  readonly item = signal<NavTreeItem>({
    type: 'tree',
    id: 'projects',
    label: 'Projects',
    icon: 'expand_more',
    treeKind: MenuTreeKind.PROJECT,
    tree: [],
  });
  readonly isExpanded = signal(true);
  readonly clickedItems: NavItem[] = [];
}

describe('NavListTreeComponent archived projects link (#10473)', () => {
  let fixture: ComponentFixture<ArchivedProjectsLinkHostComponent>;
  const archivedProjectsCount = signal(0);

  const getLink = (): HTMLAnchorElement | null =>
    fixture.nativeElement.querySelector('.archived-projects-link a');
  const getLabel = (): string | undefined =>
    getLink()?.querySelector('.nav-label')?.textContent?.trim();

  beforeEach(async () => {
    archivedProjectsCount.set(2);
    await TestBed.configureTestingModule({
      imports: [ArchivedProjectsLinkHostComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        provideRouter([{ path: 'archived-projects', children: [] }]),
        provideMockStore({ selectors: [{ selector: selectAllDoneIds, value: [] }] }),
        { provide: GlobalThemeService, useValue: {} },
        {
          provide: MagicNavConfigService,
          useValue: { allUnarchivedProjects: signal([]), archivedProjectsCount },
        },
        { provide: MenuTreeService, useValue: {} },
      ],
    })
      .overrideComponent(NavListTreeComponent, {
        remove: { imports: [TreeDndComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('en', {
      F: { PROJECT: { ARCHIVED_PROJECTS: { LINK_LABEL: 'Archived projects' } } },
    });
    translateService.use('en');

    fixture = TestBed.createComponent(ArchivedProjectsLinkHostComponent);
    fixture.detectChanges();
  });

  it('links to the archived projects page and shows the count', () => {
    const link = getLink();

    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/archived-projects');
    expect(getLabel()).toBe('Archived projects (2)');
  });

  it('updates the count when another project is archived', () => {
    archivedProjectsCount.set(3);
    fixture.detectChanges();

    expect(getLabel()).toBe('Archived projects (3)');
  });

  it('is not shown while no project is archived', () => {
    archivedProjectsCount.set(0);
    fixture.detectChanges();

    expect(getLink()).toBeNull();
  });

  it('is not shown in the tags list', () => {
    fixture.componentInstance.item.set({
      type: 'tree',
      id: 'tags',
      label: 'Tags',
      icon: 'expand_more',
      treeKind: MenuTreeKind.TAG,
      tree: [],
    });
    fixture.detectChanges();

    expect(getLink()).toBeNull();
  });

  it('is hidden together with the collapsed projects list', async () => {
    fixture.componentInstance.isExpanded.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getLink()).toBeNull();
  });

  // magic-side-nav closes the mobile menu on itemClick; a navigation alone
  // does not happen when the page is already open.
  it('reports the click like the project rows do', () => {
    getLink()!.click();

    expect(fixture.componentInstance.clickedItems).toEqual([
      jasmine.objectContaining({ type: 'route', route: '/archived-projects' }),
    ]);
  });
});
