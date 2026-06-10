import { OpLog } from '../../core/log';
import { InvalidFilePrefixError } from '../core/errors/sync-errors';
import { extractSyncFileStateFromPrefix } from './sync-file-prefix';

describe('sync-file-prefix app shim', () => {
  beforeEach(() => {
    spyOn(OpLog, 'log').and.stub();
  });

  it('throws InvalidFilePrefixError without logging raw sync payload content', () => {
    const rawPayload = '{"task":{"entities":{"task1":{"title":"secret task"}}}}';

    expect(() => extractSyncFileStateFromPrefix(rawPayload)).toThrowError(
      InvalidFilePrefixError,
    );

    const logText = (OpLog.log as jasmine.Spy).calls.allArgs().flat().join('\n');
    expect(logText).toContain('inputLength');
    expect(logText).not.toContain('secret task');
    expect(logText).not.toContain(rawPayload);
  });
});
