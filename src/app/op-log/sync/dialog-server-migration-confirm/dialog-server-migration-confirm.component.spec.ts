import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';
import {
  TranslateModule,
  TranslateLoader,
  TranslateService,
  TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { DialogServerMigrationConfirmComponent } from './dialog-server-migration-confirm.component';
import enTranslations from '../../../../assets/i18n/en.json';

/**
 * Regression guard for the destructive-replace dialog wording.
 *
 * The original copy advertised this destructive SYNC_IMPORT action as a
 * "merge" with a primary-colored "Upload Local Data" button — which led at
 * least one user (johannes, 2026-04-27) to clobber a syncing device's data
 * thinking they were merging it with another device's. The dialog must:
 *   - Never use "merge" in its body.
 *   - Mention "overwrite" or "replace" so the destructive intent is plain.
 *   - Mention "other device" so the cross-device blast radius is visible.
 *   - Render the affirmative button with color="warn" (not "primary").
 *   - Label the affirmative button "Replace…" (not "Upload Local Data").
 */

class JsonTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<TranslationObject> {
    return of(enTranslations as TranslationObject);
  }
}

describe('DialogServerMigrationConfirmComponent', () => {
  let fixture: ComponentFixture<DialogServerMigrationConfirmComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogServerMigrationConfirmComponent>>;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close'], {
      disableClose: false,
    });

    await TestBed.configureTestingModule({
      imports: [
        DialogServerMigrationConfirmComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: JsonTranslateLoader },
        }),
      ],
      providers: [{ provide: MatDialogRef, useValue: mockDialogRef }],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.use('en');

    fixture = TestBed.createComponent(DialogServerMigrationConfirmComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  describe('body copy', () => {
    let bodyText: string;

    beforeEach(() => {
      bodyText =
        fixture.nativeElement
          .querySelector('mat-dialog-content')
          ?.textContent?.toLowerCase() ?? '';
    });

    it('does not call the action a "merge" (the original misleading phrasing)', () => {
      // Original copy: "Would you like to upload your local data to merge with it?"
      // The fixed copy is allowed to *deny* a merge (e.g. "This is not a merge"),
      // so just check that no positive merge-marketing phrase remains.
      expect(bodyText).not.toMatch(/merge with|to merge|will merge/);
    });

    it('uses destructive language ("overwrite" or "replace")', () => {
      expect(bodyText).toMatch(/overwrite|replace/);
    });

    it('warns about cross-device impact ("other device")', () => {
      expect(bodyText).toMatch(/other device/);
    });
  });

  describe('action buttons', () => {
    let buttons: HTMLButtonElement[];

    beforeEach(() => {
      buttons = Array.from(
        fixture.nativeElement.querySelectorAll('mat-dialog-actions button'),
      );
    });

    it('renders exactly two action buttons', () => {
      expect(buttons.length).toBe(2);
    });

    it('affirmative button is labelled "Replace…", not "Upload Local Data"', () => {
      const affirmative = buttons[1];
      const label = affirmative.textContent?.toLowerCase() ?? '';
      expect(label).toContain('replace');
      expect(label).not.toContain('upload local data');
    });

    it('affirmative button uses warn color (not primary)', () => {
      const affirmative = buttons[1];
      expect(affirmative.getAttribute('color')).toBe('warn');
    });

    it('cancel button has no color (per cancel-button-color rule)', () => {
      const cancel = buttons[0];
      expect(cancel.getAttribute('color')).toBeNull();
    });
  });

  describe('close behavior', () => {
    it('cancel button closes with false', () => {
      const cancel = fixture.nativeElement.querySelectorAll(
        'mat-dialog-actions button',
      )[0] as HTMLButtonElement;
      cancel.click();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });

    it('affirmative button closes with true', () => {
      const affirmative = fixture.nativeElement.querySelectorAll(
        'mat-dialog-actions button',
      )[1] as HTMLButtonElement;
      affirmative.click();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });
  });
});
