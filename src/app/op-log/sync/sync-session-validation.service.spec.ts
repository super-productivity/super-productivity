import { TestBed } from '@angular/core/testing';
import { SyncSessionValidationService } from './sync-session-validation.service';

describe('SyncSessionValidationService', () => {
  let service: SyncSessionValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyncSessionValidationService);
  });

  it('starts in the not-failed state', () => {
    expect(service.hasFailed()).toBe(false);
  });

  it('hasFailed() reports true after setFailed()', () => {
    service.setFailed();
    expect(service.hasFailed()).toBe(true);
  });

  it('reset() clears the latch', () => {
    service.setFailed();
    service.reset();
    expect(service.hasFailed()).toBe(false);
  });

  it('setFailed() is idempotent', () => {
    service.setFailed();
    service.setFailed();
    expect(service.hasFailed()).toBe(true);
  });

  it('latch persists across hasFailed() reads until reset', () => {
    service.setFailed();
    expect(service.hasFailed()).toBe(true);
    expect(service.hasFailed()).toBe(true);
    service.reset();
    expect(service.hasFailed()).toBe(false);
  });
});
