import { fakeAsync, tick } from '@angular/core/testing';
import { IssueProvider } from '../issue.model';
import { getRefreshOnLook$, REFRESH_ON_LOOK_THROTTLE_MS } from './refresh-on-look';

describe('getRefreshOnLook$', () => {
  const provider = (issueProviderKey: string): IssueProvider =>
    ({ id: 'p1', issueProviderKey }) as IssueProvider;

  it('polls Plainspace when the window gets focus, at most once a minute', fakeAsync(() => {
    let count = 0;
    const sub = getRefreshOnLook$(provider('PLAINSPACE')).subscribe(() => count++);

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    expect(count).toBe(1);

    tick(REFRESH_ON_LOOK_THROTTLE_MS);
    window.dispatchEvent(new Event('focus'));
    expect(count).toBe(2);

    sub.unsubscribe();
    tick(REFRESH_ON_LOOK_THROTTLE_MS);
  }));

  it('adds nothing for other providers', fakeAsync(() => {
    let count = 0;
    const sub = getRefreshOnLook$(provider('GITHUB')).subscribe(() => count++);
    window.dispatchEvent(new Event('focus'));
    expect(count).toBe(0);
    sub.unsubscribe();
  }));
});
