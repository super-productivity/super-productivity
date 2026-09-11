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

  it('removes executable attributes from plugin HTML', async () => {
    await createComponent({
      htmlContent: `
        <img id="plugin-dialog-img" onerror="alert(document.domain)">
        <a id="plugin-dialog-link" href="#" onmouseover="alert(document.domain)">
          Link
        </a>
      `,
    });

    const img = fixture.nativeElement.querySelector('mat-dialog-content img');
    const link = fixture.nativeElement.querySelector('mat-dialog-content a');

    expect(img.getAttribute('onerror')).toBeNull();
    expect(link.getAttribute('onmouseover')).toBeNull();
  });

  it('preserves safe rich HTML and form controls', async () => {
    await createComponent({
      htmlContent: `
        <h2>Plugin settings</h2>
        <label for="plugin-dialog-input">Name</label>
        <input id="plugin-dialog-input" value="Example">
        <p><strong>Ready</strong></p>
      `,
    });

    const input = fixture.nativeElement.querySelector('mat-dialog-content input');

    expect(fixture.nativeElement.querySelector('h2').textContent).toBe('Plugin settings');
    expect(input.value).toBe('Example');
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('Ready');
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
