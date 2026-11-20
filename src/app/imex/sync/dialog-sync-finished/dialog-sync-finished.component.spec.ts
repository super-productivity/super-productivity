import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogSyncFinishedComponent } from './dialog-sync-finished.component';

describe('DialogSyncFinishedComponent', () => {
  it('shows the task count and closes on the button', async () => {
    const dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    await TestBed.configureTestingModule({
      imports: [
        DialogSyncFinishedComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { taskCount: 24 } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      F: { SYNC: { D_SYNC_FINISHED: { TASK_COUNT: 'Tasks here: {{count}}' } } },
    });
    translate.use('en');
    const fixture = TestBed.createComponent(DialogSyncFinishedComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.e2e-sync-finished-count')?.textContent).toContain(
      'Tasks here: 24',
    );
    el.querySelector<HTMLButtonElement>('.e2e-sync-finished-close')!.click();
    expect(dialogRef.close).toHaveBeenCalled();
  });
});
