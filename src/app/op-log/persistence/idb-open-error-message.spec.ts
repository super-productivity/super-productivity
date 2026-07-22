import { buildIdbOpenErrorMessage, IdbOpenErrorContext } from './idb-open-error-message';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

describe('buildIdbOpenErrorMessage', () => {
  const ctx = (overrides: Partial<IdbOpenErrorContext> = {}): IdbOpenErrorContext => ({
    isElectron: true,
    isFlatpak: false,
    isSnap: false,
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
    it('never repeats the destructive generic advice on any platform', () => {
      const platforms: IdbOpenErrorContext[] = [
        ctx(),
        ctx({ isSnap: true }),
        ctx({ isFlatpak: true }),
        ctx({ isElectron: false }),
      ];

      platforms.forEach((platform) => {
        const msg = buildIdbOpenErrorMessage(versionError(), platform);
        expect(msg).not.toContain('storage may need to be cleared');
        expect(msg).not.toContain('Storage corruption');
        expect(msg).not.toContain('Low disk space');
        expect(msg).toContain('Do NOT clear your storage');
        // The running version is what tells the user which copy is stale.
        expect(msg).toContain('18.14.0');
      });
    });

    it('points Snap users at their own update channel, not the website', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ isSnap: true }));

      expect(msg).toContain('snap refresh super-productivity');
      expect(msg).not.toContain('super-productivity.com');
    });

    it('points Flatpak users at flatpak update', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ isFlatpak: true }));

      expect(msg).toContain('flatpak update');
      expect(msg).not.toContain('super-productivity.com');
    });

    it('tells plain desktop users to look for a second copy', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx());

      expect(msg).toContain('portable');
      expect(msg).toContain('super-productivity.com');
      expect(msg).not.toContain('snap refresh');
    });

    it('qualifies the reload hint so it stays true on mobile', () => {
      const msg = buildIdbOpenErrorMessage(versionError(), ctx({ isElectron: false }));

      // Android/iOS WebViews have no tabs and no Ctrl+Shift+R — the hint must
      // not be stated as an unconditional instruction there.
      expect(msg).toContain('In a web browser:');
      expect(msg).not.toContain('1. Reload the page');
    });
  });

  describe('other open failures keep the existing guidance', () => {
    it('still shows the generic causes and the clear-storage fallback', () => {
      const msg = buildIdbOpenErrorMessage(
        new IndexedDBOpenError(new Error('QuotaExceededError')),
        ctx(),
      );

      expect(msg).toContain('Database Error - Cannot Load Data');
      expect(msg).toContain('- Low disk space');
      expect(msg).toContain('storage may need to be cleared');
      expect(msg).toContain('Technical details: QuotaExceededError');
    });

    it('adds Snap-specific recovery steps for backing-store errors', () => {
      const msg = buildIdbOpenErrorMessage(
        new IndexedDBOpenError(new Error('Internal error opening backing store')),
        ctx({ isSnap: true }),
      );

      expect(msg).toContain('Recovery steps:');
      expect(msg).toContain('snap set core experimental.refresh-app-awareness=true');
    });
  });
});
