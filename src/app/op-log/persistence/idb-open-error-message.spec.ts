import { buildIdbOpenErrorMessage, IdbOpenErrorContext } from './idb-open-error-message';
import { DistChannel } from '../../util/get-app-version-str';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

describe('buildIdbOpenErrorMessage', () => {
  const ctx = (overrides: Partial<IdbOpenErrorContext> = {}): IdbOpenErrorContext => ({
    channel: 'win-nsis',
    appVersion: '18.14.0W',
    ...overrides,
  });

  const versionError = (): IndexedDBOpenError =>
    new IndexedDBOpenError(
      new DOMException(
        'The requested version (7) is less than the existing version (10).',
        'VersionError',
      ),
    );

  describe('downgrade barrier (#9187)', () => {
    // Swept across EVERY channel because this is the actual bug: whichever
    // branch a locked-out user lands in, none of them may repeat the advice
    // that would destroy the intact data. Listed exhaustively rather than
    // sampled — a channel added to DistChannel without recovery text here is
    // precisely the regression this guards.
    const ALL_CHANNELS: DistChannel[] = [
      'win-nsis',
      'win-portable',
      'win-store',
      'mac-dmg',
      'mac-store',
      'linux-appimage',
      'linux-snap',
      'linux-flatpak',
      'linux-native',
      'android-play',
      'android-fdroid',
      'ios',
      'web',
    ];

    it('never repeats the destructive generic advice on any channel', () => {
      ALL_CHANNELS.forEach((channel) => {
        const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

        expect(msg).withContext(channel).not.toContain('storage may need to be cleared');
        expect(msg).withContext(channel).not.toContain('Storage corruption');
        expect(msg).withContext(channel).not.toContain('Low disk space');
        expect(msg).withContext(channel).toContain('Do NOT clear your storage');
        // The running version is what tells the user which copy is stale.
        expect(msg).withContext(channel).toContain('18.14.0W');
        // Every channel must offer a way out that does not destroy data — copy
        // the folder where one exists, and where none does (web/mobile) say
        // plainly that clearing the data is unrecoverable.
        expect(msg)
          .withContext(channel)
          .toMatch(/make a copy of your Super Productivity|no copy to fall back on/);
        // ...and every channel must actually name a way to get the newer build,
        // so no channel can fall through to a bare "What to do:" heading.
        expect(msg)
          .withContext(channel)
          .toMatch(/\n1\. /);
      });
    });

    // The whole point of branching on DistChannel: a managed-store or
    // sandboxed build keeps its data where a website download cannot see it,
    // so pointing these users at super-productivity.com is wrong advice.
    it('never sends store-managed or sandboxed builds to the website download', () => {
      const MANAGED: DistChannel[] = [
        'win-store',
        'mac-store',
        'ios',
        'android-play',
        'android-fdroid',
        'linux-snap',
        'linux-flatpak',
      ];

      MANAGED.forEach((channel) => {
        const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

        expect(msg).withContext(channel).not.toContain('super-productivity.com');
      });
    });

    it('names the right store for each managed channel', () => {
      const expected: [DistChannel, string][] = [
        ['win-store', 'the Microsoft Store'],
        ['mac-store', 'the App Store'],
        ['ios', 'the App Store'],
        ['android-play', 'Google Play'],
        ['android-fdroid', 'F-Droid'],
      ];

      expected.forEach(([channel, storeName]) => {
        const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

        expect(msg).withContext(channel).toContain(`through ${storeName}`);
      });
    });

    // The package ids are asserted in FULL on purpose. A partial match (e.g.
    // just 'flatpak update') passes with a wrong id, and a wrong id makes the
    // single command we hand a locked-out user fail. Sources of truth are the
    // store links in README.md; note they differ from the mac/Capacitor appId
    // `com.super-productivity.app`, which is what a careless grep turns up.
    it('points Snap users at their own update channel', () => {
      const msg = buildIdbOpenErrorMessage(
        versionError(),
        ctx({ channel: 'linux-snap' }),
      );

      expect(msg).toContain('snap refresh superproductivity');
    });

    it('points Flatpak users at flatpak update with the real Flathub id', () => {
      const msg = buildIdbOpenErrorMessage(
        versionError(),
        ctx({ channel: 'linux-flatpak' }),
      );

      expect(msg).toContain('flatpak update com.super_productivity.SuperProductivity');
      expect(msg).not.toContain('com.super-productivity.app');
    });

    it('tells self-installed desktop users to look for a second copy', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx());

      expect(msg).toContain('portable');
      expect(msg).toContain('super-productivity.com');
      expect(msg).not.toContain('snap refresh');
    });

    it('does not offer a data-folder copy where the user cannot reach one', () => {
      (['web', 'ios', 'android-play', 'android-fdroid'] as DistChannel[]).forEach(
        (channel) => {
          const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

          expect(msg).withContext(channel).not.toContain('data folder');
        },
      );
    });

    it('gives browsers the reload hint and mobile the store instead', () => {
      const web = buildIdbOpenErrorMessage(versionError(), ctx({ channel: 'web' }));
      const ios = buildIdbOpenErrorMessage(versionError(), ctx({ channel: 'ios' }));

      expect(web).toContain('Ctrl+Shift+R');
      // Mobile WebViews have no tabs and no Ctrl+Shift+R, so the reload hint
      // must not leak into their branch.
      expect(ios).not.toContain('Ctrl+Shift+R');
    });
  });

  describe('other open failures keep the existing guidance', () => {
    // Asserted in FULL, not by fragments. Extracting this text out of
    // OperationLogHydratorService was required by the 1200-line service cap,
    // and "the wording is unchanged" was the whole safety argument for that
    // move — a fragment match would not have detected a dropped line or a
    // mangled blank line. If this fails, confirm the change to user-facing
    // copy is intentional before updating the expectation.
    it('reproduces the pre-extraction generic message exactly', () => {
      const msg = buildIdbOpenErrorMessage(
        new IndexedDBOpenError(new Error('QuotaExceededError')),
        ctx(),
      );

      expect(msg).toBe(
        'Database Error - Cannot Load Data\n\n' +
          'Super Productivity cannot open its database. This may be caused by:\n\n' +
          '- Low disk space\n' +
          '- Temporary file lock (try closing other tabs)\n' +
          '- Storage corruption\n\n' +
          'If the problem continues after restart, your browser storage may need to be cleared.\n\n' +
          'Technical details: QuotaExceededError\n\n' +
          '(Check browser console for full error details)',
      );
    });

    it('adds Snap-specific recovery steps for backing-store errors', () => {
      const msg = buildIdbOpenErrorMessage(
        new IndexedDBOpenError(new Error('Internal error opening backing store')),
        ctx({ channel: 'linux-snap' }),
      );

      expect(msg).toContain('Recovery steps:');
      expect(msg).toContain('snap set core experimental.refresh-app-awareness=true');
    });
  });
});
