import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { UnsplashService } from '../../core/unsplash/unsplash.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { FormlyImageInputComponent } from './formly-image-input.component';

describe('FormlyImageInputComponent', () => {
  let fixture: ComponentFixture<FormlyImageInputComponent>;
  let component: FormlyImageInputComponent;
  let formControl: FormControl<string | null>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    const matDialogMock = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    const unsplashServiceMock = jasmine.createSpyObj<UnsplashService>('UnsplashService', [
      'isAvailable',
    ]);
    unsplashServiceMock.isAvailable.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [
        FormlyImageInputComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: SnackService, useValue: snackService },
        { provide: MatDialog, useValue: matDialogMock },
        { provide: UnsplashService, useValue: unsplashServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyImageInputComponent);
    component = fixture.componentInstance;
    formControl = new FormControl<string | null>(null);
    Object.defineProperty(component, 'formControl', {
      get: () => formControl,
      configurable: true,
    });
    component.field = { props: {}, templateOptions: {} } as any;
    fixture.detectChanges();
  });

  const createEvent = (file?: File): Event => {
    return {
      target: {
        files: file ? [file] : [],
        value: 'some-value',
      },
    } as unknown as Event;
  };

  it('sets data url for successful file reads', () => {
    const fileReaderMock: Partial<FileReader> = {
      result: 'data:image/png;base64,ok',
      readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (
        this: FileReader,
      ) {
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
      }),
      onload: null,
      onerror: null,
    };
    spyOn(window as any, 'FileReader').and.returnValue(fileReaderMock as FileReader);
    const setValueSpy = spyOn(formControl, 'setValue').and.callThrough();

    const file = new File(['ok'], 'ok.png', { type: 'image/png' });
    component.onFileSelected(createEvent(file));

    expect(setValueSpy).toHaveBeenCalledWith('data:image/png;base64,ok');
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('handles cancel path without reading file', () => {
    const setValueSpy = spyOn(formControl, 'setValue').and.callThrough();
    const event = createEvent(undefined);

    component.onFileSelected(event);

    expect((event.target as HTMLInputElement).value).toBe('');
    expect(setValueSpy).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('rejects oversized files with snack', () => {
    const largeBytes = new Uint8Array(205 * 1024);
    const file = new File([largeBytes], 'large.png', { type: 'image/png' });
    const setValueSpy = spyOn(formControl, 'setValue').and.callThrough();

    component.onFileSelected(createEvent(file));

    expect(setValueSpy).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_TOO_LARGE,
      type: 'ERROR',
      translateParams: { maxSizeKb: 200 },
    });
  });

  it('shows snack when file reading fails', () => {
    const fileReaderMock: Partial<FileReader> = {
      readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (
        this: FileReader,
      ) {
        this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
      }),
      onload: null,
      onerror: null,
    };
    spyOn(window as any, 'FileReader').and.returnValue(fileReaderMock as FileReader);
    const setValueSpy = spyOn(formControl, 'setValue').and.callThrough();
    const file = new File(['bad'], 'bad.png', { type: 'image/png' });

    component.onFileSelected(createEvent(file));

    expect(setValueSpy).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.PROJECT.FORM_THEME.S_BACKGROUND_IMAGE_READ_ERROR,
      type: 'ERROR',
    });
  });

  it('sets file url from electron dialog selection', async () => {
    (component as any).IS_ELECTRON = true;

    (window as any).ea = {
      showOpenDialog: jasmine
        .createSpy('showOpenDialog')
        .and.resolveTo(['/home/test/image.png']),
      toFileUrl: jasmine
        .createSpy('toFileUrl')
        .and.resolveTo('file:///home/test/image.png'),
    };

    const setValueSpy = spyOn(formControl, 'setValue').and.callThrough();

    await component.openFileExplorer();

    expect(setValueSpy).toHaveBeenCalledWith('file:///home/test/image.png');
  });
});
