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
    // sampled so that a channel added to DistChannel is a visible diff here,
    // even though the builder's `default` arm means it cannot go untexted.
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
        // Every channel must offer a way out that does not destroy data. This
        // sentence is deliberately NOT forked per channel — it guards the
        // anti-data-loss advice, so a mis-detected channel must not flip it.
        expect(msg).withContext(channel).toContain('makes the loss permanent');
        // ...and every channel must actually name a way to get the newer build,
        // so no channel can fall through to a bare "What to do:" heading.
        expect(msg)
          .withContext(channel)
          .toMatch(/\n1\. /);
      });
    });

    // Snap and Flatpak keep the database inside the package sandbox, so a
    // website download would not even see this data — those two are the only
    // channels where a specific instruction beats the universal one.
    it('sends only Snap and Flatpak down a channel-specific path', () => {
      const specific = ALL_CHANNELS.filter(
        (c) => c === 'linux-snap' || c === 'linux-flatpak',
      );
      const universal = ALL_CHANNELS.filter(
        (c) => c !== 'linux-snap' && c !== 'linux-flatpak',
      );

      // Every other channel gets byte-identical text. This is the property that
      // makes a mis-detected channel harmless: DistChannel's remaining
      // detectors are UA sniffs and the unreliable process.mas/windowsStore
      // flags, so being wrong must not change what the user is told.
      const texts = new Set(
        universal.map((channel) =>
          buildIdbOpenErrorMessage(versionError(), ctx({ channel })),
        ),
      );
      expect(texts.size).toBe(1);

      specific.forEach((channel) => {
        const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

        expect(msg)
          .withContext(channel)
          .not.toBe([...texts][0]);
      });
    });

    // These two commands are the only channel-specific instructions left, so
    // they carry the whole risk of being wrong. Asserted in FULL: a partial
    // match (e.g. just 'flatpak update') passes with a wrong id, and a wrong id
    // makes the single command we hand a locked-out user fail. Sources of truth
    // are the store links in README.md; they differ from the mac/Capacitor
    // appId `com.super-productivity.app`, which is what a careless grep finds.
    //
    // The sudo asymmetry is deliberate and verified against polkit policy:
    // snapd's io.snapcraft.snapd.manage is `auth_admin_keep` (bare command dies
    // with "access denied"), while org.freedesktop.Flatpak.app-update is
    // `allow_active=yes` — adding sudo there would break --user installs.
    it('points Snap users at their own update channel, with sudo', () => {
      const msg = buildIdbOpenErrorMessage(
        versionError(),
        ctx({ channel: 'linux-snap' }),
      );

      expect(msg).toContain('sudo snap refresh superproductivity');
    });

    it('points Flatpak users at flatpak update with the real Flathub id', () => {
      const msg = buildIdbOpenErrorMessage(
        versionError(),
        ctx({ channel: 'linux-flatpak' }),
      );

      expect(msg).toContain('flatpak update com.super_productivity.SuperProductivity');
      expect(msg).not.toContain('com.super-productivity.app');
      expect(msg).not.toContain('sudo flatpak');
    });

    // The line that actually resolved #9187 (a stale desktop shortcut). It now
    // reaches every channel rather than only the self-installed desktop ones,
    // because the detector that used to gate it is not reliable enough to
    // withhold the most useful sentence in the message.
    it('offers the second-copy diagnosis on every channel', () => {
      ALL_CHANNELS.filter((c) => c !== 'linux-snap' && c !== 'linux-flatpak').forEach(
        (channel) => {
          const msg = buildIdbOpenErrorMessage(versionError(), ctx({ channel }));

          expect(msg).withContext(channel).toContain('second, older copy');
          expect(msg).withContext(channel).toContain('portable executable');
        },
      );
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
