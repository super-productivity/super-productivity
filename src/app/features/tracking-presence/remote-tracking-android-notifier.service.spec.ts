import {
  REMOTE_STOP_TTL_MS,
  resolvePendingRemoteStop,
} from './remote-tracking-android-notifier.service';

describe('resolvePendingRemoteStop', () => {
  const now = 1_000_000;

  it('applies a fresh stop once the remote session is tracking', () => {
    expect(resolvePendingRemoteStop(now - 1000, now, 'tracking')).toBe('apply');
  });

  it('waits while the remote session is not known yet', () => {
    expect(resolvePendingRemoteStop(now - 1000, now, undefined)).toBe('wait');
  });

  it('drops the stop when the remote session is already stopped', () => {
    expect(resolvePendingRemoteStop(now - 1000, now, 'stopped')).toBe('drop');
  });

  it('drops a stop older than the notification timeout', () => {
    expect(resolvePendingRemoteStop(now - REMOTE_STOP_TTL_MS - 1, now, 'tracking')).toBe(
      'drop',
    );
    expect(resolvePendingRemoteStop(now - REMOTE_STOP_TTL_MS, now, 'tracking')).toBe(
      'apply',
    );
  });
});
