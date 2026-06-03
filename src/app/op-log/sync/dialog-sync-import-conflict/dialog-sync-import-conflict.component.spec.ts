import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import {
  DialogSyncImportConflictComponent,
  SyncImportConflictData,
} from './dialog-sync-import-conflict.component';

describe('DialogSyncImportConflictComponent', () => {
  let closeSpy: jasmine.Spy;
  // window.confirm is installed as a global spy in src/test.ts — reuse it.
  let confirmSpy: jasmine.Spy;

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
      ],
    });
    // Avoid rendering the template (translate pipes etc.) — we only test close() logic.
    TestBed.overrideComponent(DialogSyncImportConflictComponent, {
      set: { template: '' },
    });
    return TestBed.createComponent(DialogSyncImportConflictComponent);
  };

  beforeEach(() => {
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

    it('does NOT confirm for USE_REMOTE even when isNeverSynced is true', () => {
      const cmp = setup({ isNeverSynced: true }).componentInstance;

      cmp.close('USE_REMOTE');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_REMOTE');
    });

    it('does NOT confirm USE_LOCAL for an established (already-synced) client', () => {
      const cmp = setup({ isNeverSynced: false }).componentInstance;

      cmp.close('USE_LOCAL');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledOnceWith('USE_LOCAL');
    });
  });

  describe('initial focus (cdkFocusInitial) follows the safe/primary button per scenario', () => {
    // Renders the real template so we assert which button the Material focus trap
    // will actually focus (it queries `[cdkFocusInitial]`). Regression guard: a
    // fixed focus on USE_REMOTE would, in the LOCAL_IMPORT_FILTERS_REMOTE scenario,
    // make the keyboard default discard the user's just-made local import.
    const renderWithScenario = (
      scenario: SyncImportConflictData['scenario'],
    ): HTMLElement => {
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
              scenario,
            } as SyncImportConflictData,
          },
          {
            provide: DateTimeFormatService,
            useValue: { currentLocale: () => 'en-US', formatTime: () => '00:00' },
          },
        ],
      });
      const fixture = TestBed.createComponent(DialogSyncImportConflictComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

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
});
