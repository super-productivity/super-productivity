import { DistChannel, distChannelSuffix, getAppVersionStr } from './get-app-version-str';
import { environment } from '../../environments/environment';

describe('distChannelSuffix', () => {
  const cases: [DistChannel, string][] = [
    ['win-nsis', 'W'],
    ['win-portable', 'P'],
    ['win-store', 'MS'],
    ['mac-dmg', 'D'],
    ['mac-store', 'MAS'],
    ['linux-appimage', 'AI'],
    ['linux-snap', 'SN'],
    ['linux-flatpak', 'FP'],
    ['linux-native', 'L'],
    ['android-play', 'A'],
    ['android-fdroid', 'AF'],
    ['ios', 'I'],
    ['web', 'WB'],
  ];

  cases.forEach(([channel, suffix]) => {
    it(`maps ${channel} -> "${suffix}"`, () => {
      expect(distChannelSuffix(channel)).toBe(suffix);
    });
  });

  it('maps null/undefined -> "" (no suffix)', () => {
    expect(distChannelSuffix(null)).toBe('');
    expect(distChannelSuffix(undefined)).toBe('');
  });
});

describe('getAppVersionStr', () => {
  // In the Karma/browser env IS_ELECTRON, IS_IOS and IS_ANDROID_WEB_VIEW are
  // all false, so the channel resolves to web -> "WB".
  it('appends the web suffix in a browser context', () => {
    expect(getAppVersionStr()).toBe(`${environment.version}WB`);
  });
});
