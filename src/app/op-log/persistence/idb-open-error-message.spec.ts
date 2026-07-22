import {
  buildIdbOpenErrorMessage,
  IdbOpenErrorContext,
  IdbOpenPlatform,
} from './idb-open-error-message';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

describe('buildIdbOpenErrorMessage', () => {
  const ctx = (overrides: Partial<IdbOpenErrorContext> = {}): IdbOpenErrorContext => ({
    platform: 'electron',
    appVersion: '18.14.0',
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
    // Swept across every platform because this is the actual bug: whichever
    // branch a locked-out user lands in, none of them may repeat the advice
    // that would destroy the intact data.
    const ALL_PLATFORMS: IdbOpenPlatform[] = ['electron', 'snap', 'flatpak', 'web'];

    it('never repeats the destructive generic advice on any platform', () => {
      ALL_PLATFORMS.forEach((platform) => {
        const msg = buildIdbOpenErrorMessage(versionError(), ctx({ platform }));

        expect(msg).withContext(platform).not.toContain('storage may need to be cleared');
        expect(msg).withContext(platform).not.toContain('Storage corruption');
        expect(msg).withContext(platform).not.toContain('Low disk space');
        expect(msg).withContext(platform).toContain('Do NOT clear your storage');
        // The running version is what tells the user which copy is stale.
        expect(msg).withContext(platform).toContain('18.14.0');
        // Every platform must offer a way out that does not destroy data —
        // copy the folder on desktop, and on web (no folder to copy) at least
        // say plainly that clearing site data is unrecoverable.
        expect(msg)
          .withContext(platform)
          .toMatch(/make a copy of your Super Productivity|no copy to fall back on/);
      });
    });

    // The package ids are asserted in FULL on purpose. A partial match (e.g.
    // just 'flatpak update') passes with a wrong id, and a wrong id makes the
    // single command we hand a locked-out user fail. Sources of truth are the
    // store links in README.md; note they differ from the mac/Capacitor appId
    // `com.super-productivity.app`, which is what a careless grep turns up.
    it('points Snap users at their own update channel, not the website', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ platform: 'snap' }));

      expect(msg).toContain('snap refresh superproductivity');
      expect(msg).not.toContain('super-productivity.com');
    });

    it('points Flatpak users at flatpak update with the real Flathub id', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ platform: 'flatpak' }));

      expect(msg).toContain('flatpak update com.super_productivity.SuperProductivity');
      expect(msg).not.toContain('com.super-productivity.app');
      expect(msg).not.toContain('super-productivity.com');
    });

    it('tells plain desktop users to look for a second copy', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx());

      expect(msg).toContain('portable');
      expect(msg).toContain('super-productivity.com');
      expect(msg).not.toContain('snap refresh');
    });

    it('qualifies the reload hint so it stays true on mobile', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ platform: 'web' }));

      // Android/iOS WebViews have no tabs and no Ctrl+Shift+R — the hint must
      // be qualified, not stated as an unconditional instruction.
      expect(msg).toContain('In a web browser:');
      // ...and there is no data folder to copy in a browser or WebView, so the
      // desktop escape hatch must not be handed to them as an instruction.
      expect(msg).not.toContain('data folder');
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
        ctx({ platform: 'snap' }),
      );

      expect(msg).toContain('Recovery steps:');
      expect(msg).toContain('snap set core experimental.refresh-app-awareness=true');
    });
  });
});
