import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { BoardsService } from '../../boards/boards.service';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../../project/project.const';
import { Project } from '../../project/project.model';
import { ProjectService } from '../../project/project.service';
import { DefaultStartPage } from '../default-start-page.const';
import { GlobalConfigService } from '../global-config.service';
import { StartPageSelectComponent } from './start-page-select.component';

describe('StartPageSelectComponent', () => {
  let fixture: ComponentFixture<StartPageSelectComponent>;
  let control: FormControl<number | string>;
  let visibleProjects: WritableSignal<Project[]>;

  beforeEach(async () => {
    visibleProjects = signal([
      { ...DEFAULT_PROJECT, id: 'work', title: 'Work' },
      INBOX_PROJECT,
    ]);
    await TestBed.configureTestingModule({
      imports: [StartPageSelectComponent],
      providers: [
        provideTranslateService(),
        {
          provide: ProjectService,
          useValue: { listInTreeOrderForUI: visibleProjects },
        },
        { provide: GlobalConfigService, useValue: { appFeatures: () => ({}) } },
        { provide: BoardsService, useValue: { boards: () => [] } },
      ],
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('zh', {
      G: { TODAY_TAG_TITLE: '今天', INBOX_PROJECT_TITLE: '收件箱' },
    });
    await firstValueFrom(translateService.use('zh'));
    fixture = TestBed.createComponent(StartPageSelectComponent);
    control = new FormControl<number | string>(DefaultStartPage.Today, {
      nonNullable: true,
    });
    fixture.componentInstance.field = {
      id: 'start-page',
      formControl: control,
      options: { showError: () => false },
    };
  });

  const getSelect = (): Promise<MatSelectHarness> =>
    TestbedHarnessEnvironment.loader(fixture).getHarness(MatSelectHarness);

  it('shows a single translated Inbox choice next to Today and stores its project ID', async () => {
    const select = await getSelect();
    await select.open();
    const options = await select.getOptions();
    const titles = await Promise.all(options.map((option) => option.getText()));

    expect(titles.slice(0, 2)).toEqual(['今天', '收件箱']);
    expect(options.length).toBe(3);
    await options[1].click();

    expect(control.value).toBe(INBOX_PROJECT.id);
  });

  it('does not offer a new Inbox selection when Inbox is hidden from the menu', async () => {
    visibleProjects.update((projects) =>
      projects.filter((project) => project.id !== INBOX_PROJECT.id),
    );
    const select = await getSelect();
    await select.open();

    expect(await select.getOptions({ text: '收件箱' })).toEqual([]);
  });

  it('still shows the Inbox label for an existing numeric Inbox selection', async () => {
    control.setValue(DefaultStartPage.Inbox);
    const select = await getSelect();

    expect(await select.getValueText()).toBe('收件箱');
    expect(control.value).toBe(DefaultStartPage.Inbox);
  });
});
