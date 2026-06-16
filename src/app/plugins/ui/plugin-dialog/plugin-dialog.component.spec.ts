import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { DialogCfg } from '../../plugin-api.model';
import { PluginSecurityService } from '../../plugin-security';
import { PluginDialogComponent } from './plugin-dialog.component';

describe('PluginDialogComponent', () => {
  let fixture: ComponentFixture<PluginDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<PluginDialogComponent>>;

  const createComponent = async (
    dialogData: DialogCfg,
  ): Promise<PluginDialogComponent> => {
    dialogRef = jasmine.createSpyObj<MatDialogRef<PluginDialogComponent>>(
      'MatDialogRef',
      ['close'],
      { disableClose: false },
    );

    await TestBed.configureTestingModule({
      imports: [
        PluginDialogComponent,
        MatDialogModule,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: PluginSecurityService, useClass: PluginSecurityService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PluginDialogComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  it('renders legacy content as plain text and creates legacy buttons', async () => {
    await createComponent({
      title: 'Confirm Action',
      content: 'Are you sure?',
      okBtnLabel: 'Yes',
      cancelBtnLabel: 'No',
    });

    expect(fixture.nativeElement.textContent).toContain('Are you sure?');

    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons.map((button) => button.nativeElement.textContent.trim())).toEqual([
      'No',
      'Yes',
    ]);
  });

  it('closes with the clicked custom button label', async () => {
    const onClick = jasmine.createSpy('onClick').and.resolveTo();
    const component = await createComponent({
      htmlContent: '<p>Pick one</p>',
      buttons: [{ label: 'Confirm', onClick }],
    });

    await component.onButtonClick(component.dialogData.buttons![0]);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).toHaveBeenCalledOnceWith('Confirm');
  });

  it('closes with the default OK label', async () => {
    const component = await createComponent({
      htmlContent: '<p>No custom buttons</p>',
    });

    await component.onButtonClick(component.defaultButtons[0]);

    expect(dialogRef.close).toHaveBeenCalledOnceWith(component.defaultButtons[0].label);
  });
});
