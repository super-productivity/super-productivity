import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { PlainspaceConnectionStateService } from './plainspace-connection-state.service';

describe('PlainspaceConnectionStateService', () => {
  let state: PlainspaceConnectionStateService;
  const httpError = (status: number): HttpErrorResponse =>
    new HttpErrorResponse({ status });

  beforeEach(() => {
    state = TestBed.inject(PlainspaceConnectionStateService);
  });

  it('marks a provider as rejected on 401', () => {
    state.reportError('p1', httpError(401));
    expect(state.rejectedProviderIds().has('p1')).toBe(true);
  });

  // A 403 comes from a proxy or firewall, not from Plainspace judging the token.
  it('ignores offline, proxy (403), server and non-HTTP errors', () => {
    state.reportError('p1', httpError(0));
    state.reportError('p1', httpError(403));
    state.reportError('p1', httpError(500));
    state.reportError('p1', new Error('boom'));
    expect(state.rejectedProviderIds().size).toBe(0);
  });

  it('keeps a rejected provider marked while offline, clears it on success', () => {
    state.reportError('p1', httpError(401));
    state.reportError('p1', httpError(0));
    expect(state.rejectedProviderIds().has('p1')).toBe(true);
    state.reportSuccess('p1');
    expect(state.rejectedProviderIds().has('p1')).toBe(false);
  });

  it('clears only the given providers', () => {
    state.reportError('p1', httpError(401));
    state.reportError('p2', httpError(401));
    state.clear(['p1']);
    expect([...state.rejectedProviderIds()]).toEqual(['p2']);
  });

  // Review finding: a request made with the old token could answer 401 after
  // a successful reconnect and ask to reconnect again.
  it('ignores a rejection of a token a reconnect replaced', () => {
    state.reportError('p1', httpError(401), 'pat_old');
    state.replaceTokens(['p1'], ['pat_old']);
    expect(state.rejectedProviderIds().has('p1')).toBe(false);

    state.reportError('p1', httpError(401), 'pat_old');
    expect(state.rejectedProviderIds().has('p1')).toBe(false);
    state.reportError('p1', httpError(401), 'pat_new');
    expect(state.rejectedProviderIds().has('p1')).toBe(true);
  });

  // A reconnect leaves a provider of a space the account left on the old
  // token: its rejection must still show.
  it('still shows a rejection of a provider the reconnect skipped', () => {
    state.replaceTokens(['p1'], ['pat_old']);
    state.reportError('p2', httpError(401), 'pat_old');
    expect(state.rejectedProviderIds().has('p2')).toBe(true);
  });

  it('remembers a server too old for titles per provider, and a success keeps it', () => {
    state.reportServerTooOld('p1');
    state.reportSuccess('p1');
    expect(state.isServerTooOld('p1')).toBe(true);
    expect(state.isServerTooOld('p2')).toBe(false);
  });
});
