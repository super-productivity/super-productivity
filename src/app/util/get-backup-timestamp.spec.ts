import { getBackupTimestamp } from './get-backup-timestamp';

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
