import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { ViewEditorSectionComponent } from './view-editor-section.component';
import { DEFAULT_PANEL_CFG } from '../../boards.const';
import { BoardPanelCfg } from '../../boards.model';
import { ProjectService } from '../../../project/project.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { TagService } from '../../../tag/tag.service';
import { T } from '../../../../t.const';

describe('ViewEditorSectionComponent', () => {
  let fixture: ComponentFixture<ViewEditorSectionComponent>;

  const render = async (isShowTitle: boolean): Promise<HTMLElement> => {
    await TestBed.configureTestingModule({
      imports: [ViewEditorSectionComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
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
});
