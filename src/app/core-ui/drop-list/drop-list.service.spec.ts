import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { DropListService } from './drop-list.service';

describe('DropListService', () => {
  let service: DropListService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DropListService] });
    service = TestBed.inject(DropListService);
  });

  describe('subtask drag-start window', () => {
    it('is closed by default', () => {
      expect(service.isSubTaskDragStarting()).toBe(false);
    });

    it('opens synchronously and closes on the next microtask', fakeAsync(() => {
      service.markSubTaskDragStarting();
      // Must stay open through CDK's synchronous `_startReceiving` pass so the
      // top-level lists get their geometry cached.
      expect(service.isSubTaskDragStarting()).toBe(true);

      flushMicrotasks();
      // Closed again before the first pointer move so the pointer guard resumes.
      expect(service.isSubTaskDragStarting()).toBe(false);
    }));
  });
});
