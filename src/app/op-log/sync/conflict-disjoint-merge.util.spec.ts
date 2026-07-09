import {
  buildMergedFieldDiffs,
  MergeSideMeta,
  noiseTiebreakSide,
} from './conflict-disjoint-merge.util';

describe('conflict-disjoint-merge.util', () => {
  describe('noiseTiebreakSide', () => {
    it('picks the greater-timestamp side (local newer)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 2000, clientId: 'A' },
          { timestamp: 1000, clientId: 'Z' },
        ),
      ).toBe('local');
    });

    it('picks the greater-timestamp side (remote newer)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'Z' },
          { timestamp: 2000, clientId: 'A' },
        ),
      ).toBe('remote');
    });

    // The equal-timestamp branch: falls back to the greater clientId. This is the
    // cross-client determinism guarantee — without it two clients could pick
    // different noise values and diverge.
    it('breaks an equal-timestamp tie by the greater clientId (local wins)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'B' },
          { timestamp: 1000, clientId: 'A' },
        ),
      ).toBe('local');
    });

    it('breaks an equal-timestamp tie by the greater clientId (remote wins)', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'A' },
          { timestamp: 1000, clientId: 'B' },
        ),
      ).toBe('remote');
    });

    it('is fully symmetric on equal timestamps: both clients pick the SAME physical side', () => {
      // X and Y differ only by clientId. Whichever side X is passed as, the result
      // must always point at the SAME side (the greater clientId, Y here).
      const x: MergeSideMeta = { timestamp: 1000, clientId: 'A' };
      const y: MergeSideMeta = { timestamp: 1000, clientId: 'B' };
      // Client 1 sees X local / Y remote → picks remote (= Y).
      expect(noiseTiebreakSide(x, y)).toBe('remote');
      // Client 2 sees Y local / X remote → picks local (= Y).
      expect(noiseTiebreakSide(y, x)).toBe('local');
    });

    it('defaults to local when both identity components are equal', () => {
      expect(
        noiseTiebreakSide(
          { timestamp: 1000, clientId: 'A' },
          { timestamp: 1000, clientId: 'A' },
        ),
      ).toBe('local');
    });
  });

  describe('buildMergedFieldDiffs', () => {
    const localMeta: MergeSideMeta = { timestamp: 1000, clientId: 'A' };
    const remoteMeta: MergeSideMeta = { timestamp: 2000, clientId: 'B' };

    it('captures each side verbatim and attributes disjoint real fields to their side', () => {
      const diffs = buildMergedFieldDiffs(
        { title: 'Local' },
        { notes: 'Remote' },
        localMeta,
        remoteMeta,
      );

      expect(diffs).toContain({
        field: 'title',
        localVal: 'Local',
        remoteVal: undefined,
        pickedSide: 'local',
      });
      expect(diffs).toContain({
        field: 'notes',
        localVal: undefined,
        remoteVal: 'Remote',
        pickedSide: 'remote',
      });
      expect(diffs.length).toBe(2);
    });

    it('resolves a field changed on BOTH sides (only noise can be) via the timestamp tiebreak', () => {
      const diffs = buildMergedFieldDiffs(
        { modified: 1111 },
        { modified: 2222 },
        localMeta, // ts 1000
        remoteMeta, // ts 2000 → newer wins
      );

      expect(diffs.length).toBe(1);
      expect(diffs[0]).toEqual({
        field: 'modified',
        localVal: 1111,
        remoteVal: 2222,
        pickedSide: 'remote',
      });
    });

    it('resolves a both-sides field by clientId when timestamps are equal', () => {
      const diffs = buildMergedFieldDiffs(
        { modified: 1111 },
        { modified: 2222 },
        { timestamp: 1000, clientId: 'B' }, // greater clientId → local wins
        { timestamp: 1000, clientId: 'A' },
      );

      expect(diffs[0].pickedSide).toBe('local');
    });

    it('returns an empty array when neither side changed anything', () => {
      expect(buildMergedFieldDiffs({}, {}, localMeta, remoteMeta)).toEqual([]);
    });
  });
});
