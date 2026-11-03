import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ViewEditorSectionComponent } from './view-editor-section.component';
import { DEFAULT_PANEL_CFG } from '../../boards.const';
import { BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../../boards.model';
import { ProjectService } from '../../../project/project.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { TagService } from '../../../tag/tag.service';
import { TaskService } from '../../../tasks/task.service';
import { T } from '../../../../t.const';

describe('ViewEditorSectionComponent', () => {
  let fixture: ComponentFixture<ViewEditorSectionComponent>;

  const render = async (isShowTitle: boolean): Promise<HTMLElement> => {
    await TestBed.configureTestingModule({
      imports: [ViewEditorSectionComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: TaskService, useValue: {} },
        { provide: ProjectService, useValue: { listInTreeOrder: signal([]) } },
        { provide: MenuTreeService, useValue: { projectFolderMap: signal(new Map()) } },
        {
          provide: TagService,
          useValue: {
            tags: signal([]),
            tagsInTreeOrder: signal([]),
            tagsNoMyDayAndNoListInTreeOrder: signal([]),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ViewEditorSectionComponent);
    fixture.componentRef.setInput('panel', {
      ...DEFAULT_PANEL_CFG,
      id: 'p',
      title: 'Next',
    } as BoardPanelCfg);
    fixture.componentRef.setInput('isShowTitle', isShowTitle);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('puts the rules label in the header when the title is hidden', async () => {
    const el = await render(false);

    const header = el.querySelector('.section-header')!;
    expect(header.querySelector('.section-label')?.textContent).toContain(
      T.F.BOARDS.EDITOR.SHOW_TASKS_THAT_MATCH,
    );
    expect(header.querySelector('input')).toBeNull();
    expect(el.querySelector('.rules-heading')).toBeNull();
  });

  it('keeps the label below a shown title', async () => {
    const el = await render(true);

    expect(el.querySelector('.section-header input')).not.toBeNull();
    expect(el.querySelector('.section-label')).toBeNull();
    expect(el.querySelector('.rules-heading')?.textContent).toContain(
      T.F.BOARDS.EDITOR.SHOW_TASKS_THAT_MATCH,
    );
  });

  it('updates translated completion help when completion and tag rules change', async () => {
    const el = await render(true);
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      [T.F.BOARDS.EDITOR.DONE_TAG_FILTER_HINT]: 'Completion tag help',
    });
    translate.use('en');
    const changed = jasmine.createSpy('panelChange');
    fixture.componentInstance.panelChange.subscribe(changed);

    for (const taskDoneState of [
      BoardPanelCfgTaskDoneState.All,
      BoardPanelCfgTaskDoneState.Done,
      BoardPanelCfgTaskDoneState.UnDone,
    ]) {
      for (const tags of [
        { includedTagIds: [], excludedTagIds: [] },
        { includedTagIds: ['tag1'], excludedTagIds: [] },
        { includedTagIds: [], excludedTagIds: ['tag2'] },
        { includedTagIds: [], excludedTagIds: [] },
      ]) {
        const panel = { ...DEFAULT_PANEL_CFG, title: 'Next', taskDoneState, ...tags };
        fixture.componentRef.setInput('panel', panel);
        fixture.detectChanges();

        expect(el.textContent?.includes('Completion tag help')).toBe(
          taskDoneState === BoardPanelCfgTaskDoneState.Done &&
            !!(tags.includedTagIds.length || tags.excludedTagIds.length),
        );
        expect(fixture.componentInstance.panel()).toEqual(panel);
      }
    }
    expect(changed).not.toHaveBeenCalled();
  });
});
