import { parseEml } from './eml-parser';

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

describe('parseEml', () => {
  it('should parse sender and subject from a valid eml file', async () => {
    const data = await parseEml(makeFile(VALID_EML, 'mail.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.from?.name).toBe('Alice Example');
    expect(data.subject).toBe('Hello World');
    expect(data.text).toBe('This is the body text.\n');
  });

  it('should handle CRLF line endings and folded headers', async () => {
    const foldedEml = [
      'From: Alice <alice@example.com>',
      'Subject: Hello',
      ' World',
      '',
      'body',
      '',
    ].join('\r\n');

    const data = await parseEml(makeFile(foldedEml, 'mail.eml'));

    expect(data.subject).toBe('Hello World');
    expect(data.text).toBe('body\n');
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

  it('should reject a file without a header/body separator', async () => {
    await expectAsync(parseEml(makeFile('whatever', 'bad.eml'))).toBeRejected();
  });

  it('should throw if the file cannot be read', async () => {
    const file = makeFile('', 'unreadable.eml');
    spyOn(file, 'text').and.rejectWith(new Error('read failed'));

    await expectAsync(parseEml(file)).toBeRejected();
  });

  it('should omit multipart bodies instead of trying to parse MIME parts', async () => {
    const multipartEml = [
      'From: Alice <alice@example.com>',
      'Subject: Multipart',
      'Content-Type: multipart/alternative; boundary="example"',
      '',
      '--example',
      'Content-Type: text/plain',
      '',
      'plain body',
      '--example--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(multipartEml, 'multipart.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.subject).toBe('Multipart');
    expect(data.text).toBeUndefined();
  });

  it('should omit transfer-encoded bodies instead of returning encoded content', async () => {
    const encodedEml = [
      'From: Alice <alice@example.com>',
      'Subject: Encoded',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      'c2VjcmV0IGJvZHk=',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(encodedEml, 'encoded.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.subject).toBe('Encoded');
    expect(data.text).toBeUndefined();
  });

  it('should omit HTML bodies while preserving sender and subject', async () => {
    const htmlEml = [
      'From: Alice <alice@example.com>',
      'Subject: HTML',
      'Content-Type: text/html',
      '',
      '<p>HTML body</p>',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(htmlEml, 'html.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.subject).toBe('HTML');
    expect(data.text).toBeUndefined();
  });

  it('should omit quoted-printable bodies while preserving sender and subject', async () => {
    const quotedPrintableEml = [
      'From: Alice <alice@example.com>',
      'Subject: Quoted printable',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'encoded=20body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(quotedPrintableEml, 'quoted-printable.eml'));

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.subject).toBe('Quoted printable');
    expect(data.text).toBeUndefined();
  });

  it('should omit bodies with a declared unsupported charset', async () => {
    const file = new File(
      [
        [
          'From: Alice <alice@example.com>',
          'Subject: Windows charset',
          'Content-Type: text/plain; charset=windows-1252',
          '',
          '',
        ].join('\r\n'),
        new Uint8Array([0xe9]),
      ],
      'windows-1252.eml',
    );

    const data = await parseEml(file);

    expect(data.from?.address).toBe('alice@example.com');
    expect(data.subject).toBe('Windows charset');
    expect(data.text).toBeUndefined();
  });

  it('should keep an explicitly UTF-8 plain-text body', async () => {
    const utf8Eml = [
      'From: Alice <alice@example.com>',
      'Subject: UTF-8',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Grüße',
      '',
    ].join('\r\n');

    const data = await parseEml(makeFile(utf8Eml, 'utf8.eml'));

    expect(data.text).toBe('Grüße\n');
  });

  it('should keep an explicitly US-ASCII plain-text body', async () => {
    const asciiEml = [
      'From: Alice <alice@example.com>',
      'Subject: ASCII',
      'Content-Type: text/plain; charset=us-ascii',
      '',
      'ASCII body',
      '',
    ].join('\r\n');

    const data = await parseEml(makeFile(asciiEml, 'ascii.eml'));

    expect(data.text).toBe('ASCII body\n');
  });

  it('should only treat the exact text/plain media type as plain text', async () => {
    const nonPlainTextEml = [
      'From: Alice <alice@example.com>',
      'Subject: Other media type',
      'Content-Type: text/plain-script',
      '',
      'not plain text',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(nonPlainTextEml, 'other.eml'));

    expect(data.text).toBeUndefined();
  });

  it('should decode a Q-encoded (RFC 2047) subject', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=',
      '',
      'body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'q.eml'));

    expect(data.subject).toBe('Grüße');
  });

  it('should decode a B-encoded (RFC 2047) subject', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: =?UTF-8?B?5LiW55WM?=',
      '',
      'body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'b.eml'));

    expect(data.subject).toBe('世界');
  });

  it('should join adjacent encoded-words and decode encoded-word display names', async () => {
    const eml = [
      'From: =?UTF-8?B?R3LDvMOfZQ==?= <alice@example.com>',
      'Subject: =?UTF-8?Q?Hello?= =?UTF-8?Q?_World?=',
      '',
      'body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'adjacent.eml'));

    expect(data.from?.name).toBe('Grüße');
    expect(data.subject).toBe('Hello World');
  });

  it('should leave encoded-words with an unsupported charset verbatim', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: =?ISO-8859-1?Q?caf=E9?=',
      '',
      'body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'iso.eml'));

    expect(data.subject).toBe('=?ISO-8859-1?Q?caf=E9?=');
  });

  it('should not be fooled by a charset inside another quoted parameter', async () => {
    const file = new File(
      [
        [
          'From: Alice <alice@example.com>',
          'Subject: Quoted param',
          'Content-Type: text/plain; name="x; charset=utf-8; y"; charset=windows-1252',
          '',
          '',
        ].join('\r\n'),
        new Uint8Array([0xe9]),
      ],
      'quoted-param.eml',
    );

    const data = await parseEml(file);

    expect(data.text).toBeUndefined();
  });

  it('should ignore header comments on Content-Type and Content-Transfer-Encoding', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: Comments',
      'Content-Type: text/plain (the plain one); charset=utf-8',
      'Content-Transfer-Encoding: 7bit (identity)',
      '',
      'kept body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'comments.eml'));

    expect(data.text).toBe('kept body\n');
  });
});
