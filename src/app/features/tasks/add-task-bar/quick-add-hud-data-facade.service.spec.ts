import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QuickAddHudDataFacadeService } from './quick-add-hud-data-facade.service';
import { ADD_TASK_BAR_DATA_FACADE } from './add-task-bar-data-facade.token';
import { TaskReminderOptionId } from '../task.model';
import type { QuickAddHudSnapshot } from './quick-add-hud.model';

describe('QuickAddHudDataFacadeService', () => {
  let service: QuickAddHudDataFacadeService;
  let translateService: TranslateService;
  let originalElectronApi: typeof window.ea | undefined;

  const createSnapshot = (lng: string): QuickAddHudSnapshot => ({
    projects: [],
    tags: [],
    defaultProjectId: null,
    defaultTaskRemindOption: TaskReminderOptionId.DoNotRemind,
    shortSyntax: {
      isEnableProject: true,
      isEnableDue: true,
      isEnableTag: true,
    },
    activeWorkContext: null,
    todayStr: '2024-01-01',
    dateTimeLocale: 'en-US',
    lng,
    folderPaths: {
      projects: {},
      tags: {},
    },
    theme: {
      htmlClasses: [],
      bodyClasses: [],
      htmlCssVars: {},
      bodyCssVars: {},
    },
  });

  beforeEach(() => {
    originalElectronApi = window.ea;
    (window as any).ea = {
      requestQuickAddSnapshot: jasmine
        .createSpy('requestQuickAddSnapshot')
        .and.resolveTo({ ok: true, snapshot: createSnapshot('de') }),
      onQuickAddOpened: jasmine.createSpy('onQuickAddOpened').and.returnValue(() => {}),
    };

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        QuickAddHudDataFacadeService,
        {
          provide: ADD_TASK_BAR_DATA_FACADE,
          useExisting: QuickAddHudDataFacadeService,
        },
      ],
    });

    service = TestBed.inject(QuickAddHudDataFacadeService);
    translateService = TestBed.inject(TranslateService);
    spyOn(translateService, 'use').and.callThrough();
  });

  afterEach(() => {
    window.ea = originalElectronApi as typeof window.ea;
  });

  it('should switch TranslateService to the lng from the snapshot', async () => {
    await service.refreshSnapshot();

    expect(service.isReady()).toBe(true);
    expect(translateService.use).toHaveBeenCalledWith('de');
  });

  it('should fall back to English when snapshot lng is empty', async () => {
    (window.ea.requestQuickAddSnapshot as jasmine.Spy).and.resolveTo({
      ok: true,
      snapshot: { ...createSnapshot('de'), lng: '' },
    });

    await service.refreshSnapshot();

    expect(translateService.use).toHaveBeenCalledWith('en');
  });

  it('should switch language when a new snapshot has a different lng', async () => {
    await service.refreshSnapshot();
    expect(translateService.use).toHaveBeenCalledWith('de');

    (window.ea.requestQuickAddSnapshot as jasmine.Spy).and.resolveTo({
      ok: true,
      snapshot: createSnapshot('fr'),
    });

    await service.refreshSnapshot();

    expect(translateService.use).toHaveBeenCalledWith('fr');
  });
});
