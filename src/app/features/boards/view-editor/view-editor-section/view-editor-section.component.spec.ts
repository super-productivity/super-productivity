import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ViewEditorSectionComponent } from './view-editor-section.component';
import { DEFAULT_PANEL_CFG } from '../../boards.const';
import { BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../../boards.model';
import { ProjectService } from '../../../project/project.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { TagService } from '../../../tag/tag.service';
import { T } from '../../../../t.const';
import { TODAY_TAG } from '../../../tag/tag.const';

describe('ViewEditorSectionComponent', () => {
  let fixture: ComponentFixture<ViewEditorSectionComponent>;
  let emitted: BoardPanelCfg[];
  let overlay: HTMLElement;
  let addTag: jasmine.Spy;
  let tags: ReturnType<typeof signal<{ id: string; title: string }[]>>;
  const projects = signal<{ id: string; title: string }[]>([]);

  const TAGS = [
    { id: 'urgent', title: 'Urgent', icon: 'priority_high', color: '#f00' },
    { id: 'home', title: 'Home', icon: null, theme: { primary: '#0f0' } },
  ];

  const render = async (
    fields: Partial<BoardPanelCfg> = {},
    isShowTitle: boolean = true,
  ): Promise<HTMLElement> => {
    tags = signal<{ id: string; title: string }[]>(TAGS);
    addTag = jasmine.createSpy('addTag').and.callFake(({ title }: { title: string }) => {
      tags.set([...tags(), { id: 'new-tag', title }]);
      return 'new-tag';
    });
    await TestBed.configureTestingModule({
      imports: [ViewEditorSectionComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: ProjectService, useValue: { listInTreeOrder: projects } },
        { provide: MenuTreeService, useValue: { projectFolderMap: signal(new Map()) } },
        {
          provide: TagService,
          useValue: { tags, tagsInTreeOrder: tags, addTag },
        },
      ],
    }).compileComponents();
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
    fixture = TestBed.createComponent(ViewEditorSectionComponent);
    emitted = [];
    fixture.componentInstance.panelChange.subscribe((panel) => {
      emitted.push(panel);
      fixture.componentRef.setInput('panel', panel);
    });
    fixture.componentRef.setInput('panel', {
      ...DEFAULT_PANEL_CFG,
      id: 'p',
      title: 'Next',
      ...fields,
    } as BoardPanelCfg);
    fixture.componentRef.setInput('isShowTitle', isShowTitle);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const text = (el: Element | null): string =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const menuItems = (): HTMLButtonElement[] =>
    Array.from(overlay.querySelectorAll('[mat-menu-item]'));

  beforeEach(() => projects.set([]));

  it('does not create a tag or change rules on Enter in the project filter', async () => {
    projects.set(
      Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, title: `Project ${i}` })),
    );
    const el = await render({ projectIds: ['p0'] });
    (el.querySelector('view-rule-chip .chip-main') as HTMLElement).click();
    fixture.detectChanges();
    const filter = overlay.querySelector('input') as HTMLInputElement;
    filter.value = 'Project 1';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(addTag).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(filter.value).toBe('Project 1');
  });

  it('shows the only section of a list as labelled Rules and Sort rows', async () => {
    const el = await render({}, false);

    const labels = Array.from(el.querySelectorAll('.form-label')).map(text);
    expect(labels[0]).toContain(T.F.BOARDS.EDITOR.RULES);
    // Its count sits under the Rules label: there is no header.
    expect(labels[0]).toContain(T.F.BOARDS.EDITOR.COUNT);
    expect(labels[1]).toBe(T.F.BOARDS.FORM.SORT_BY);
    // The same open card as with several sections, only without its bar.
    expect(el.querySelector('.card.is-open')).not.toBeNull();
    expect(el.querySelector('.section-header')).toBeNull();
    expect(el.querySelector('view-editor-title')).toBeNull();
    expect(el.querySelector('view-add-rule-chip')).not.toBeNull();
  });

  it('shows a card with a drag handle and the title as text', async () => {
    const el = await render();

    expect(el.querySelector('.card .drag-handle')).not.toBeNull();
    expect(text(el.querySelector('view-editor-title .title-text'))).toBe('Next');
    expect(el.querySelector('input')).toBeNull();
  });

  describe('a collapsible card', () => {
    let toggled: jasmine.Spy;

    const renderCollapsed = async (): Promise<HTMLElement> => {
      const el = await render();
      fixture.componentRef.setInput('isCollapsible', true);
      fixture.componentRef.setInput('isOpen', false);
      toggled = jasmine
        .createSpy('toggleOpen')
        .and.callFake(() =>
          fixture.componentRef.setInput('isOpen', !fixture.componentInstance.isOpen()),
        );
      fixture.componentInstance.toggleOpen.subscribe(toggled);
      fixture.detectChanges();
      return el;
    };

    it('keeps its chevron, and the focus on it, when it opens and closes', async () => {
      const el = await renderCollapsed();
      const toggle = el.querySelector('.section-toggle') as HTMLButtonElement;
      toggle.focus();
      toggle.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector('view-rule-chip, view-add-rule-chip')).not.toBeNull();
      expect(document.activeElement).toBe(toggle);

      toggle.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(el.querySelector('.summary')).not.toBeNull();
    });

    it('toggles on a click anywhere on its bar, its title too', async () => {
      const el = await renderCollapsed();
      (el.querySelector('.section-title') as HTMLElement).click();
      fixture.detectChanges();
      (el.querySelector('.section-header') as HTMLElement).click();

      expect(toggled).toHaveBeenCalledTimes(2);
    });

    it('counts its tasks under the Rules label once open, not in its bar', async () => {
      const el = await renderCollapsed();
      expect(el.querySelector('.count')).toBeNull();
      (el.querySelector('.section-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.section-header .count')).toBeNull();
      expect(el.querySelector('.form-label .count')).not.toBeNull();
    });

    it("doesn't toggle on its bar's buttons other than the chevron", async () => {
      const el = await renderCollapsed();
      (el.querySelector('.section-menu-btn') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(toggled).not.toHaveBeenCalled();
    });

    it('renames on a click on the title once open', async () => {
      const el = await renderCollapsed();
      expect(el.querySelector('view-editor-title')).toBeNull();
      (el.querySelector('.section-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();
      (el.querySelector('view-editor-title .title-text') as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector('view-editor-title input')).not.toBeNull();
      expect(toggled).toHaveBeenCalledTimes(1);
    });
  });

  it('renames on a click on the title, back to text on Enter', async () => {
    const el = await render();
    (el.querySelector('view-editor-title .title-text') as HTMLElement).click();
    fixture.detectChanges();
    const input = el.querySelector('view-editor-title input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Later';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(emitted.at(-1)?.title).toBe('Later');
    expect(el.querySelector('view-editor-title input')).toBeNull();
    expect(text(el.querySelector('view-editor-title .title-text'))).toBe('Later');
  });

  it('keeps the title field open while Enter confirms IME composition', async () => {
    const el = await render();
    (el.querySelector('view-editor-title .title-text') as HTMLElement).click();
    fixture.detectChanges();
    const input = el.querySelector('view-editor-title input') as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }),
    );
    fixture.detectChanges();
    expect(el.querySelector('view-editor-title input')).toBe(input);
  });

  it('shows a chip per rule with its tags, missing ones and a non-default match', async () => {
    const el = await render({
      includedTagIds: ['urgent', 'gone', 'home'],
      includedTagsMatch: 'any',
      isParentTasksOnly: true,
    });

    const tagChip = el.querySelector('view-rule-chip[data-rule="includedTags"]')!;
    expect(tagChip.querySelectorAll('tag').length).toBe(2);
    expect(text(tagChip)).toContain(T.F.BOARDS.EDITOR.MISSING_TAG);
    expect(text(tagChip)).toContain(T.F.BOARDS.FORM.TAGS_MATCH_ANY);
    expect(tagChip.querySelector('.chip--warn')).not.toBeNull();
    // A flag has no menu, only its remove button.
    const flag = el.querySelector('view-rule-chip[data-rule="parentOnly"]')!;
    expect(flag.querySelector('button.chip-main')).toBeNull();
    expect(flag.querySelector('.chip-remove')!.getAttribute('aria-label')).toContain(
      T.F.BOARDS.EDITOR.REMOVE_RULE,
    );
  });

  it('toggles a tag in its menu without closing it, keeping missing ids', async () => {
    const el = await render({ includedTagIds: ['urgent', 'gone'] });
    (
      el.querySelector(
        'view-rule-chip[data-rule="includedTags"] .chip-main',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    const home = menuItems().find((item) => text(item).includes('Home'))!;
    home.click();
    fixture.detectChanges();
    expect(emitted.at(-1)?.includedTagIds).toEqual(['urgent', 'gone', 'home']);
    expect(overlay.querySelector('.mat-mdc-menu-panel')).not.toBeNull();
  });

  it('does not offer the virtual Today tag in a tag menu', async () => {
    const el = await render({ includedTagIds: ['urgent'] });
    tags.set([...TAGS, { id: TODAY_TAG.id, title: 'Today' }]);
    (
      el.querySelector(
        'view-rule-chip[data-rule="includedTags"] .chip-main',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();

    const titles = menuItems().map((item) => text(item));
    expect(titles.some((t) => t.includes('Home'))).toBeTrue();
    expect(titles.some((t) => t.includes('Today'))).toBeFalse();
  });

  it('disables set and contradicting rules in the Add-rule menu', async () => {
    const el = await render({ includedTagIds: ['urgent'] });
    (el.querySelector('view-add-rule-chip .add-rule') as HTMLElement).click();
    fixture.detectChanges();
    const item = (label: string): HTMLButtonElement =>
      menuItems().find((i) => text(i).includes(label))!;

    expect(text(overlay)).toContain(T.F.BOARDS.EDITOR.GROUP_WHERE);
    expect(item(T.F.BOARDS.FORM.TAGS_REQUIRED).disabled).toBeTrue();
    expect(text(item(T.F.BOARDS.FORM.TAGS_REQUIRED))).toContain(
      T.F.BOARDS.EDITOR.ALREADY_SET,
    );
    const untagged = item(T.F.BOARDS.EDITOR.RULE_UNTAGGED);
    expect(untagged.disabled).toBeTrue();
    expect(text(untagged)).toContain(T.F.BOARDS.EDITOR.CONFLICTS_WITH);
    expect(item(T.F.BOARDS.EDITOR.RULE_DONE).disabled).toBeFalse();
  });

  it('picks the sort and, in the same menu, its direction; manual order has none', async () => {
    const el = await render();
    (el.querySelector('view-sort-chip .chip-main') as HTMLElement).click();
    fixture.detectChanges();
    expect(text(overlay)).not.toContain(T.F.BOARDS.FORM.SORT_DIR_DESC);
    menuItems()
      .find((i) => text(i).includes(T.F.BOARDS.FORM.SORT_BY_TITLE))!
      .click();
    fixture.detectChanges();
    expect(emitted.at(-1)?.sortKey).toBe('title');
    // The menu stays open, now with the direction.
    expect(overlay.querySelector('.mat-mdc-menu-panel')).not.toBeNull();
    menuItems()
      .find((i) => text(i).includes(T.F.BOARDS.FORM.SORT_DIR_DESC))!
      .click();
    fixture.detectChanges();
    expect(emitted.at(-1)?.sortDir).toBe('desc');
    expect(text(el.querySelector('view-sort-chip'))).toContain('↓');
  });

  describe('the tag menu filter', () => {
    const openTagMenu = async (fields: Partial<BoardPanelCfg>): Promise<HTMLElement> => {
      const el = await render(fields);
      (el.querySelector('view-rule-chip[data-rule] .chip-main') as HTMLElement).click();
      fixture.detectChanges();
      return el;
    };
    const filterInput = (): HTMLInputElement =>
      overlay.querySelector('.menu-filter input') as HTMLInputElement;
    const type = (value: string): void => {
      filterInput().value = value;
      filterInput().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const tagItems = (): string[] =>
      Array.from(overlay.querySelectorAll('[role="menuitemcheckbox"]')).map((i) =>
        text(i),
      );
    const createItem = (): HTMLButtonElement | undefined =>
      menuItems().find((i) => text(i).includes(T.F.BOARDS.EDITOR.CREATE_TAG));

    it('filters the tags by title, ignoring case', async () => {
      await openTagMenu({ includedTagIds: ['urgent'] });
      expect(tagItems().length).toBe(2);
      type('hO');
      expect(tagItems()).toEqual(['Home']);
      type('');
      expect(tagItems().length).toBe(2);
    });

    it('creates a tag from the filter and adds it to the rule, menu open', async () => {
      await openTagMenu({ excludedTagIds: ['urgent'] });
      type('#Errands');
      createItem()!.click();
      fixture.detectChanges();
      expect(addTag).toHaveBeenCalledOnceWith({ title: 'Errands' });
      expect(emitted.at(-1)?.excludedTagIds).toEqual(['urgent', 'new-tag']);
      expect(emitted.at(-1)?.includedTagIds).toEqual([]);
      expect(filterInput().value).toBe('');
      expect(overlay.querySelector('.mat-mdc-menu-panel')).not.toBeNull();
      expect(tagItems()).toContain('Errands');
    });

    it('creates the tag on Enter in the filter', async () => {
      await openTagMenu({ includedTagIds: ['urgent'] });
      type('Garden');
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      filterInput().dispatchEvent(enter);
      fixture.detectChanges();
      expect(addTag).toHaveBeenCalledOnceWith({ title: 'Garden' });
      expect(emitted.at(-1)?.includedTagIds).toEqual(['urgent', 'new-tag']);
    });

    it('does not create a tag while Enter is confirming IME composition', async () => {
      await openTagMenu({ includedTagIds: ['urgent'] });
      type('庭');
      filterInput().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          isComposing: true,
        }),
      );
      expect(addTag).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('offers no create for an existing title or an empty filter', async () => {
      await openTagMenu({ includedTagIds: ['urgent'] });
      expect(createItem()).toBeUndefined();
      type('  home ');
      expect(createItem()).toBeUndefined();
      type('hom');
      expect(createItem()).toBeDefined();
      expect(addTag).not.toHaveBeenCalled();
    });

    it('keeps typed keys from the menu (typeahead, navigation)', async () => {
      await openTagMenu({ includedTagIds: ['urgent'] });
      const key = new KeyboardEvent('keydown', { key: 'h', bubbles: true });
      const stop = spyOn(key, 'stopPropagation').and.callThrough();
      filterInput().dispatchEvent(key);
      expect(stop).toHaveBeenCalled();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const keepEscape = spyOn(escape, 'stopPropagation').and.callThrough();
      filterInput().dispatchEvent(escape);
      expect(keepEscape).not.toHaveBeenCalled();
    });
  });

  it('shows the completion help only for a Done section with tag rules', async () => {
    const el = await render();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      [T.F.BOARDS.EDITOR.DONE_TAG_FILTER_HINT]: 'Completion tag help',
    });
    translate.use('en');

    for (const taskDoneState of [
      BoardPanelCfgTaskDoneState.All,
      BoardPanelCfgTaskDoneState.Done,
      BoardPanelCfgTaskDoneState.UnDone,
    ]) {
      for (const tagRules of [
        { includedTagIds: [], excludedTagIds: [] },
        { includedTagIds: ['urgent'], excludedTagIds: [] },
        { includedTagIds: [], excludedTagIds: ['home'] },
      ]) {
        fixture.componentRef.setInput('panel', {
          ...DEFAULT_PANEL_CFG,
          id: 'p',
          title: 'Next',
          taskDoneState,
          ...tagRules,
        });
        fixture.detectChanges();

        expect(text(el).includes('Completion tag help')).toBe(
          taskDoneState === BoardPanelCfgTaskDoneState.Done &&
            !!(tagRules.includedTagIds.length || tagRules.excludedTagIds.length),
        );
      }
    }
    expect(emitted).toEqual([]);
  });
});
