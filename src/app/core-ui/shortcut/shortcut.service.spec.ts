import { TestBed } from '@angular/core/testing';
import { ShortcutService } from './shortcut.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { Router } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../../features/tasks/task.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ActivatedRoute } from '@angular/router';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { Store } from '@ngrx/store';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { TaskShortcutService } from '../../features/tasks/task-shortcut.service';
import { DialogAddNoteComponent } from '../../features/note/dialog-add-note/dialog-add-note.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { OverlayContainer } from '@angular/cdk/overlay';
import { signal } from '@angular/core';
import { of } from 'rxjs';

const PLUGIN_SHORTCUT_CFG_KEY = 'plugin_automations:r1';

describe('ShortcutService', () => {
  let service: ShortcutService;
  let mockTaskShortcutService: any;
  let mockRouter: any;
  let mockConfigService: any;
  let mockMatDialog: any;
  let mockPluginBridgeService: any;
  let mockLayoutService: any;

  beforeEach(() => {
    mockMatDialog = {
      openDialogs: [],
      open: jasmine.createSpy('open'),
    };
    mockTaskShortcutService = {
      handleTaskShortcuts: jasmine
        .createSpy('handleTaskShortcuts')
        .and.returnValue(false),
      handleTogglePlayFallback: jasmine
        .createSpy('handleTogglePlayFallback')
        .and.returnValue(false),
    };
    mockRouter = {
      navigate: jasmine.createSpy('navigate'),
      url: '/',
    };
    mockPluginBridgeService = {
      shortcuts: signal<any[]>([]),
      executeShortcut: jasmine.createSpy('executeShortcut'),
    };
    mockLayoutService = {
      isNavOpen: signal(false),
      showAddTaskBar: jasmine.createSpy('showAddTaskBar'),
    };
    mockConfigService = {
      cfg: signal({
        keyboard: {
          goToScheduledView: 'Shift+S',
          showHelp: '?',
          [PLUGIN_SHORTCUT_CFG_KEY]: 'Ctrl+Shift+U',
        },
      }),
      appFeatures: signal({
        isFocusModeEnabled: true,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        ShortcutService,
        { provide: TaskShortcutService, useValue: mockTaskShortcutService },
        { provide: Router, useValue: mockRouter },
        { provide: GlobalConfigService, useValue: mockConfigService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        { provide: WorkContextService, useValue: { activeWorkContext$: signal({}) } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: UiHelperService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: Store, useValue: { dispatch: jasmine.createSpy('dispatch') } },
        { provide: PluginBridgeService, useValue: mockPluginBridgeService },
        {
          provide: OverlayContainer,
          useValue: {
            getContainerElement: () => ({
              querySelector: () => null,
              children: [],
            }),
          },
        },
      ],
    });

    service = TestBed.inject(ShortcutService);
  });

  describe('handleKeyDown', () => {
    it('should NOT navigate to schedule if TaskShortcutService handled Shift+S', () => {
      mockTaskShortcutService.handleTaskShortcuts.and.returnValue(true);
      const ev = new KeyboardEvent('keydown', {
        code: 'KeyS',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      service.handleKeyDown(ev);

      expect(mockTaskShortcutService.handleTaskShortcuts).toHaveBeenCalledWith(ev);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should navigate to schedule if TaskShortcutService did NOT handle Shift+S', () => {
      mockTaskShortcutService.handleTaskShortcuts.and.returnValue(false);
      const ev = new KeyboardEvent('keydown', {
        code: 'KeyS',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      service.handleKeyDown(ev);

      expect(mockTaskShortcutService.handleTaskShortcuts).toHaveBeenCalledWith(ev);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/schedule']);
    });

    // Ctrl+Shift+U is the combo PLUGIN_SHORTCUT_CFG_KEY is bound to above.
    const pressPluginCombo = async (repeat = false): Promise<void> => {
      mockPluginBridgeService.shortcuts.set([
        { pluginId: 'automations', id: 'r1', label: 'Tag as urgent', onExec: () => {} },
      ]);
      const ev = new KeyboardEvent('keydown', {
        code: 'KeyU',
        ctrlKey: true,
        shiftKey: true,
        repeat,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);
    };

    it('should execute a plugin shortcut bound to its key combo', async () => {
      await pressPluginCombo();

      expect(mockPluginBridgeService.executeShortcut).toHaveBeenCalledWith(
        'automations:r1',
      );
    });

    it('should NOT execute a plugin shortcut on key auto-repeat', async () => {
      await pressPluginCombo(true);

      expect(mockPluginBridgeService.executeShortcut).not.toHaveBeenCalled();
    });

    it('should open the shortcut cheat sheet on "?"', async () => {
      const ev = new KeyboardEvent('keydown', {
        key: '?',
        code: 'Slash',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);

      expect(mockMatDialog.open).toHaveBeenCalled();
    });

    it('should NOT open the shortcut cheat sheet when a modifier is held', async () => {
      const ev = new KeyboardEvent('keydown', {
        key: '?',
        code: 'Slash',
        shiftKey: true,
        metaKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);

      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });

    it('should open the shortcut cheat sheet for "?" produced via AltGr', async () => {
      const ev = new KeyboardEvent('keydown', {
        key: '?',
        code: 'Digit3',
        ctrlKey: true,
        altKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);

      expect(mockMatDialog.open).toHaveBeenCalled();
    });

    it('should NOT open the shortcut cheat sheet when showHelp is unbound', async () => {
      mockConfigService.cfg.set({
        keyboard: { goToScheduledView: 'Shift+S', showHelp: null },
      });
      const ev = new KeyboardEvent('keydown', {
        key: '?',
        code: 'Slash',
        shiftKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);

      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });

    it('should open the shortcut cheat sheet for a custom showHelp combo', async () => {
      mockConfigService.cfg.set({
        keyboard: { goToScheduledView: 'Shift+S', showHelp: 'Ctrl+K' },
      });
      const ev = new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
      });
      Object.defineProperty(ev, 'target', { value: document.body });

      await service.handleKeyDown(ev);

      expect(mockMatDialog.open).toHaveBeenCalled();
    });

    it('should only open one cheat sheet for rapid repeated presses', async () => {
      mockMatDialog.open.and.callFake(() => {
        mockMatDialog.openDialogs.push({});
        return { afterClosed: () => of(undefined) };
      });
      const createEv = (): KeyboardEvent => {
        const ev = new KeyboardEvent('keydown', {
          key: '?',
          code: 'Slash',
          shiftKey: true,
        });
        Object.defineProperty(ev, 'target', { value: document.body });
        return ev;
      };

      await Promise.all([
        service.handleKeyDown(createEv()),
        service.handleKeyDown(createEv()),
        service.handleKeyDown(createEv()),
      ]);

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('desktop add-task command while adding a note', () => {
    const showAddTaskBarFromDesktopCommand = (): Promise<void> =>
      (
        service as unknown as {
          _showAddTaskBarFromDesktopCommand: () => Promise<void>;
        }
      )._showAddTaskBarFromDesktopCommand();

    const setOpenNote = (
      content: string,
    ): {
      close: jasmine.Spy;
    } => {
      const noteComponent = Object.create(
        DialogAddNoteComponent.prototype,
      ) as DialogAddNoteComponent;
      noteComponent.data = { content };
      const close = spyOn(noteComponent, 'close');
      mockMatDialog.openDialogs = [
        {
          componentInstance: noteComponent,
          afterClosed: () => of(undefined),
        },
      ];
      return { close };
    };

    it('should discard an empty note before showing the add-task bar', async () => {
      const note = setOpenNote('  ');

      await showAddTaskBarFromDesktopCommand();

      expect(note.close).toHaveBeenCalledWith(true);
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalled();
    });

    it('should save a non-empty note before showing the add-task bar', async () => {
      const note = setOpenNote('Note content');
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(true),
      });

      await showAddTaskBarFromDesktopCommand();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogConfirmComponent, {
        data: {
          message: 'F.NOTE.D_FULLSCREEN.CONFIRM_SAVE_BEFORE_OPENING_NEW_TASK',
          okTxt: 'G.SAVE',
          cancelTxt: 'G.DISCARD',
        },
      });
      expect(note.close).toHaveBeenCalledWith(false);
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalled();
    });

    it('should discard a non-empty note when discard is selected', async () => {
      const note = setOpenNote('Note content');
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(false),
      });

      await showAddTaskBarFromDesktopCommand();

      expect(note.close).toHaveBeenCalledWith(true);
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalled();
    });

    it('should keep the note open when confirmation is cancelled', async () => {
      const note = setOpenNote('Note content');
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(undefined),
      });

      await showAddTaskBarFromDesktopCommand();

      expect(note.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();
    });
  });
});
