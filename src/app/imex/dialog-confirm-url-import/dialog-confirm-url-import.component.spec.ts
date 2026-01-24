import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';

import {
  ConfirmUrlImportDialogComponent,
  DialogConfirmUrlImportData,
} from './dialog-confirm-url-import.component';
import { T } from '../../t.const';

describe('ConfirmUrlImportDialogComponent', () => {
  let component: ConfirmUrlImportDialogComponent;
  let fixture: ComponentFixture<ConfirmUrlImportDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<ConfirmUrlImportDialogComponent>>;
  let mockDialogData: DialogConfirmUrlImportData;

  beforeEach(async () => {
    const dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    mockDialogData = {
      domain: 'example.com',
    };

    await TestBed.configureTestingModule({
      imports: [
        ConfirmUrlImportDialogComponent,
        MatDialogModule,
        MatButtonModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmUrlImportDialogComponent);
    component = fixture.componentInstance;
    mockDialogRef = TestBed.inject(MatDialogRef) as jasmine.SpyObj<
      MatDialogRef<ConfirmUrlImportDialogComponent>
    >;

    fixture.detectChanges();
  });

  describe('component creation and initialization', () => {
    it('should initialize with T constant', () => {
      expect(component.T).toBe(T);
    });

    it('should inject dialog data', () => {
      expect(component.data).toEqual(mockDialogData);
      expect(component.data.domain).toBe('example.com');
    });
  });

  describe('data injection and validation', () => {
    it('should handle valid dialog data', () => {
      expect(component.data.domain).toBe('example.com');
      expect(component.data).toEqual({ domain: 'example.com' });
    });

    it('should handle different domain formats', () => {
      const testCases = [
        'github.com',
        'api.github.com',
        'my-site.example.org',
        'localhost:3000',
        '192.168.1.1',
      ];

      testCases.forEach((domain) => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          imports: [
            ConfirmUrlImportDialogComponent,
            MatDialogModule,
            MatButtonModule,
            TranslateModule.forRoot(),
          ],
          providers: [
            { provide: MatDialogRef, useValue: mockDialogRef },
            { provide: MAT_DIALOG_DATA, useValue: { domain } },
          ],
        });

        const testFixture = TestBed.createComponent(ConfirmUrlImportDialogComponent);
        const testComponent = testFixture.componentInstance;
        testFixture.detectChanges();

        expect(testComponent.data.domain).toBe(domain);
      });
    });
  });

  describe('confirm functionality', () => {
    it('should close dialog with true when onConfirm is called', () => {
      component.onConfirm();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should call onConfirm when confirm button is clicked', () => {
      spyOn(component, 'onConfirm');

      const confirmButton = fixture.debugElement.query(By.css('button[color="primary"]'));
      confirmButton.nativeElement.click();

      expect(component.onConfirm).toHaveBeenCalled();
    });
  });

  describe('cancel functionality', () => {
    it('should close dialog with false when onCancel is called', () => {
      component.onCancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });

    it('should call onCancel when cancel button is clicked', () => {
      spyOn(component, 'onCancel');

      const cancelButton = fixture.debugElement.query(
        By.css('button[mat-stroked-button]'),
      );
      cancelButton.nativeElement.click();

      expect(component.onCancel).toHaveBeenCalled();
    });
  });

  describe('template rendering and domain display', () => {
    it('should render dialog title', () => {
      const titleElement = fixture.debugElement.query(By.css('h1[mat-dialog-title]'));
      expect(titleElement).toBeTruthy();
    });

    it('should render dialog content with multiple paragraphs', () => {
      const contentElement = fixture.debugElement.query(By.css('mat-dialog-content'));
      const paragraphs = fixture.debugElement.queryAll(By.css('mat-dialog-content p'));

      expect(contentElement).toBeTruthy();
      expect(paragraphs.length).toBe(3); // Initiated msg, domain, warning
    });

    it('should display the domain as a link', () => {
      const domainLink = fixture.debugElement.query(By.css('a.domain-link'));

      expect(domainLink).toBeTruthy();
      // Note: In test environment, relative URLs get converted to absolute URLs
      expect(domainLink.nativeElement.href).toContain('example.com');
      expect(domainLink.nativeElement.target).toBe('_blank');
      expect(domainLink.nativeElement.rel).toBe('noopener noreferrer');
      expect(domainLink.nativeElement.textContent.trim()).toBe('example.com');
    });

    it('should render warning text with proper styling', () => {
      const warningElement = fixture.debugElement.query(By.css('p.warning-text'));
      const warningTitle = fixture.debugElement.query(By.css('p.warning-text strong'));

      expect(warningElement).toBeTruthy();
      expect(warningTitle).toBeTruthy();
    });

    it('should render dialog actions with two buttons', () => {
      const actionsElement = fixture.debugElement.query(By.css('mat-dialog-actions'));
      const buttons = fixture.debugElement.queryAll(By.css('mat-dialog-actions button'));

      expect(actionsElement).toBeTruthy();
      expect(buttons.length).toBe(2);
    });

    it('should display initial domain correctly', () => {
      const domainLink = fixture.debugElement.query(By.css('a.domain-link'));
      expect(domainLink.nativeElement.textContent.trim()).toBe('example.com');
      expect(domainLink.nativeElement.getAttribute('href')).toContain('example.com');
    });
  });

  describe('accessibility and template structure', () => {
    it('should have proper button types and attributes', () => {
      const confirmButton = fixture.debugElement.query(By.css('button[color="primary"]'));
      const cancelButton = fixture.debugElement.query(
        By.css('button[mat-stroked-button]'),
      );

      expect(confirmButton.nativeElement.hasAttribute('mat-raised-button')).toBe(true);
      expect(confirmButton.attributes['color']).toBe('primary');

      expect(cancelButton.nativeElement.hasAttribute('mat-stroked-button')).toBe(true);
      expect(cancelButton.attributes['color']).toBeUndefined();
    });

    it('should have proper dialog structure with title, content, and actions', () => {
      const title = fixture.debugElement.query(By.css('[mat-dialog-title]'));
      const content = fixture.debugElement.query(By.css('mat-dialog-content'));
      const actions = fixture.debugElement.query(By.css('mat-dialog-actions'));

      expect(title).toBeTruthy();
      expect(content).toBeTruthy();
      expect(actions).toBeTruthy();
      expect(actions.attributes['align']).toBe('end');
    });

    it('should use translation pipes in template', () => {
      const titleElement = fixture.debugElement.query(By.css('h1[mat-dialog-title]'));
      const paragraphs = fixture.debugElement.queryAll(By.css('mat-dialog-content p'));
      const buttons = fixture.debugElement.queryAll(By.css('mat-dialog-actions button'));

      expect(titleElement).toBeTruthy();
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(buttons.length).toBe(2);
    });

    it('should have proper link attributes for security', () => {
      const domainLink = fixture.debugElement.query(By.css('a.domain-link'));

      expect(domainLink.nativeElement.target).toBe('_blank');
      expect(domainLink.nativeElement.rel).toBe('noopener noreferrer');
    });
  });

  describe('edge cases and testing limitations', () => {
    it('should handle the current domain correctly in initial state', () => {
      const domainLink = fixture.debugElement.query(By.css('a.domain-link'));
      expect(domainLink.nativeElement.textContent.trim()).toBe('example.com');
    });
  });

  describe('component lifecycle and change detection', () => {
    it('should handle multiple rapid button clicks without issues', () => {
      // Test that multiple clicks don't cause issues
      component.onConfirm();
      component.onConfirm();
      component.onCancel();
      component.onCancel();

      // Should have been called multiple times
      expect(mockDialogRef.close).toHaveBeenCalledTimes(4);
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });
  });
});
