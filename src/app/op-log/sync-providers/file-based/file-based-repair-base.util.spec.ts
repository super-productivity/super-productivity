import {
  isRepairBuiltAtCommittedSeq,
  repairStaleResponse,
} from './file-based-repair-base.util';

describe('file-based REPAIR base (#11483)', () => {
  describe('isRepairBuiltAtCommittedSeq', () => {
    it('accepts a REPAIR built from the committed server seq', () => {
      expect(isRepairBuiltAtCommittedSeq(4, 4)).toBe(true);
    });

    it('rejects a REPAIR built before a later download', () => {
      expect(isRepairBuiltAtCommittedSeq(3, 4)).toBe(false);
    });

    it('rejects a REPAIR built from a version this client has not committed', () => {
      expect(isRepairBuiltAtCommittedSeq(5, 4)).toBe(false);
    });

    it('rejects a REPAIR without a base', () => {
      expect(isRepairBuiltAtCommittedSeq(undefined, 4)).toBe(false);
      expect(isRepairBuiltAtCommittedSeq(undefined, undefined)).toBe(false);
    });

    it('treats a target with no committed server seq as version 0', () => {
      expect(isRepairBuiltAtCommittedSeq(0, undefined)).toBe(true);
      expect(isRepairBuiltAtCommittedSeq(1, undefined)).toBe(false);
    });
  });

  it('answers REPAIR_STALE, the code the shared rebase path handles', () => {
    expect(repairStaleResponse()).toEqual(
      jasmine.objectContaining({ accepted: false, errorCode: 'REPAIR_STALE' }),
    );
  });
});
