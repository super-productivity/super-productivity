import {
  getBackupTimestamp,
  isAutoBackupFilename,
} from '../../../electron/shared-with-frontend/get-backup-timestamp';

describe('getBackupTimestamp', () => {
  beforeEach(() => {
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should generate timestamp in correct format YYYY-MM-DD_HHmmss', () => {
    const timestamp = getBackupTimestamp();

    // Check format with regex: YYYY-MM-DD_HHmmss
    const formatRegex = /^\d{4}-\d{2}-\d{2}_\d{6}$/;
    expect(timestamp).toMatch(formatRegex);
  });

  it('should generate correct timestamp for known date', () => {
    jasmine.clock().mockDate(new Date('2025-04-05T14:30:22'));

    const timestamp = getBackupTimestamp();

    expect(timestamp).toBe('2025-04-05_143022');
  });

  it('should pad all components with zeros', () => {
    jasmine.clock().mockDate(new Date('2025-01-05T09:05:09'));

    const timestamp = getBackupTimestamp();

    expect(timestamp).toBe('2025-01-05_090509');
  });
});

// This predicate is what keeps automatic-backup cleanup away from the user's
// own files in a picked backup folder, and it is the last check before
// BACKUP_LOAD_DATA reads a renderer-supplied path, so its boundaries are worth
// pinning directly rather than only through the electron backup tests.
describe('isAutoBackupFilename', () => {
  it('should accept what getBackupTimestamp produces', () => {
    expect(isAutoBackupFilename(`${getBackupTimestamp()}.json`)).toBe(true);
    expect(isAutoBackupFilename('2026-07-28_120000.json')).toBe(true);
  });

  it('should reject other files that live in a backup folder', () => {
    expect(isAutoBackupFilename('family-budget.json')).toBe(false);
    expect(isAutoBackupFilename('holiday-photo.png')).toBe(false);
    expect(isAutoBackupFilename('.DS_Store')).toBe(false);
    expect(isAutoBackupFilename('')).toBe(false);
  });

  it('should reject near misses of the timestamp shape', () => {
    expect(isAutoBackupFilename('2026-7-28_120000.json')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28_12000.json')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28_1200000.json')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28-120000.json')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28_120000.JSON')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28_120000.json.bak')).toBe(false);
  });

  it('should reject padding around an otherwise valid name', () => {
    expect(isAutoBackupFilename(' 2026-07-28_120000.json')).toBe(false);
    expect(isAutoBackupFilename('old-2026-07-28_120000.json')).toBe(false);
    expect(isAutoBackupFilename('2026-07-28_120000.json ')).toBe(false);
    // JS `$` is strict without the m flag, unlike flavours where it also
    // matches before a trailing newline. Pinned so a later `m` cannot make a
    // crafted name pass.
    expect(isAutoBackupFilename('2026-07-28_120000.json\n')).toBe(false);
  });
});
