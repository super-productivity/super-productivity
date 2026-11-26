import { TestBed } from '@angular/core/testing';
import { IssueSyncPushRequest, IssueSyncStateService } from './issue-sync-state.service';

describe('IssueSyncStateService', () => {
  let service: IssueSyncStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IssueSyncStateService);
  });

  it('records and clears a failure per task', () => {
    service.reportFailure('a', { msgKey: 'KEY' });
    service.reportFailure('b', { text: 'offline' });
    expect(service.failures().get('a')).toEqual({ msgKey: 'KEY' });
    service.clearFailure('a');
    expect(service.failures().has('a')).toBeFalse();
    expect(service.failures().has('b')).toBeTrue();
  });

  it('rebuilds "missing" for the polled tasks only', () => {
    service.setMissing(['a', 'b'], ['a']);
    service.setMissing(['c'], ['c']);
    expect([...service.missingTaskIds()].sort()).toEqual(['a', 'c']);

    service.setMissing(['a', 'b'], []);
    expect([...service.missingTaskIds()]).toEqual(['c']);
  });

  it('drops the failure of a task that went missing', () => {
    service.reportFailure('a', { text: 'x' });
    service.setMissing(['a'], ['a']);
    expect(service.failures().has('a')).toBeFalse();
  });

  it('keeps the same set when nothing changed', () => {
    service.setMissing(['a'], ['a']);
    const before = service.missingTaskIds();
    service.setMissing(['a'], ['a']);
    expect(service.missingTaskIds()).toBe(before);
  });

  it('emits push requests', () => {
    const requests: IssueSyncPushRequest[] = [];
    service.pushRequests$.subscribe((r) => requests.push(r));
    service.requestPush('a', true);
    expect(requests).toEqual([{ taskId: 'a', isSilent: true }]);
  });
});
