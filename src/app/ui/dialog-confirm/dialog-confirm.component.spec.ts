import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogConfirmComponent } from './dialog-confirm.component';
import { By } from '@angular/platform-browser';

describe('DialogConfirmComponent', () => {
  let component: DialogConfirmComponent;
  let fixture: ComponentFixture<DialogConfirmComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogConfirmComponent>>;

  const createComponent = async (dialogData: any): Promise<void> => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [
        DialogConfirmComponent,
        NoopAnimationsModule,
        MatDialogModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogConfirmComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  describe('basic functionality', () => {
    beforeEach(async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
      });
    });

    it('should display title when provided', () => {
      const titleElement = fixture.debugElement.query(By.css('h1'));
      expect(titleElement).toBeTruthy();
    });

    it('should display message', () => {
      const contentElement = fixture.debugElement.query(By.css('.content'));
      expect(contentElement).toBeTruthy();
    });

    it('should show both cancel and confirm buttons by default', () => {
      const buttons = fixture.debugElement.queryAll(By.css('button'));
      expect(buttons.length).toBe(2);
    });

    it('should close with false when cancel is clicked', () => {
      const cancelButton = fixture.debugElement.queryAll(By.css('button'))[0];
      cancelButton.nativeElement.click();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });

    it('should close with true when confirm is clicked', () => {
      const confirmButton = fixture.debugElement.query(
        By.css('button[e2e="confirmBtn"]'),
      );
      confirmButton.nativeElement.click();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });
  });

  describe('hideCancelButton option', () => {
    it('should hide cancel button when hideCancelButton is true', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        hideCancelButton: true,
      });

      const buttons = fixture.debugElement.queryAll(By.css('button'));
      expect(buttons.length).toBe(1);

      // The only button should be the confirm button
      const confirmButton = fixture.debugElement.query(
        By.css('button[e2e="confirmBtn"]'),
      );
      expect(confirmButton).toBeTruthy();
    });

    it('should show cancel button when hideCancelButton is false', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        hideCancelButton: false,
      });

      const buttons = fixture.debugElement.queryAll(By.css('button'));
      expect(buttons.length).toBe(2);
    });

    it('should show cancel button when hideCancelButton is undefined', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
      });

      const buttons = fixture.debugElement.queryAll(By.css('button'));
      expect(buttons.length).toBe(2);
    });

    it('should still allow confirm when cancel is hidden', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        hideCancelButton: true,
      });

      const confirmButton = fixture.debugElement.query(
        By.css('button[e2e="confirmBtn"]'),
      );
      confirmButton.nativeElement.click();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });
  });

  describe('title icon', () => {
    it('should show title icon when provided', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        titleIcon: 'warning',
      });

      const iconElement = fixture.debugElement.query(By.css('.dialog-header-icon'));
      expect(iconElement).toBeTruthy();
    });

    it('should not show title icon when not provided', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
      });

      const iconElement = fixture.debugElement.query(By.css('.dialog-header-icon'));
      expect(iconElement).toBeFalsy();
    });
  });

  describe('showDontShowAgain option', () => {
    it('should not show checkbox when showDontShowAgain is false', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        showDontShowAgain: false,
      });

      const checkbox = fixture.debugElement.query(By.css('mat-checkbox'));
      expect(checkbox).toBeFalsy();
    });

    it('should not show checkbox when showDontShowAgain is undefined', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
      });

      const checkbox = fixture.debugElement.query(By.css('mat-checkbox'));
      expect(checkbox).toBeFalsy();
    });

    it('should show checkbox when showDontShowAgain is true', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        showDontShowAgain: true,
      });

      const checkbox = fixture.debugElement.query(By.css('mat-checkbox'));
      expect(checkbox).toBeTruthy();
    });

    it('should return object with dontShowAgain state when closing with showDontShowAgain enabled', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        showDontShowAgain: true,
      });

      // Set the dontShowAgain state (cast to any since property added with feature)
      (component as any).dontShowAgain = true;
      fixture.detectChanges();

      // Click confirm button
      const confirmButton = fixture.debugElement.query(
        By.css('button[e2e="confirmBtn"]'),
      );
      confirmButton.nativeElement.click();

      expect(mockDialogRef.close).toHaveBeenCalledWith({
        confirmed: true,
        dontShowAgain: true,
      });
    });

    it('should return object with confirmed false when canceling with showDontShowAgain enabled', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        showDontShowAgain: true,
      });

      // Click cancel button
      const cancelButton = fixture.debugElement.queryAll(By.css('button'))[0];
      cancelButton.nativeElement.click();

      expect(mockDialogRef.close).toHaveBeenCalledWith({
        confirmed: false,
        dontShowAgain: false,
      });
    });

    it('should return boolean directly when showDontShowAgain is false', async () => {
      await createComponent({
        title: 'Test Title',
        message: 'Test Message',
        showDontShowAgain: false,
      });

      const confirmButton = fixture.debugElement.query(
        By.css('button[e2e="confirmBtn"]'),
      );
      confirmButton.nativeElement.click();

      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });
  });
});
