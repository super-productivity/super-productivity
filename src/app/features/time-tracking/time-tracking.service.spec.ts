import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { LOCK_NAMES } from '../../op-log/core/operation-log.const';
import { LockService } from '../../op-log/sync/lock.service';
import { ArchiveModel } from '../archive/archive.model';
import { initialTimeTrackingState } from './store/time-tracking.reducer';
import { TimeTrackingService } from './time-tracking.service';

const archiveWithTimeTracking = (): ArchiveModel => ({
  task: { ids: [], entities: {} },
  timeTracking: {
    project: { project1: {} },
    tag: { tag1: {} },
  },
  lastTimeTrackingFlush: 0,
});

describe('TimeTrackingService archive cleanup', () => {
  let service: TimeTrackingService;
  let storeMock: jasmine.SpyObj<Store>;
  let archiveDbAdapterMock: jasmine.SpyObj<ArchiveDbAdapter>;
  let lockServiceMock: jasmine.SpyObj<LockService>;

  beforeEach(() => {
    storeMock = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    storeMock.select.and.returnValue(of(initialTimeTrackingState));
    archiveDbAdapterMock = jasmine.createSpyObj<ArchiveDbAdapter>('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);
    archiveDbAdapterMock.loadArchiveYoung.and.callFake(async () =>
      archiveWithTimeTracking(),
    );
    archiveDbAdapterMock.loadArchiveOld.and.callFake(async () =>
      archiveWithTimeTracking(),
    );
    archiveDbAdapterMock.saveArchiveYoung.and.resolveTo(undefined);
    archiveDbAdapterMock.saveArchiveOld.and.resolveTo(undefined);
    lockServiceMock = jasmine.createSpyObj<LockService>('LockService', ['request']);
    lockServiceMock.request.and.callFake(
      <T>(_lockName: string, callback: () => Promise<T>): Promise<T> => callback(),
    );

    TestBed.configureTestingModule({
      providers: [
        TimeTrackingService,
        { provide: Store, useValue: storeMock },
        { provide: ArchiveDbAdapter, useValue: archiveDbAdapterMock },
        { provide: LockService, useValue: lockServiceMock },
      ],
    });
    service = TestBed.inject(TimeTrackingService);
  });

  it('serializes project cleanup behind the archive mutex', async () => {
    await service.cleanupDataEverywhereForProject('project1');

    expect(lockServiceMock.request).toHaveBeenCalledOnceWith(
      LOCK_NAMES.TASK_ARCHIVE,
      jasmine.any(Function),
    );
    expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
    expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();
  });

  it('serializes tag cleanup behind the archive mutex', async () => {
    await service.cleanupArchiveDataForTag('tag1');

    expect(lockServiceMock.request).toHaveBeenCalledOnceWith(
      LOCK_NAMES.TASK_ARCHIVE,
      jasmine.any(Function),
    );
    expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
    expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();
  });
});
