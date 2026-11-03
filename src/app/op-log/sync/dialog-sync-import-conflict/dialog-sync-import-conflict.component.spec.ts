import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { SyncProviderManager } from '../../sync-providers/provider-manager.service';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { SyncFirstChoiceComponent } from '../../../imex/sync/sync-first-choice/sync-first-choice.component';
import {
  DialogSyncImportConflictComponent,
  SyncImportConflictData,
} from './dialog-sync-import-conflict.component';

describe('DialogSyncImportConflictComponent', () => {
  let closeSpy: jasmine.Spy;
  // window.confirm is installed as a global spy in src/test.ts — reuse it.
  let confirmSpy: jasmine.Spy;
  let activeProviderId: SyncProviderId;
  const providerManagerMock = {
    provide: SyncProviderManager,
    useValue: { getActiveProvider: () => ({ id: activeProviderId }) },
  };

  const setup = (
    data: Partial<SyncImportConflictData>,
  ): ComponentFixture<DialogSyncImportConflictComponent> => {
    closeSpy = jasmine.createSpy('close');
    const dialogRefMock = {
      close: closeSpy,
      disableClose: false,
    } as unknown as MatDialogRef<DialogSyncImportConflictComponent>;

    TestBed.configureTestingModule({
      imports: [DialogSyncImportConflictComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            filteredOpCount: 4,
            localImportTimestamp: 0,
            scenario: 'INCOMING_IMPORT',
            ...data,
          } as SyncImportConflictData,
        },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US', formatTime: () => '00:00' },
        },
        providerManagerMock,
      ],
    });
    // Avoid rendering the template (translate pipes etc.) — we only test close() logic.
    TestBed.overrideComponent(DialogSyncImportConflictComponent, {
      set: { template: '' },
    });
    return TestBed.createComponent(DialogSyncImportConflictComponent);
  };

  // Renders the real template.
  const renderFixture = (
    data: Partial<SyncImportConflictData>,
  ): ComponentFixture<DialogSyncImportConflictComponent> => {
    TestBed.configureTestingModule({
      imports: [DialogSyncImportConflictComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: { close: () => {}, disableClose: false } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            filteredOpCount: 1,
            localImportTimestamp: 0,
            scenario: 'INCOMING_IMPORT',
            ...data,
          } as SyncImportConflictData,
        },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US', formatTime: () => '00:00' },
        },
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotAsync: () => Promise.resolve({ task: { ids: ['a'] } }),
          },
        },
        providerManagerMock,
      ],
    });
    const fixture = TestBed.createComponent(DialogSyncImportConflictComponent);
    fixture.detectChanges();
    return fixture;
  };
  const render = (data: Partial<SyncImportConflictData>): HTMLElement =>
    renderFixture(data).nativeElement as HTMLElement;

  beforeEach(() => {
    activeProviderId = SyncProviderId.WebDAV;
    confirmSpy = window.confirm as jasmine.Spy;
    confirmSpy.calls.reset();
    confirmSpy.and.returnValue(true);
  });

  describe('first-sync USE_LOCAL guard', () => {
    it('requires confirmation before USE_LOCAL when isNeverSynced is true', () => {
      confirmSpy.and.returnValue(true);
      const cmp = setup({ isNeverSynced: true }).componentInstance;

      cmp.close('USE_LOCAL');

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_LOCAL');
    });

    it('does NOT close when the user cancels the confirmation', () => {
      confirmSpy.and.returnValue(false);
      const cmp = setup({ isNeverSynced: true }).componentInstance;

      cmp.close('USE_LOCAL');

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('does NOT confirm USE_LOCAL for an established (already-synced) client', () => {
      const cmp = setup({ isNeverSynced: false }).componentInstance;

      cmp.close('USE_LOCAL');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_LOCAL');
    });
  });

  describe('USE_REMOTE guard (#8107)', () => {
    it('requires confirmation before USE_REMOTE discards local changes', () => {
      confirmSpy.and.returnValue(true);
      const cmp = setup({
        scenario: 'INCOMING_IMPORT',
        filteredOpCount: 4,
      }).componentInstance;

      cmp.close('USE_REMOTE');

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_REMOTE');
    });

    it('does NOT close when the user cancels the USE_REMOTE confirmation', () => {
      confirmSpy.and.returnValue(false);
      const cmp = setup({
        scenario: 'INCOMING_IMPORT',
        filteredOpCount: 4,
      }).componentInstance;

      cmp.close('USE_REMOTE');

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('does NOT confirm USE_REMOTE when there are no local changes to lose', () => {
      const cmp = setup({
        scenario: 'INCOMING_IMPORT',
        filteredOpCount: 0,
      }).componentInstance;

      cmp.close('USE_REMOTE');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_REMOTE');
    });

    it('does NOT confirm USE_REMOTE outside the incoming-import scenario', () => {
      const cmp = setup({
        scenario: 'LOCAL_IMPORT_FILTERS_REMOTE',
        filteredOpCount: 4,
      }).componentInstance;

      cmp.close('USE_REMOTE');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_REMOTE');
    });
  });

  describe('initial focus (cdkFocusInitial) follows the safe/primary button per scenario', () => {
    // Renders the real template so we assert which button the Material focus trap
    // will actually focus (it queries `[cdkFocusInitial]`). Regression guard: a
    // fixed focus on USE_REMOTE would, in the LOCAL_IMPORT_FILTERS_REMOTE scenario,
    // make the keyboard default discard the user's just-made local import.
    const renderWithScenario = (
      scenario: SyncImportConflictData['scenario'],
    ): HTMLElement => render({ scenario });

    it('focuses USE_REMOTE for an INCOMING_IMPORT (USE_LOCAL would overwrite the server)', () => {
      const el = renderWithScenario('INCOMING_IMPORT');

      const focused = el.querySelectorAll('[cdkFocusInitial]');
      expect(focused.length).toBe(1);
      // USE_REMOTE carries the cloud_download icon.
      expect(focused[0].textContent).toContain('cloud_download');
    });

    it('focuses USE_LOCAL for LOCAL_IMPORT_FILTERS_REMOTE (USE_REMOTE would discard the local import)', () => {
      const el = renderWithScenario('LOCAL_IMPORT_FILTERS_REMOTE');

      const focused = el.querySelectorAll('[cdkFocusInitial]');
      expect(focused.length).toBe(1);
      // USE_LOCAL carries the cloud_upload icon.
      expect(focused[0].textContent).toContain('cloud_upload');
    });
  });

  describe('first sync on SuperSync (2b)', () => {
    it('shows the first-sync choice for a never-synced SuperSync device', () => {
      activeProviderId = SyncProviderId.SuperSync;
      const el = render({ isNeverSynced: true });

      expect(el.querySelector('sync-first-choice')).not.toBeNull();
      expect(el.textContent).not.toContain('cloud_download');
    });

    it("passes the account's task count to the choice", () => {
      activeProviderId = SyncProviderId.SuperSync;
      const choice = renderFixture({
        isNeverSynced: true,
        accountTaskCount: 3000,
      }).debugElement.query(By.directive(SyncFirstChoiceComponent))
        .componentInstance as SyncFirstChoiceComponent;

      expect(choice.accountTaskCount()).toBe(3000);
    });

    it('keeps the full dialog for a device that synced before', () => {
      activeProviderId = SyncProviderId.SuperSync;
      const el = render({ isNeverSynced: false });

      expect(el.querySelector('sync-first-choice')).toBeNull();
      expect(el.textContent).toContain('cloud_download');
    });

    it('keeps the full dialog for a local import and for other providers', () => {
      activeProviderId = SyncProviderId.SuperSync;
      expect(
        setup({ isNeverSynced: true, scenario: 'LOCAL_IMPORT_FILTERS_REMOTE' })
          .componentInstance.isFirstSuperSync,
      ).toBeFalse();
      TestBed.resetTestingModule();
      activeProviderId = SyncProviderId.WebDAV;
      expect(
        setup({ isNeverSynced: true }).componentInstance.isFirstSuperSync,
      ).toBeFalse();
    });

    it('closes with the choice and skips the confirms, which it already warned for', () => {
      const cmp = setup({ isNeverSynced: true }).componentInstance;

      cmp.closeFirstSync('USE_LOCAL');
      cmp.closeFirstSync(undefined);

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy.calls.allArgs()).toEqual([['USE_LOCAL'], ['CANCEL']]);
    });
  });
});
