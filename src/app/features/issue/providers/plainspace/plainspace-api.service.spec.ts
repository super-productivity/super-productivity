import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';
import { PLAINSPACE_MOCK_CURRENT_USER_ID, PLAINSPACE_USE_MOCK } from './plainspace.const';

// These cover the prototype's mock-mode behaviour (PLAINSPACE_USE_MOCK === true):
// the mine/unassigned filter that feeds the issue→task pipeline, search scoping,
// lookup by id, and space creation. Once the real API is wired up (mock flag
// off) these should be re-pointed at HttpTestingController like the Redmine spec.
describe('PlainspaceApiService (mock mode)', () => {
  let service: PlainspaceApiService;

  const mockCfg: PlainspaceCfg = {
    isEnabled: true,
    host: 'https://plainspace.org',
    spaceId: 'space-1',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PlainspaceApiService],
    });
    service = TestBed.inject(PlainspaceApiService);
  });

  it('runs in mock mode for the prototype', () => {
    expect(PLAINSPACE_USE_MOCK).toBe(true);
  });

  it('getMyAndUnassignedTasks$ returns only my + unassigned tasks', async () => {
    const tasks = await firstValueFrom(service.getMyAndUnassignedTasks$(mockCfg));
    expect(tasks.length).toBeGreaterThan(0);
    expect(
      tasks.every(
        (t) => t.assigneeId === null || t.assigneeId === PLAINSPACE_MOCK_CURRENT_USER_ID,
      ),
    ).toBe(true);
    // never surfaces tasks assigned to others
    expect(tasks.some((t) => t.assigneeId === 'u-mara')).toBe(false);
  });

  it('searchIssues$ filters my/unassigned tasks by title and excludes others', async () => {
    const results = await firstValueFrom(service.searchIssues$('triage', mockCfg));
    expect(results.length).toBe(1);
    expect(results[0].issueType).toBe('PLAINSPACE');
    // a term that only matches a task assigned to someone else yields nothing
    const none = await firstValueFrom(service.searchIssues$('staging', mockCfg));
    expect(none.length).toBe(0);
  });

  it('getById$ resolves any task in the space, or null when missing', async () => {
    const found = await firstValueFrom(service.getById$('ps-103', mockCfg));
    expect(found?.id).toBe('ps-103');
    const missing = await firstValueFrom(service.getById$('does-not-exist', mockCfg));
    expect(missing).toBeNull();
  });

  it('createSpace$ returns a generated space id', async () => {
    const space = await firstValueFrom(service.createSpace$('My Space', mockCfg));
    expect(space.id.startsWith('space-')).toBe(true);
  });
});
