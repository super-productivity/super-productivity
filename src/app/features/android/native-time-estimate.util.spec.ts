import { isTimeEstimateNotifiedNatively } from './native-time-estimate.util';

describe('isTimeEstimateNotifiedNatively', () => {
  it('is false outside the Android WebView, so the web app keeps notifying', () => {
    expect(isTimeEstimateNotifiedNatively(false)).toBe(false);
    expect(isTimeEstimateNotifiedNatively(true)).toBe(false);
  });
});
