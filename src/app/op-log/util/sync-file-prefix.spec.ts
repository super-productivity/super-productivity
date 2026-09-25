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

    // Stringify each arg individually: a bare join() renders the structured
    // meta as `[object Object]` (hiding a leak into the very object the
    // diagnostic fields live in), while a single JSON.stringify over the whole
    // array escapes the quotes in `rawPayload` so that assertion could never
    // fail. Per-arg keeps string args verbatim and still sees inside the meta.
    const logText = (OpLog.log as jasmine.Spy).calls
      .allArgs()
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
    expect(logText).toContain('inputLength');
    expect(logText).not.toContain('secret task');
    expect(logText).not.toContain(rawPayload);
  });

  // #9627: classification itself is pinned in @sp/sync-core's own spec. What
  // this shim owns is the bridge — the diagnostic is worthless if it never
  // reaches the exportable OpLog history a user actually sends us.
  it('carries the head-shape diagnostic into the OpLog history', () => {
    // Synthetic stand-in for a ciphertext head — same shape, none of a user's
    // bytes. Classification itself is pinned in @sp/sync-core's spec.
    expect(() =>
      extractSyncFileStateFromPrefix('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY'),
    ).toThrowError(InvalidFilePrefixError);

    const [message, meta] = (OpLog.log as jasmine.Spy).calls.mostRecent().args;
    // Also inlined in the message so the line greps as one unit in a console.
    expect(message).toContain('headShape="base64"');
    expect(message).toContain('prefixAt=-1');
    expect(meta).toEqual(jasmine.objectContaining({ headShape: 'base64', prefixAt: -1 }));
  });
});
