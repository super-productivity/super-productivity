import { TestBed } from '@angular/core/testing';
import { ShortcutService } from './shortcut.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { Router } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
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
import { DialogFullscreenMarkdownComponent } from '../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';
import { OverlayContainer } from '@angular/cdk/overlay';
import { signal } from '@angular/core';
import { Observable, of, Subject } from 'rxjs';

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
      afterClosed$: Observable<unknown> = of(undefined),
    ): {
      close: jasmine.Spy;
      closeAfterConfirmedDiscard: jasmine.Spy;
    } => {
      const noteComponent = Object.create(
        DialogAddNoteComponent.prototype,
      ) as DialogAddNoteComponent;
      noteComponent.data = { content };
      const close = spyOn(noteComponent, 'close');
      const closeAfterConfirmedDiscard = spyOn(
        noteComponent,
        'closeAfterConfirmedDiscard',
      );
      mockMatDialog.openDialogs = [
        {
          componentInstance: noteComponent,
          afterClosed: () => afterClosed$,
          getState: () => MatDialogState.OPEN,
        },
      ];
      return { close, closeAfterConfirmedDiscard };
    };

    it('should discard an empty note before showing the add-task bar', async () => {
      const note = setOpenNote('  ');

      await showAddTaskBarFromDesktopCommand();

      expect(note.closeAfterConfirmedDiscard).toHaveBeenCalled();
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
      expect(note.close).toHaveBeenCalledWith();
      expect(note.closeAfterConfirmedDiscard).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalled();
    });

    it('should ignore repeated commands until the note has closed and allow later commands', async () => {
      const confirmationClosed$ = new Subject<boolean | undefined>();
      const noteClosed$ = new Subject<void>();
      const note = setOpenNote('Note content', noteClosed$);
      mockMatDialog.open.and.returnValue({
        afterClosed: () => confirmationClosed$,
      });

      const handoff = showAddTaskBarFromDesktopCommand();
      const repeatedHandoff = showAddTaskBarFromDesktopCommand();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(note.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();

      confirmationClosed$.next(true);
      await Promise.resolve();
      mockMatDialog.openDialogs = [];
      await showAddTaskBarFromDesktopCommand();

      expect(note.close).toHaveBeenCalledTimes(1);
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();

      noteClosed$.next();
      await Promise.all([handoff, repeatedHandoff]);

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(note.close).toHaveBeenCalledTimes(1);
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);

      await showAddTaskBarFromDesktopCommand();

      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(2);
    });

    it('should allow another handoff after cancellation', async () => {
      const confirmationClosed$ = new Subject<boolean | undefined>();
      const note = setOpenNote('Note content');
      mockMatDialog.open.and.returnValue({
        afterClosed: () => confirmationClosed$,
      });

      const cancelledHandoff = showAddTaskBarFromDesktopCommand();
      const repeatedHandoff = showAddTaskBarFromDesktopCommand();
      confirmationClosed$.next(undefined);
      await Promise.all([cancelledHandoff, repeatedHandoff]);

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(note.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();

      const nextHandoff = showAddTaskBarFromDesktopCommand();
      confirmationClosed$.next(true);
      await nextHandoff;

      expect(mockMatDialog.open).toHaveBeenCalledTimes(2);
      expect(note.close).toHaveBeenCalledTimes(1);
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('should discard a non-empty note when discard is selected', async () => {
      const note = setOpenNote('Note content');
      mockMatDialog.open.and.returnValue({
        afterClosed: () => of(false),
      });

      await showAddTaskBarFromDesktopCommand();

      expect(note.closeAfterConfirmedDiscard).toHaveBeenCalled();
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

  describe('desktop add-task command while editing fullscreen markdown', () => {
    let editor: DialogFullscreenMarkdownComponent;
    let editorRef: jasmine.SpyObj<MatDialogRef<DialogFullscreenMarkdownComponent>>;

    const showAddTaskBar = (): Promise<void> =>
      service['_showAddTaskBarFromDesktopCommand']();

    beforeEach(() => {
      editor = Object.create(
        DialogFullscreenMarkdownComponent.prototype,
      ) as DialogFullscreenMarkdownComponent;
      editor.data = { content: 'Saved note' };
      Object.defineProperty(editor, '_initialContent', { value: 'Saved note' });
      editor.isDiscardConfirmOpen = false;
      editorRef = jasmine.createSpyObj('MatDialogRef', [
        'close',
        'afterClosed',
        'getState',
      ]);
      editorRef.componentInstance = editor;
      editorRef.getState.and.returnValue(MatDialogState.OPEN);
      editorRef.afterClosed.and.returnValue(of(undefined));
      editor._matDialogRef = editorRef;
      mockMatDialog.openDialogs = [editorRef];
      mockMatDialog.open.and.returnValue({ afterClosed: () => of(true) });
    });

    it('closes an unchanged existing note before opening the add-task bar without prompting', async () => {
      await showAddTaskBar();

      expect(editorRef.close).toHaveBeenCalledWith('Saved note');
      expect(mockMatDialog.open).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('saves edited task notes through the normal dialog result', async () => {
      editor.data = { content: 'Edited task notes', taskId: 'task-id' };

      await showAddTaskBar();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogConfirmComponent, {
        data: {
          message: 'F.NOTE.D_FULLSCREEN.CONFIRM_SAVE_BEFORE_OPENING_NEW_TASK',
          okTxt: 'G.SAVE',
          cancelTxt: 'G.DISCARD',
        },
      });
      expect(editorRef.close).toHaveBeenCalledOnceWith('Edited task notes');
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
      expect(editor.isDiscardConfirmOpen).toBe(false);
    });

    it('saves a cleared note through the normal delete result', async () => {
      editor.data.content = '';

      await showAddTaskBar();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(editorRef.close).toHaveBeenCalledOnceWith({ action: 'DELETE' });
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('prompts for whitespace-only changes instead of silently discarding them', async () => {
      editor.data.content = '  ';

      await showAddTaskBar();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(editorRef.close).toHaveBeenCalledOnceWith('  ');
    });

    it('discards edited notes with an explicit result and no second prompt', async () => {
      editor.data.content = 'Edited note';
      mockMatDialog.open.and.returnValue({ afterClosed: () => of(false) });

      await showAddTaskBar();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(editorRef.close).toHaveBeenCalledOnceWith({ action: 'DISCARD' });
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('keeps the editor open on cancellation and permits retrying', async () => {
      editor.data.content = 'Edited note';
      mockMatDialog.open.and.returnValue({ afterClosed: () => of(undefined) });

      await showAddTaskBar();

      expect(editorRef.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();
      expect(editor.isDiscardConfirmOpen).toBe(false);

      mockMatDialog.open.and.returnValue({ afterClosed: () => of(true) });
      await showAddTaskBar();

      expect(editorRef.close).toHaveBeenCalledOnceWith('Edited note');
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('coalesces repeated commands through confirmation and the editor exit animation', async () => {
      editor.data.content = 'Edited note';
      const confirmationClosed$ = new Subject<boolean>();
      const editorClosed$ = new Subject<void>();
      mockMatDialog.open.and.returnValue({
        afterClosed: () => confirmationClosed$,
      });
      editorRef.afterClosed.and.returnValue(editorClosed$);

      const handoff = showAddTaskBar();
      await showAddTaskBar();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(editor.isDiscardConfirmOpen).toBe(true);
      expect(editorRef.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();

      confirmationClosed$.next(true);
      await Promise.resolve();
      mockMatDialog.openDialogs = [];
      await showAddTaskBar();

      expect(editorRef.close).toHaveBeenCalledTimes(1);
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();

      editorClosed$.next();
      await handoff;

      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
      await showAddTaskBar();
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(2);
    });

    it('subscribes to closure before requesting it, even for synchronous closure', async () => {
      const editorClosed$ = new Subject<void>();
      editorRef.afterClosed.and.returnValue(editorClosed$);
      editorRef.close.and.callFake(() => {
        editorClosed$.next();
        editorClosed$.complete();
      });

      await showAddTaskBar();

      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });

    it('does not interrupt an existing discard confirmation', async () => {
      editor.isDiscardConfirmOpen = true;

      await showAddTaskBar();

      expect(mockMatDialog.open).not.toHaveBeenCalled();
      expect(editorRef.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();
      expect(editor.isDiscardConfirmOpen).toBe(true);
    });

    it('does not close an editor already in its exit animation', async () => {
      editorRef.getState.and.returnValue(MatDialogState.CLOSING);

      await showAddTaskBar();

      expect(editorRef.close).not.toHaveBeenCalled();
      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });

    it('does not save again if the editor was closed while awaiting confirmation', async () => {
      editor.data.content = 'Edited note';
      const confirmationClosed$ = new Subject<boolean>();
      mockMatDialog.open.and.returnValue({
        afterClosed: () => confirmationClosed$,
      });
      const handoff = showAddTaskBar();

      editorRef.getState.and.returnValue(MatDialogState.CLOSED);
      confirmationClosed$.next(true);
      await handoff;

      expect(editorRef.close).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).not.toHaveBeenCalled();
      expect(editor.isDiscardConfirmOpen).toBe(false);
    });

    it('opens the add-task bar normally when no fullscreen editor is open', async () => {
      mockMatDialog.openDialogs = [];

      await showAddTaskBar();

      expect(mockMatDialog.open).not.toHaveBeenCalled();
      expect(mockLayoutService.showAddTaskBar).toHaveBeenCalledTimes(1);
    });
  });
});
