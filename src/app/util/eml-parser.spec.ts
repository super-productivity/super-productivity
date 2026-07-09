import PostalMime from 'postal-mime';
import { isFileEml, parseEml } from './eml-parser';

const makeFile = (content: string, name: string, type = ''): File =>
  new File([content], name, { type });

// A minimal but well-formed raw email message.
const VALID_EML = [
  'From: Alice Example <alice@example.com>',
  'To: Bob <bob@example.com>',
  'Subject: Hello World',
  '',
  'This is the body text.',
  '',
].join('\n');

// No From header at all.
const NO_FROM_EML = ['To: bob@example.com', 'Subject: No sender', '', 'body', ''].join(
  '\n',
);

// Multiple addresses in the From header.
const MULTI_FROM_EML = [
  'From: Alice <alice@example.com>, Carol <carol@example.com>',
  'Subject: Two senders',
  '',
  'body',
  '',
].join('\n');

// No Subject header.
const NO_SUBJECT_EML = [
  'From: Alice <alice@example.com>',
  'To: bob@example.com',
  '',
  'body',
  '',
].join('\n');

describe('isFileEml', () => {
  it('should return true if file ends with .eml', () => {
    expect(isFileEml(makeFile('', 'mail.eml'))).toBeTrue();
  });

  it('should be case-insensitive about the extension', () => {
    expect(isFileEml(makeFile('', 'MAIL.EML'))).toBeTrue();
  });

  it('should return true if file type is message/rfc822', () => {
    expect(isFileEml(makeFile('', 'mail', 'message/rfc822'))).toBeTrue();
  });

  it('should return false if file ending is not .eml and file type is not message/rfc822', () => {
    expect(isFileEml(makeFile('', 'doc.pdf', 'application/pdf'))).toBeFalse();
    expect(isFileEml(makeFile('', 'notes.txt', 'text/plain'))).toBeFalse();
  });
});

describe('parseEml', () => {
  it('should parse sender and subject from a valid eml file', async () => {
    const data = await parseEml(makeFile(VALID_EML, 'mail.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.from?.name).toBe('Alice Example');
    expect(data.subject).toBe('Hello World');
  });

  it('should leave from undefined when there is no From header', async () => {
    const data = await parseEml(makeFile(NO_FROM_EML, 'mail.eml'));

    expect(data.from).toBeUndefined();
    expect(data.subject).toBe('No sender');
  });

  it('should take the first address when From has several', async () => {
    const data = await parseEml(makeFile(MULTI_FROM_EML, 'mail.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.from?.name).toBe('Alice');
  });

  it('should leave subject undefined when there is no Subject header', async () => {
    const data = await parseEml(makeFile(NO_SUBJECT_EML, 'mail.eml'));

    expect(data.subject).toBeUndefined();
    expect(data.from?.address).toBe('alice@example.com');
  });

  it('should throw if parsing rejects', async () => {
    // NOTE: This test should almost never happen, since postal-mime almost never fails, but its good to have.
    spyOn(PostalMime, 'parse').and.rejectWith(new Error('boom'));

    await expectAsync(parseEml(makeFile('whatever', 'bad.eml'))).toBeRejected();
  });

  it('should throw if the file cannot be read', async () => {
    const file = makeFile('', 'unreadable.eml');
    // postal-mime reads a Blob via arrayBuffer(), so that's the read to fail.
    spyOn(file, 'arrayBuffer').and.rejectWith(new Error('read failed'));

    await expectAsync(parseEml(file)).toBeRejected();
  });
});
