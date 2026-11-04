import {
  isRepairBuiltFromCommittedVersion,
  repairStaleResponse,
} from './file-based-repair-base.util';

describe('file-based REPAIR base (#11483)', () => {
  describe('isRepairBuiltFromCommittedVersion', () => {
    it('accepts a REPAIR built from the committed syncVersion', () => {
      expect(isRepairBuiltFromCommittedVersion(4, 4)).toBe(true);
    });

    it('rejects a REPAIR built before a later download', () => {
      expect(isRepairBuiltFromCommittedVersion(3, 4)).toBe(false);
    });

    it('rejects a REPAIR built from a version this client has not committed', () => {
      expect(isRepairBuiltFromCommittedVersion(5, 4)).toBe(false);
    });

    it('rejects a REPAIR without a base', () => {
      expect(isRepairBuiltFromCommittedVersion(undefined, 4)).toBe(false);
      expect(isRepairBuiltFromCommittedVersion(undefined, undefined)).toBe(false);
    });

    it('treats a target with no committed syncVersion as version 0', () => {
      expect(isRepairBuiltFromCommittedVersion(0, undefined)).toBe(true);
      expect(isRepairBuiltFromCommittedVersion(1, undefined)).toBe(false);
    });
  });

  it('answers REPAIR_STALE, the code the shared rebase path handles', () => {
    expect(repairStaleResponse()).toEqual(
      jasmine.objectContaining({ accepted: false, errorCode: 'REPAIR_STALE' }),
    );
  });
});
