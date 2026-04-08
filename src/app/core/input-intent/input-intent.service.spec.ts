import { TestBed } from '@angular/core/testing';
import { InputIntentService, _inputIntentSignal } from './input-intent.service';

describe('InputIntentService', () => {
  beforeEach(() => {
    _inputIntentSignal.set('mouse');
  });

  it('should be injectable', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(InputIntentService);
    expect(service).toBeTruthy();
  });

  it('should expose currentIntent as readonly signal', () => {
    TestBed.configureTestingModule({});
    const service = TestBed.inject(InputIntentService);
    expect(service.currentIntent()).toBe('mouse');
  });

  it('should not modify body classes on non-hybrid device (test env is mouseOnly)', () => {
    const beforeClasses = Array.from(document.body.classList);
    TestBed.configureTestingModule({});
    TestBed.inject(InputIntentService);
    const afterClasses = Array.from(document.body.classList);
    expect(afterClasses).toEqual(beforeClasses);
  });

  describe('_inputIntentSignal', () => {
    it('should default to mouse', () => {
      expect(_inputIntentSignal()).toBe('mouse');
    });

    it('should be writable', () => {
      _inputIntentSignal.set('touch');
      expect(_inputIntentSignal()).toBe('touch');
      _inputIntentSignal.set('mouse');
      expect(_inputIntentSignal()).toBe('mouse');
    });
  });
});
