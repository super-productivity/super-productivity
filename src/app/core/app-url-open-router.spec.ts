import { ReplaySubject, Subject } from 'rxjs';
import { routeCapacitorAppUrl } from './app-url-open-router';
import { AppUriTaskAction } from '../features/tasks/util/parse-app-uri-task-action';

/**
 * Capacitor delivers a cold-start `appUrlOpen` URL only to the *first*
 * listener registered for the event and then discards the retained argument
 * (`CAPPlugin.m`, `addEventListener` → `sendRetainedArgumentsForEvent`).
 * With one listener per consumer, a launch URL for whichever consumer
 * registered second was silently dropped. These cover the router that
 * replaced those two listeners.
 *
 * The sinks mirror production's types: the task sink replays, because a task
 * action does arrive before Angular exists on a cold launch, so those tests
 * subscribe *after* routing. The OAuth sink is a plain `Subject` (a cold-start
 * callback cannot be completed at all, see `pending-capacitor-oauth-url.ts`),
 * so those tests subscribe first, as its real consumer does at bootstrap.
 */
describe('routeCapacitorAppUrl', () => {
  let taskSink: ReplaySubject<AppUriTaskAction>;
  let oAuthSink: Subject<string>;

  beforeEach(() => {
    taskSink = new ReplaySubject<AppUriTaskAction>(1);
    oAuthSink = new Subject<string>();
  });

  const OAUTH_URLS = [
    'com.super-productivity.app://oauth-callback?code=ABC123',
    'superproductivity://oauth-callback?code=ABC123',
    'com.super-productivity.app://plugin-oauth-callback?code=ABC123',
  ];

  describe('task route family', () => {
    it('should still deliver a task action emitted before anyone subscribed', () => {
      expect(
        routeCapacitorAppUrl(
          'com.super-productivity.app://create-task?title=hello',
          taskSink,
          oAuthSink,
        ),
      ).toBe(true);

      // Subscribing only now is the cold-launch case: Angular, and therefore
      // AppUriTaskActionsService, did not exist when the URL arrived.
      const received: AppUriTaskAction[] = [];
      taskSink.subscribe((a) => received.push(a));

      expect(received.length).toBe(1);
      expect(received[0].type).toBe('add');
      expect(received[0].title).toBe('hello');
    });

    it('should not leak a task action into the OAuth route family', () => {
      let oAuthReceived = false;
      oAuthSink.subscribe(() => (oAuthReceived = true));

      routeCapacitorAppUrl(
        'com.super-productivity.app://create-task?title=hello',
        taskSink,
        oAuthSink,
      );

      expect(oAuthReceived).toBe(false);
    });
  });

  describe('OAuth route family', () => {
    OAUTH_URLS.forEach((url) => {
      it(`should deliver "${url.split('?')[0]}" to the OAuth consumer`, () => {
        const received: string[] = [];
        oAuthSink.subscribe((u) => received.push(u));

        expect(routeCapacitorAppUrl(url, taskSink, oAuthSink)).toBe(false);
        expect(received).toEqual([url]);
      });
    });

    it('should not leak an OAuth callback into the task route family', () => {
      routeCapacitorAppUrl(OAUTH_URLS[0], taskSink, oAuthSink);

      let taskReceived = false;
      taskSink.subscribe(() => (taskReceived = true));

      expect(taskReceived).toBe(false);
    });
  });

  it('should serve both route families from the single listener', () => {
    // The regression: one native listener has to feed both consumers, because
    // a second listener would never see a cold-start URL at all.
    let oAuthReceived: string | undefined;
    oAuthSink.subscribe((u) => (oAuthReceived = u));

    routeCapacitorAppUrl(
      'com.super-productivity.app://create-task?title=hello',
      taskSink,
      oAuthSink,
    );
    routeCapacitorAppUrl(OAUTH_URLS[0], taskSink, oAuthSink);

    let taskReceived: AppUriTaskAction | undefined;
    taskSink.subscribe((a) => (taskReceived = a));

    expect(taskReceived?.title).toBe('hello');
    expect(oAuthReceived).toBe(OAUTH_URLS[0]);
  });

  it('should route an unrecognized URL to the OAuth consumer, which ignores it', () => {
    // Unknown routes go to the OAuth side rather than being dropped here, so
    // there is exactly one owner deciding what is not a callback.
    const received: string[] = [];
    oAuthSink.subscribe((u) => received.push(u));

    expect(
      routeCapacitorAppUrl('superproductivity://toggle-visibility', taskSink, oAuthSink),
    ).toBe(false);
    expect(received).toEqual(['superproductivity://toggle-visibility']);
  });
});
