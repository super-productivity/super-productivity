import { TestBed } from '@angular/core/testing';
import { WorkViewLayoutService } from './work-view-layout.service';

describe('WorkViewLayoutService', () => {
  let service: WorkViewLayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WorkViewLayoutService);
  });

  it('defaults to list', () => {
    expect(service.getLayout('TODAY')).toBe('list');
  });

  it('toggles one context without touching another', () => {
    service.toggleLayout('TODAY');
    expect(service.getLayout('TODAY')).toBe('kanban');
    expect(service.getLayout('OTHER')).toBe('list');

    service.toggleLayout('TODAY');
    expect(service.getLayout('TODAY')).toBe('list');
  });
});
