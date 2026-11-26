import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PlainspaceHandoffService } from './plainspace-handoff.service';
import { PlainspaceApiService } from './plainspace-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueSyncStateService } from '../../two-way-sync/issue-sync-state.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { Task } from '../../../tasks/task.model';

describe('PlainspaceHandoffService', () => {
  let service: PlainspaceHandoffService;
  let api: jasmine.SpyObj<PlainspaceApiService>;
  let snack: jasmine.SpyObj<SnackService>;
  let syncState: IssueSyncStateService;

  const cfg = { host: 'https://ps.test', spaceId: 'space-1', token: 'pat_x' };
  const task = {
    id: 't1',
    issueId: 'item-1',
    issueProviderId: 'prov-1',
    issueType: 'PLAINSPACE',
  } as Task;
  const bob = { id: 'm-bob', displayName: 'Bob' };
  const httpError = (status: number): HttpErrorResponse =>
    new HttpErrorResponse({ status });

  beforeEach(() => {
    api = jasmine.createSpyObj('PlainspaceApiService', [
      'getSpaceMembers$',
      'patchTask$',
    ]);
    snack = jasmine.createSpyObj('SnackService', ['open']);
    const issueProviderService = jasmine.createSpyObj('IssueProviderService', [
      'getCfgOnce$',
    ]);
    issueProviderService.getCfgOnce$.and.returnValue(of(cfg));

    TestBed.configureTestingModule({
      providers: [
        PlainspaceHandoffService,
        IssueSyncStateService,
        { provide: PlainspaceApiService, useValue: api },
        { provide: IssueProviderService, useValue: issueProviderService },
        { provide: SnackService, useValue: snack },
      ],
    });
    service = TestBed.inject(PlainspaceHandoffService);
    syncState = TestBed.inject(IssueSyncStateService);
    // Nothing pending by default; the two-way-sync effect answers in the app.
    spyOn(syncState, 'pushPending').and.resolveTo(true);
  });

  describe('getMembers', () => {
    it('returns the members of the task’s space', async () => {
      api.getSpaceMembers$.and.returnValue(of([bob]));
      expect(await service.getMembers(task)).toEqual([bob]);
      expect(api.getSpaceMembers$).toHaveBeenCalledWith(jasmine.objectContaining(cfg));
    });

    it('says the server is too old on a 404', async () => {
      api.getSpaceMembers$.and.returnValue(throwError(() => httpError(404)));
      expect(await service.getMembers(task)).toBeNull();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.SERVER_TOO_OLD,
      });
    });

    it('shows a plain failure when offline', async () => {
      api.getSpaceMembers$.and.returnValue(throwError(() => httpError(0)));
      expect(await service.getMembers(task)).toBeNull();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.FAILED,
      });
    });
  });

  describe('handOff', () => {
    it('assigns the task to a member, then treats it as no longer mine', async () => {
      api.patchTask$.and.returnValue(of({ id: 'item-1', isDone: false }));
      await service.handOff(task, bob);

      expect(api.patchTask$).toHaveBeenCalledWith(
        'item-1',
        { assigneeId: 'm-bob' },
        jasmine.objectContaining(cfg),
      );
      expect(syncState.isMissing('t1')).toBeTrue();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.PLAINSPACE.HANDOFF.ASSIGNED,
        translateParams: { name: 'Bob' },
      });
    });

    it('pushes pending edits before the assignee PATCH', async () => {
      const order: string[] = [];
      (syncState.pushPending as jasmine.Spy).and.callFake(async () => {
        order.push('push');
        return true;
      });
      api.patchTask$.and.callFake(() => {
        order.push('handoff');
        return of({ id: 'item-1', isDone: false });
      });
      await service.handOff(task, bob);

      expect(syncState.pushPending).toHaveBeenCalledWith('t1');
      expect(order).toEqual(['push', 'handoff']);
    });

    it('does not hand off while pending edits cannot be pushed, and says why', async () => {
      (syncState.pushPending as jasmine.Spy).and.resolveTo(false);
      await service.handOff(task, bob);

      expect(api.patchTask$).not.toHaveBeenCalled();
      expect(syncState.isMissing('t1')).toBeFalse();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.UNSYNCED_EDITS,
      });
    });

    it('releases the task to the space with assigneeId null', async () => {
      api.patchTask$.and.returnValue(of({ id: 'item-1', isDone: false }));
      await service.handOff(task, null);

      expect(api.patchTask$).toHaveBeenCalledWith(
        'item-1',
        { assigneeId: null },
        jasmine.anything(),
      );
      expect(syncState.isMissing('t1')).toBeTrue();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.PLAINSPACE.HANDOFF.RELEASED,
      });
    });

    it('says the server is too old on a 422 and keeps the task mine', async () => {
      api.patchTask$.and.returnValue(throwError(() => httpError(422)));
      await service.handOff(task, null);

      expect(syncState.isMissing('t1')).toBeFalse();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.SERVER_TOO_OLD,
      });
    });

    it('marks the task no longer mine when the server says it is not', async () => {
      api.patchTask$.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({ status: 404, error: { error: 'Task not found' } }),
        ),
      );
      await service.handOff(task, bob);

      expect(syncState.isMissing('t1')).toBeTrue();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.NOT_YOURS,
      });
    });

    it('says the member left and keeps the task mine', async () => {
      api.patchTask$.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({ status: 404, error: { error: 'Member not found' } }),
        ),
      );
      await service.handOff(task, bob);

      expect(syncState.isMissing('t1')).toBeFalse();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.MEMBER_LEFT,
      });
    });

    it('says the server is too old on a plain-text 404 from the members endpoint', async () => {
      api.getSpaceMembers$.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: '404 Not Found' })),
      );
      expect(await service.getMembers(task)).toBeNull();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.SERVER_TOO_OLD,
      });
    });

    it('keeps the task mine when the request fails otherwise', async () => {
      api.patchTask$.and.returnValue(throwError(() => httpError(500)));
      await service.handOff(task, bob);

      expect(syncState.isMissing('t1')).toBeFalse();
      expect(snack.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.PLAINSPACE.HANDOFF.FAILED,
      });
    });
  });
});
