import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';
import { PLAINSPACE_USE_MOCK } from './plainspace.const';
import { resetPlainspaceMockData } from './plainspace-mock-data.const';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';

// Covers the prototype's mock-mode behaviour (PLAINSPACE_USE_MOCK === true):
// the ownership split (mine vs unclaimed), search scoping, lookup, claim, and
// space creation. "Mine" depends on the signed-in identity, so each test logs
// in first. The mock space is reset per test (claim mutates it in place).
describe('PlainspaceApiService (mock mode)', () => {
  let service: PlainspaceApiService;
  let accountService: PlainspaceAccountService;

  const mockCfg: PlainspaceCfg = {
    isEnabled: true,
    host: 'https://plainspace.org',
    spaceId: 'space-1',
  };

  beforeEach(() => {
    resetPlainspaceMockData();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PlainspaceApiService, PlainspaceAccountService],
    });
    service = TestBed.inject(PlainspaceApiService);
    accountService = TestBed.inject(PlainspaceAccountService);
    accountService.login('Tester'); // me === ps-me
  });

  afterEach(() => {
    accountService.logout();
    resetPlainspaceMockData();
  });

  it('runs in mock mode for the prototype', () => {
    expect(PLAINSPACE_USE_MOCK).toBe(true);
  });

  it('getMyTasks$ returns only tasks assigned to me', async () => {
    const tasks = await firstValueFrom(service.getMyTasks$(mockCfg));
    expect(tasks.map((t) => t.id)).toEqual(['ps-101']);
  });

  it('getUnclaimedTasks$ returns only unassigned, not-done tasks', async () => {
    const tasks = await firstValueFrom(service.getUnclaimedTasks$(mockCfg));
    expect(tasks.map((t) => t.id).sort()).toEqual(['ps-102', 'ps-105', 'ps-106']);
    expect(tasks.every((t) => t.assigneeId === null && !t.isDone)).toBe(true);
  });

  it('searchIssues$ searches only my tasks', async () => {
    const mine = await firstValueFrom(service.searchIssues$('finalize', mockCfg));
    expect(mine.length).toBe(1);
    expect(mine[0].issueType).toBe('PLAINSPACE');
    // an unclaimed task is not surfaced by search
    const unclaimed = await firstValueFrom(service.searchIssues$('triage', mockCfg));
    expect(unclaimed.length).toBe(0);
  });

  it('claimTask$ assigns an unclaimed task to me', async () => {
    const claimed = await firstValueFrom(service.claimTask$('ps-102', mockCfg));
    expect(claimed?.assigneeId).toBe('ps-me');
    // it now counts as mine and leaves the unclaimed pool
    const mine = await firstValueFrom(service.getMyTasks$(mockCfg));
    expect(mine.map((t) => t.id).sort()).toEqual(['ps-101', 'ps-102']);
    const unclaimed = await firstValueFrom(service.getUnclaimedTasks$(mockCfg));
    expect(unclaimed.map((t) => t.id)).not.toContain('ps-102');
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
