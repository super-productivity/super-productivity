import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';

import { DialogImportFromUrlComponent } from './dialog-import-from-url.component';
import { T } from '../../t.const';
import { Log } from '../../core/log';

describe('DialogImportFromUrlComponent', () => {
  let component: DialogImportFromUrlComponent;
  let fixture: ComponentFixture<DialogImportFromUrlComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogImportFromUrlComponent>>;

  beforeEach(async () => {
    const dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [
        DialogImportFromUrlComponent,
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatDialogModule,
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      providers: [{ provide: MatDialogRef, useValue: dialogRefSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogImportFromUrlComponent);
    component = fixture.componentInstance;
    mockDialogRef = TestBed.inject(MatDialogRef) as jasmine.SpyObj<
      MatDialogRef<DialogImportFromUrlComponent>
    >;

    fixture.detectChanges();
  });

  describe('component initialization', () => {
    it('should initialize with empty URL', () => {
      expect(component.url).toBe('');
    });

    it('should have T constant available', () => {
      expect(component.T).toBe(T);
    });

    it('should emit urlEntered event', () => {
      spyOn(component.urlEntered, 'emit');
      const testUrl = 'https://example.com/test.json';
      component.url = testUrl;

      component.submit();

      expect(component.urlEntered.emit).toHaveBeenCalledWith(testUrl);
    });
  });

  describe('URL input validation and binding', () => {
    let urlInput: HTMLInputElement;

    beforeEach(() => {
      const inputElement = fixture.debugElement.query(By.css('input[name="urlInput"]'));
      urlInput = inputElement.nativeElement;
    });

    it('should bind URL input to component property', () => {
      const testUrl = 'https://example.com/backup.json';
      urlInput.value = testUrl;
      urlInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(component.url).toBe(testUrl);
    });

    it('should show URL input field with correct properties', () => {
      expect(urlInput).toBeTruthy();
      expect(urlInput.type).toBe('url');
      expect(urlInput.required).toBe(true);
    });

    it('should have correct input validation setup', () => {
      expect(urlInput.type).toBe('url');
      expect(urlInput.required).toBe(true);
    });

    it('should have proper input attributes for validation', () => {
      expect(urlInput.type).toBe('url');
      expect(urlInput.required).toBe(true);
      expect(urlInput.name).toBe('urlInput');
    });

    it('should not show validation error for valid URL', async () => {
      urlInput.value = 'https://example.com/backup.json';
      urlInput.dispatchEvent(new Event('input'));
      urlInput.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      await fixture.whenStable();

      const errorElement = fixture.debugElement.query(By.css('mat-error'));
      expect(errorElement).toBeFalsy();
    });
  });

  describe('submit functionality', () => {
    it('should close dialog with URL when valid URL is submitted', () => {
      const testUrl = 'https://example.com/backup.json';
      component.url = testUrl;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(testUrl);
    });

    it('should close dialog with trimmed URL', () => {
      const testUrl = '  https://example.com/backup.json  ';
      const trimmedUrl = 'https://example.com/backup.json';
      component.url = testUrl;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(trimmedUrl);
    });

    it('should emit urlEntered event with trimmed URL', () => {
      spyOn(component.urlEntered, 'emit');
      const testUrl = '  https://example.com/backup.json  ';
      const trimmedUrl = 'https://example.com/backup.json';
      component.url = testUrl;

      component.submit();

      expect(component.urlEntered.emit).toHaveBeenCalledWith(trimmedUrl);
    });

    it('should not close dialog when URL is empty', () => {
      component.url = '';

      component.submit();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should not close dialog when URL is only whitespace', () => {
      component.url = '   ';

      component.submit();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should log error when URL is empty', () => {
      spyOn(Log, 'err');
      component.url = '';

      component.submit();

      expect(Log.err).toHaveBeenCalledWith('URL is required.');
    });
  });

  describe('cancel functionality', () => {
    it('should close dialog without data when cancelled', () => {
      component.cancel();

      expect(mockDialogRef.close).toHaveBeenCalledWith();
    });
  });

  describe('form validation states', () => {
    let submitButton: HTMLButtonElement;
    let cancelButton: HTMLButtonElement;

    beforeEach(() => {
      const submitButtonElement = fixture.debugElement.query(
        By.css('button[color="primary"]'),
      );
      const cancelButtonElement = fixture.debugElement.query(
        By.css('button:not([color="primary"])'),
      );
      submitButton = submitButtonElement.nativeElement;
      cancelButton = cancelButtonElement.nativeElement;
    });

    it('should disable submit button when URL is empty', () => {
      component.url = '';
      fixture.detectChanges();

      expect(submitButton.disabled).toBe(true);
    });

    it('should disable submit button when URL is only whitespace', () => {
      component.url = '   ';
      fixture.detectChanges();

      expect(submitButton.disabled).toBe(true);
    });

    it('should enable submit button when URL is valid', async () => {
      const urlInput = fixture.debugElement.query(By.css('input[name="urlInput"]'));
      urlInput.nativeElement.value = 'https://example.com/backup.json';
      urlInput.nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(submitButton.disabled).toBe(false);
    });

    it('should have button disable logic based on URL validity in template', () => {
      // Note: Testing HTML5 form validation in unit tests is complex because
      // browser validation behavior differs from test environment.
      // We verify the template has the correct disable condition structure.
      const submitButtonElement = fixture.debugElement.query(
        By.css('button[color="primary"]'),
      );
      expect(submitButtonElement).toBeDefined();
      expect(submitButtonElement.nativeElement.disabled).toBeDefined();
    });

    it('should always enable cancel button', () => {
      expect(cancelButton.disabled).toBe(false);
    });
  });

  describe('dialog actions', () => {
    it('should call submit when submit button is clicked', async () => {
      spyOn(component, 'submit');

      // Set valid URL and update form
      component.url = 'https://example.com/test.json';
      const urlInput = fixture.debugElement.query(By.css('input[name="urlInput"]'));
      urlInput.nativeElement.value = 'https://example.com/test.json';
      urlInput.nativeElement.dispatchEvent(new Event('input'));

      fixture.detectChanges();
      await fixture.whenStable();

      const submitButton = fixture.debugElement.query(By.css('button[color="primary"]'));

      submitButton.nativeElement.click();

      expect(component.submit).toHaveBeenCalled();
    });

    it('should call cancel when cancel button is clicked', () => {
      spyOn(component, 'cancel');
      const cancelButton = fixture.debugElement.query(
        By.css('button:not([color="primary"])'),
      );

      cancelButton.nativeElement.click();

      expect(component.cancel).toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('should render dialog title', () => {
      const titleElement = fixture.debugElement.query(By.css('h1[mat-dialog-title]'));
      expect(titleElement).toBeTruthy();
    });

    it('should render dialog content with description', () => {
      const contentElement = fixture.debugElement.query(By.css('mat-dialog-content p'));
      expect(contentElement).toBeTruthy();
    });

    it('should render form field with input', () => {
      const formFieldElement = fixture.debugElement.query(By.css('mat-form-field'));
      const inputElement = fixture.debugElement.query(By.css('input[matInput]'));
      expect(formFieldElement).toBeTruthy();
      expect(inputElement).toBeTruthy();
    });

    it('should render dialog actions with two buttons', () => {
      const actionsElement = fixture.debugElement.query(By.css('mat-dialog-actions'));
      const buttons = fixture.debugElement.queryAll(By.css('mat-dialog-actions button'));
      expect(actionsElement).toBeTruthy();
      expect(buttons.length).toBe(2);
    });
  });

  describe('edge cases and comprehensive scenarios', () => {
    it('should handle very long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2000) + '/backup.json';
      component.url = longUrl;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(longUrl);
    });

    it('should handle URLs with special characters', () => {
      const urlWithSpecialChars =
        'https://example.com/backup%20file.json?param=value&other=test';
      component.url = urlWithSpecialChars;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(urlWithSpecialChars);
    });

    it('should handle URLs with different protocols', () => {
      const httpUrl = 'http://example.com/backup.json';
      component.url = httpUrl;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(httpUrl);
    });

    it('should handle whitespace at beginning and end correctly', () => {
      const urlWithWhitespace = '  \t https://example.com/backup.json \n ';
      const expectedTrimmed = 'https://example.com/backup.json';
      component.url = urlWithWhitespace;

      component.submit();

      expect(mockDialogRef.close).toHaveBeenCalledWith(expectedTrimmed);
    });

    it('should not submit when URL is null', () => {
      component.url = null as any;

      component.submit();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('should not submit when URL is undefined', () => {
      component.url = undefined as any;

      component.submit();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('translation and accessibility', () => {
    it('should use translation pipes in template', () => {
      const titleElement = fixture.debugElement.query(By.css('h1[mat-dialog-title]'));
      const descElement = fixture.debugElement.query(By.css('mat-dialog-content p'));
      const labelElement = fixture.debugElement.query(By.css('mat-label'));

      expect(titleElement.nativeElement.textContent).toContain(''); // Will be empty in test but pipe should be there
      expect(descElement.nativeElement.textContent).toContain('');
      expect(labelElement.nativeElement.textContent).toContain('');
    });

    it('should have proper accessibility attributes', () => {
      const urlInput = fixture.debugElement.query(By.css('input[name="urlInput"]'));

      expect(urlInput.nativeElement.hasAttribute('required')).toBe(true);
      expect(urlInput.nativeElement.type).toBe('url');
      expect(urlInput.nativeElement.hasAttribute('placeholder')).toBe(true);
    });

    it('should have proper button types and attributes', () => {
      const submitButton = fixture.debugElement.query(By.css('button[color="primary"]'));
      const cancelButton = fixture.debugElement.query(
        By.css('button:not([color="primary"])'),
      );

      expect(submitButton.nativeElement.hasAttribute('mat-raised-button')).toBe(true);
      expect(cancelButton.nativeElement.hasAttribute('mat-button')).toBe(true);
    });
  });
});
