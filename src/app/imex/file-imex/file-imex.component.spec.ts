import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

import { FileImexComponent } from './file-imex.component';
import { SnackService } from '../../core/snack/snack.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { T } from '../../t.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { ConfirmUrlImportDialogComponent } from '../dialog-confirm-url-import/dialog-confirm-url-import.component';
import { DialogImportFromUrlComponent } from '../dialog-import-from-url/dialog-import-from-url.component';
import { createAppDataCompleteMock } from '../../util/app-data-mock';

describe('FileImexComponent', () => {
  let component: FileImexComponent;
  let fixture: ComponentFixture<FileImexComponent>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockBackupService: jasmine.SpyObj<BackupService>;
  let mockActivatedRoute: any;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let httpTestingController: HttpTestingController;

  const mockAppData = createAppDataCompleteMock();

  beforeEach(async () => {
    // Alert is already mocked globally, just reset the spy
    if ((window.alert as jasmine.Spy).calls) {
      (window.alert as jasmine.Spy).calls.reset();
    }

    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    const backupServiceSpy = jasmine.createSpyObj('BackupService', [
      'importCompleteBackup',
      'loadCompleteBackup',
    ]);
    backupServiceSpy.loadCompleteBackup.and.returnValue(Promise.resolve(mockAppData));
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    mockActivatedRoute = {
      queryParams: of({}),
    };

    routerSpy.navigate.and.returnValue(Promise.resolve(true));
    backupServiceSpy.importCompleteBackup.and.returnValue(Promise.resolve());
    matDialogSpy.open.and.returnValue({
      afterClosed: jasmine.createSpy().and.returnValue(of(false)),
    } as any);

    await TestBed.configureTestingModule({
      imports: [FileImexComponent, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: BackupService, useValue: backupServiceSpy },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: MatDialog, useValue: matDialogSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FileImexComponent);
    component = fixture.componentInstance;
    mockSnackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    mockRouter = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    mockBackupService = TestBed.inject(BackupService) as jasmine.SpyObj<BackupService>;
    mockMatDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should handle importFromUrl query parameter', async () => {
      const mockUrl = 'https://example.com/backup.json';
      mockActivatedRoute.queryParams = of({ importFromUrl: mockUrl });

      const dialogRefSpy = {
        afterClosed: jasmine.createSpy().and.returnValue(of(true)),
      };
      mockMatDialog.open.and.returnValue(dialogRefSpy as any);

      spyOn(component, 'importFromUrlHandler');

      component.ngOnInit();

      // Allow async operations to complete
      await fixture.whenStable();

      expect(mockRouter.navigate).toHaveBeenCalledWith([], {
        relativeTo: mockActivatedRoute,
        queryParams: { importFromUrl: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });

      expect(mockMatDialog.open).toHaveBeenCalledWith(ConfirmUrlImportDialogComponent, {
        data: { domain: 'example.com' },
      });

      expect(component.importFromUrlHandler).toHaveBeenCalledWith(
        'https://example.com/backup.json',
      );
    });

    it('should handle malformed URL in importFromUrl parameter', async () => {
      const malformedUrl = '%invalid%url%';
      mockActivatedRoute.queryParams = of({ importFromUrl: malformedUrl });

      component.ngOnInit();

      // Allow async operations to complete
      await fixture.whenStable();

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_IMPORT_FROM_URL_ERR_DECODE,
      });
    });

    it('should do nothing when no importFromUrl parameter', async () => {
      mockActivatedRoute.queryParams = of({});

      component.ngOnInit();

      // Allow async operations to complete
      await fixture.whenStable();

      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockMatDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('handleFileInput', () => {
    let mockFileReader: any;
    let mockFile: any;
    let mockEvent: any;
    let mockFileInputElement: any;

    beforeEach(() => {
      mockFileReader = {
        readAsText: jasmine.createSpy(),
        onload: null,
        result: '{"mocked": "data"}',
      };

      spyOn(window as any, 'FileReader').and.returnValue(mockFileReader);

      mockFile = new File(['test content'], 'test.json', { type: 'application/json' });

      mockFileInputElement = {
        value: 'some-file.json',
        nativeElement: {
          value: 'some-file.json',
          type: 'file',
        },
      };

      spyOn(component, 'fileInputRef' as any).and.returnValue(mockFileInputElement);
      spyOn(component, '_processAndImportData' as any).and.returnValue(Promise.resolve());

      mockEvent = {
        target: {
          files: {
            item: jasmine.createSpy().and.returnValue(mockFile),
          },
        },
      };
    });

    it('should process file when file is selected', async () => {
      await component.handleFileInput(mockEvent);

      expect(mockFileReader.readAsText).toHaveBeenCalledWith(mockFile);

      mockFileReader.onload();

      expect(component['_processAndImportData']).toHaveBeenCalledWith(
        '{"mocked": "data"}',
      );
    });

    it('should return early when no file is selected', async () => {
      mockEvent.target.files.item.and.returnValue(null);

      await component.handleFileInput(mockEvent);

      expect(mockFileReader.readAsText).not.toHaveBeenCalled();
      expect(component['_processAndImportData']).not.toHaveBeenCalled();
    });

    it('should set up file reader properly', async () => {
      await component.handleFileInput(mockEvent);

      expect(mockFileReader.readAsText).toHaveBeenCalledWith(mockFile);
      expect(mockFileReader.onload).toBeDefined();
    });
  });

  describe('importFromUrlHandler', () => {
    beforeEach(() => {
      spyOn(component, '_processAndImportData' as any).and.returnValue(Promise.resolve());
    });

    afterEach(() => {
      httpTestingController.verify();
    });

    it('should import data from valid URL', async () => {
      const testUrl = 'https://example.com/backup.json';
      const mockData = '{"imported": "data"}';

      const promise = component.importFromUrlHandler(testUrl);

      const req = httpTestingController.expectOne(testUrl);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Accept')).toBe('application/json');

      req.flush(mockData);
      await promise;

      expect(component['_processAndImportData']).toHaveBeenCalledWith(mockData);
    });

    it('should handle empty URL', async () => {
      await component.importFromUrlHandler('');

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_INVALID_URL,
      });
      httpTestingController.expectNone(() => true);
    });

    it('should handle HTTP error responses', async () => {
      const testUrl = 'https://example.com/backup.json';

      const promise = component.importFromUrlHandler(testUrl);

      const req = httpTestingController.expectOne(testUrl);
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });

      await promise;

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_NETWORK,
      });
    });

    it('should handle network errors', async () => {
      const testUrl = 'https://example.com/backup.json';

      const promise = component.importFromUrlHandler(testUrl);

      const req = httpTestingController.expectOne(testUrl);
      req.error(new ErrorEvent('Network error'));

      await promise;

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_NETWORK,
      });
    });
  });

  describe('openUrlImportDialog', () => {
    it('should open dialog and call importFromUrlHandler when URL is provided', () => {
      const dialogRefSpy = {
        afterClosed: jasmine
          .createSpy()
          .and.returnValue(of('https://example.com/backup.json')),
      };
      mockMatDialog.open.and.returnValue(dialogRefSpy as any);
      spyOn(component, 'importFromUrlHandler');

      component.openUrlImportDialog();

      expect(mockMatDialog.open).toHaveBeenCalledWith(DialogImportFromUrlComponent, {
        width: '500px',
      });
      expect(component.importFromUrlHandler).toHaveBeenCalledWith(
        'https://example.com/backup.json',
      );
    });

    it('should not call importFromUrlHandler when dialog is cancelled', () => {
      const dialogRefSpy = {
        afterClosed: jasmine.createSpy().and.returnValue(of(undefined)),
      };
      mockMatDialog.open.and.returnValue(dialogRefSpy as any);
      spyOn(component, 'importFromUrlHandler');

      component.openUrlImportDialog();

      expect(component.importFromUrlHandler).not.toHaveBeenCalled();
    });
  });

  describe('_processAndImportData', () => {
    it('should process valid JSON data', async () => {
      const validData = JSON.stringify(mockAppData);

      await component['_processAndImportData'](validData);

      expect(mockRouter.navigate).toHaveBeenCalledWith([`tag/${TODAY_TAG.id}/tasks`]);
      // importCompleteBackup is called with (data, isBackup=false, isForceConflict=true)
      expect(mockBackupService.importCompleteBackup).toHaveBeenCalledWith(
        jasmine.any(Object),
        false,
        true,
      );
    });

    it('should handle invalid JSON data', async () => {
      const invalidData = '{ invalid json';

      await component['_processAndImportData'](invalidData);

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_INVALID_DATA,
      });
      expect(mockBackupService.importCompleteBackup).not.toHaveBeenCalled();
    });

    it('should handle V1 data format', async () => {
      const v1Data = JSON.stringify({ config: {}, tasks: [] });

      await component['_processAndImportData'](v1Data);

      expect(window.alert).toHaveBeenCalledWith(
        'V1 Data. Migration not supported any more.',
      );
      expect(mockBackupService.importCompleteBackup).not.toHaveBeenCalled();
    });

    it('should handle import errors', async () => {
      const validData = JSON.stringify(mockAppData);
      mockBackupService.importCompleteBackup.and.returnValue(
        Promise.reject(new Error('Import failed')),
      );

      await component['_processAndImportData'](validData);

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
      });
    });

    it('should handle null or undefined data', async () => {
      await component['_processAndImportData']('null');

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_INVALID_DATA,
      });
    });
  });

  describe('downloadBackup', () => {
    it('should load backup data', async () => {
      await component.downloadBackup();

      expect(mockBackupService.loadCompleteBackup).toHaveBeenCalled();
    });
  });

  describe('privacyAppDataDownload', () => {
    it('should load backup data for privacy export', async () => {
      await component.privacyAppDataDownload();

      expect(mockBackupService.loadCompleteBackup).toHaveBeenCalled();
    });
  });
});
