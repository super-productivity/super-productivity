import { parseDownloadedFilePayload } from './electron.effects';

describe('parseDownloadedFilePayload', () => {
  it('reads the download path from the payload-only args ([file], not [event, file])', () => {
    // Regression for the ANY_FILE_DOWNLOADED consumer: after the payload-only
    // IPC listener stripped the Electron event, the file moved from args[1] to
    // args[0]. Reading the old index yielded undefined -> TypeError on every
    // download.
    expect(
      parseDownloadedFilePayload([{ path: '/home/u/Downloads/report.pdf' }]),
    ).toEqual({
      fileName: 'report.pdf',
      dir: '/home/u/Downloads/',
    });
  });

  it('does not match the pre-strip [event, file] shape (file must be at index 0)', () => {
    const eventFirst = [{ sender: {} }, { path: '/home/u/Downloads/report.pdf' }];
    expect(parseDownloadedFilePayload(eventFirst)).toBeNull();
  });

  it('returns null for a missing payload instead of throwing', () => {
    expect(parseDownloadedFilePayload([])).toBeNull();
    expect(parseDownloadedFilePayload(undefined)).toBeNull();
  });

  it('returns null when the payload has no string path', () => {
    expect(parseDownloadedFilePayload([{}])).toBeNull();
    expect(parseDownloadedFilePayload([{ path: 123 }])).toBeNull();
    expect(parseDownloadedFilePayload([null])).toBeNull();
  });
});
