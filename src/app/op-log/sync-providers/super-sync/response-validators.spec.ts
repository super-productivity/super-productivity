import {
  validateOpUploadResponse,
  validateOpDownloadResponse,
  validateSnapshotUploadResponse,
  validateRestorePointsResponse,
  validateRestoreSnapshotResponse,
  validateDeleteAllDataResponse,
} from './response-validators';

describe('response-validators', () => {
  describe('validateOpUploadResponse', () => {
    it('should accept valid response', () => {
      const response = {
        results: [{ accepted: true, opId: 'op1' }],
        latestSeq: 100,
      };
      expect(() => validateOpUploadResponse(response)).not.toThrow();
    });

    it('should accept response with optional newOps', () => {
      const response = {
        results: [],
        latestSeq: 50,
        newOps: [],
        hasMorePiggyback: true,
      };
      expect(() => validateOpUploadResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateOpUploadResponse(null)).toThrow();
      expect(() => validateOpUploadResponse('string')).toThrow();
      expect(() => validateOpUploadResponse([])).toThrow();
    });

    it('should throw if results is not an array', () => {
      expect(() =>
        validateOpUploadResponse({ results: 'not array', latestSeq: 1 }),
      ).toThrow();
    });

    it('should throw if latestSeq is not a number', () => {
      expect(() => validateOpUploadResponse({ results: [], latestSeq: '1' })).toThrow();
    });

    it('should throw if newOps is present but not an array', () => {
      expect(() =>
        validateOpUploadResponse({ results: [], latestSeq: 1, newOps: 'invalid' }),
      ).toThrow();
    });

    it('should throw if hasMorePiggyback is present but not a boolean', () => {
      expect(() =>
        validateOpUploadResponse({
          results: [],
          latestSeq: 1,
          hasMorePiggyback: 'true',
        }),
      ).toThrow();
    });

    it('should accept response with hasMorePiggyback as boolean', () => {
      const response = {
        results: [],
        latestSeq: 50,
        hasMorePiggyback: false,
      };
      expect(() => validateOpUploadResponse(response)).not.toThrow();
    });
  });

  describe('validateOpDownloadResponse', () => {
    it('should accept valid response', () => {
      const response = {
        ops: [],
        hasMore: false,
        latestSeq: 200,
      };
      expect(() => validateOpDownloadResponse(response)).not.toThrow();
    });

    it('should accept response with optional fields', () => {
      const response = {
        ops: [],
        hasMore: true,
        latestSeq: 150,
        gapDetected: false,
        snapshotVectorClock: { client1: 10 },
        serverTime: 1234567890,
      };
      expect(() => validateOpDownloadResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateOpDownloadResponse(undefined)).toThrow();
    });

    it('should throw if ops is not an array', () => {
      expect(() =>
        validateOpDownloadResponse({ ops: {}, hasMore: false, latestSeq: 1 }),
      ).toThrow();
    });

    it('should throw if hasMore is not a boolean', () => {
      expect(() =>
        validateOpDownloadResponse({ ops: [], hasMore: 'yes', latestSeq: 1 }),
      ).toThrow();
    });

    it('should throw if latestSeq is not a number', () => {
      expect(() =>
        validateOpDownloadResponse({ ops: [], hasMore: false, latestSeq: null }),
      ).toThrow();
    });

    it('should throw if snapshotVectorClock is present but not an object', () => {
      expect(() =>
        validateOpDownloadResponse({
          ops: [],
          hasMore: false,
          latestSeq: 1,
          snapshotVectorClock: [],
        }),
      ).toThrow();
    });

    it('should throw if gapDetected is present but not a boolean', () => {
      expect(() =>
        validateOpDownloadResponse({
          ops: [],
          hasMore: false,
          latestSeq: 1,
          gapDetected: 'yes',
        }),
      ).toThrow();
    });

    it('should throw if serverTime is present but not a number', () => {
      expect(() =>
        validateOpDownloadResponse({
          ops: [],
          hasMore: false,
          latestSeq: 1,
          serverTime: '1234567890',
        }),
      ).toThrow();
    });
  });

  describe('validateSnapshotUploadResponse', () => {
    it('should accept valid response', () => {
      const response = { accepted: true, serverSeq: 300 };
      expect(() => validateSnapshotUploadResponse(response)).not.toThrow();
    });

    it('should accept response with error', () => {
      const response = { accepted: false, error: 'Some error' };
      expect(() => validateSnapshotUploadResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateSnapshotUploadResponse(123)).toThrow();
    });

    it('should throw if accepted is not a boolean', () => {
      expect(() => validateSnapshotUploadResponse({ accepted: 'true' })).toThrow();
    });

    it('should throw if serverSeq is present but not a number', () => {
      expect(() =>
        validateSnapshotUploadResponse({ accepted: true, serverSeq: 'abc' }),
      ).toThrow();
    });

    it('should throw if error is present but not a string', () => {
      expect(() =>
        validateSnapshotUploadResponse({ accepted: false, error: 123 }),
      ).toThrow();
    });
  });

  describe('validateRestorePointsResponse', () => {
    it('should accept valid response', () => {
      const response = { restorePoints: [] };
      expect(() => validateRestorePointsResponse(response)).not.toThrow();
    });

    it('should accept response with restore points', () => {
      const response = {
        restorePoints: [{ serverSeq: 100, type: 'SYNC_IMPORT', createdAt: '2024-01-01' }],
      };
      expect(() => validateRestorePointsResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateRestorePointsResponse([])).toThrow();
    });

    it('should throw if restorePoints is not an array', () => {
      expect(() => validateRestorePointsResponse({ restorePoints: {} })).toThrow();
    });
  });

  describe('validateRestoreSnapshotResponse', () => {
    it('should accept valid response', () => {
      const response = {
        serverSeq: 150,
        state: { tasks: [] },
        generatedAt: 1234567890,
      };
      expect(() => validateRestoreSnapshotResponse(response)).not.toThrow();
    });

    it('should accept response with null state', () => {
      const response = { serverSeq: 100, state: null, generatedAt: 1234567890 };
      expect(() => validateRestoreSnapshotResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateRestoreSnapshotResponse(null)).toThrow();
    });

    it('should throw if serverSeq is not a number', () => {
      expect(() =>
        validateRestoreSnapshotResponse({ serverSeq: '100', generatedAt: 123 }),
      ).toThrow();
    });

    it('should throw if generatedAt is not a number', () => {
      expect(() =>
        validateRestoreSnapshotResponse({ serverSeq: 100, generatedAt: '123' }),
      ).toThrow();
    });
  });

  describe('validateDeleteAllDataResponse', () => {
    it('should accept valid response', () => {
      const response = { success: true };
      expect(() => validateDeleteAllDataResponse(response)).not.toThrow();
    });

    it('should accept response with success false', () => {
      const response = { success: false };
      expect(() => validateDeleteAllDataResponse(response)).not.toThrow();
    });

    it('should throw if not an object', () => {
      expect(() => validateDeleteAllDataResponse('success')).toThrow();
    });

    it('should throw if success is not a boolean', () => {
      expect(() => validateDeleteAllDataResponse({ success: 1 })).toThrow();
    });
  });
});
