import { isFileEml } from './is-file-eml';

const makeFile = (name: string, type = ''): File => new File([], name, { type });

describe('isFileEml', () => {
  it('should return true if file ends with .eml', () => {
    expect(isFileEml(makeFile('mail.eml'))).toBeTrue();
  });

  it('should be case-insensitive about the extension', () => {
    expect(isFileEml(makeFile('MAIL.EML'))).toBeTrue();
  });

  it('should return true if file type is message/rfc822', () => {
    expect(isFileEml(makeFile('mail', 'message/rfc822'))).toBeTrue();
  });

  it('should return false if file ending is not .eml and file type is not message/rfc822', () => {
    expect(isFileEml(makeFile('doc.pdf', 'application/pdf'))).toBeFalse();
    expect(isFileEml(makeFile('notes.txt', 'text/plain'))).toBeFalse();
  });
});
