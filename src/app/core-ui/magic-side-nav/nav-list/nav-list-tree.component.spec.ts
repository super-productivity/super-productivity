import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DEFAULT_PROJECT } from '../../../features/project/project.const';
import { Project } from '../../../features/project/project.model';
import { MenuTreeKind } from '../../../features/menu-tree/store/menu-tree.model';
import { MenuTreeService } from '../../../features/menu-tree/menu-tree.service';
import { TreeDndComponent } from '../../../ui/tree-dnd/tree.component';
import { MagicNavConfigService } from '../magic-nav-config.service';
import { NavTreeItem } from '../magic-side-nav.model';
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
