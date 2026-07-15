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

  it('should extract the text/plain part from a multipart/alternative body', async () => {
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
    expect(data.text).toBe('plain body');
  });

  it('should skip the HTML sibling and use the text/plain part in a multipart/alternative body (Outlook-style)', async () => {
    const outlookLikeEml = [
      'From: Alice <alice@example.com>',
      'Subject: Alternative',
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'plain body via =E2=9C=93 quoted-printable',
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>html body</p>',
      '--alt--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(outlookLikeEml, 'outlook.eml'));

    expect(data.text).toBe('plain body via ✓ quoted-printable');
  });

  it('should find the text/plain leaf inside a nested multipart/mixed > multipart/alternative structure (attachment scenario)', async () => {
    const nestedEml = [
      'From: Alice <alice@example.com>',
      'Subject: Nested',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain',
      '',
      'nested plain body',
      '--alt',
      'Content-Type: text/html',
      '',
      '<p>nested html body</p>',
      '--alt--',
      '--mixed',
      'Content-Type: application/pdf',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(nestedEml, 'nested.eml'));

    expect(data.text).toBe('nested plain body');
  });

  it('should return undefined when a multipart body has no supported text/plain part', async () => {
    const htmlOnlyMultipartEml = [
      'From: Alice <alice@example.com>',
      'Subject: HTML only',
      'Content-Type: multipart/alternative; boundary="example"',
      '',
      '--example',
      'Content-Type: text/html',
      '',
      '<p>only html</p>',
      '--example--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(htmlOnlyMultipartEml, 'html-only.eml'));

    expect(data.text).toBeUndefined();
  });

  it('should not import a text/plain attachment as the note when the real body is HTML', async () => {
    const htmlWithTextAttachmentEml = [
      'From: Alice <alice@example.com>',
      'Subject: HTML with attachment',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/html',
      '',
      '<p>the real body</p>',
      '--mixed',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename="notes.txt"',
      '',
      'ATTACHMENT',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(
      makeFile(htmlWithTextAttachmentEml, 'html-with-attachment.eml'),
    );

    expect(data.text).toBeUndefined();
  });

  it('should skip a text/plain attachment that precedes the real plain-text body', async () => {
    const attachmentFirstEml = [
      'From: Alice <alice@example.com>',
      'Subject: Attachment first',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/plain',
      'Content-Disposition: attachment; filename="notes.txt"',
      '',
      'ATTACHMENT',
      '--mixed',
      'Content-Type: text/plain',
      '',
      'REAL BODY',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(attachmentFirstEml, 'attachment-first.eml'));

    expect(data.text).toBe('REAL BODY');
  });

  it('should skip an entire multipart subtree marked as an attachment, not just leaf parts', async () => {
    const attachedMultipartEml = [
      'From: Alice <alice@example.com>',
      'Subject: Attached multipart',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: multipart/alternative; boundary="alt"',
      'Content-Disposition: attachment; filename="attached-message.eml"',
      '',
      '--alt',
      'Content-Type: text/plain',
      '',
      'ATTACHED SUBTREE BODY',
      '--alt--',
      '--mixed',
      'Content-Type: text/plain',
      '',
      'REAL BODY',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(attachedMultipartEml, 'attached-multipart.eml'));

    expect(data.text).toBe('REAL BODY');
  });

  it('should skip a legacy Content-Type name= attachment that has no Content-Disposition at all', async () => {
    const legacyNameAttachmentEml = [
      'From: Alice <alice@example.com>',
      'Subject: Legacy name attachment',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/html',
      '',
      '<p>the real body</p>',
      '--mixed',
      'Content-Type: text/plain; name="notes.txt"',
      '',
      'PRIVATE ATTACHMENT',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(
      makeFile(legacyNameAttachmentEml, 'legacy-name-attachment.eml'),
    );

    expect(data.text).toBeUndefined();
  });

  it('should treat an unrecognized (non-inline) disposition type as an attachment', async () => {
    const unknownDispositionEml = [
      'From: Alice <alice@example.com>',
      'Subject: Unknown disposition',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/html',
      '',
      '<p>the real body</p>',
      '--mixed',
      'Content-Type: text/plain',
      'Content-Disposition: x-download; filename="notes.txt"',
      '',
      'PRIVATE ATTACHMENT',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(
      makeFile(unknownDispositionEml, 'unknown-disposition.eml'),
    );

    expect(data.text).toBeUndefined();
  });

  it('should keep a part with an explicit inline disposition despite a legacy name= parameter', async () => {
    const inlineWithNameEml = [
      'From: Alice <alice@example.com>',
      'Subject: Inline with name',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: inline',
      '',
      'inline body',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(inlineWithNameEml, 'inline-with-name.eml'));

    expect(data.text).toBe('inline body\n');
  });

  it('should skip an attachment identified only by a continued RFC 2231 name*0/name*1 parameter', async () => {
    const continuedNameAttachmentEml = [
      'From: Alice <alice@example.com>',
      'Subject: Continued name attachment',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/html',
      '',
      '<p>the real body</p>',
      '--mixed',
      'Content-Type: text/plain; name*0="notes"; name*1=".txt"',
      '',
      'PRIVATE ATTACHMENT',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(
      makeFile(continuedNameAttachmentEml, 'continued-name-attachment.eml'),
    );

    expect(data.text).toBeUndefined();
  });

  it('should skip an attachment whose type-less disposition carries only an RFC 2231 continued filename', async () => {
    const continuedFilenameAttachmentEml = [
      'From: Alice <alice@example.com>',
      'Subject: Continued filename attachment',
      'Content-Type: multipart/mixed; boundary="mixed"',
      '',
      '--mixed',
      'Content-Type: text/html',
      '',
      '<p>the real body</p>',
      '--mixed',
      'Content-Type: text/plain',
      'Content-Disposition: ; filename*0="secret"; filename*1=".txt"',
      '',
      'PRIVATE ATTACHMENT',
      '--mixed--',
      '',
    ].join('\n');

    const data = await parseEml(
      makeFile(continuedFilenameAttachmentEml, 'continued-filename-attachment.eml'),
    );

    expect(data.text).toBeUndefined();
  });

  it('should return undefined for a multipart body with no closing boundary (malformed)', async () => {
    const unterminatedEml = [
      'From: Alice <alice@example.com>',
      'Subject: Unterminated',
      'Content-Type: multipart/alternative; boundary="example"',
      '',
      '--example',
      'Content-Type: text/plain',
      '',
      'plain body',
    ].join('\n');

    const data = await parseEml(makeFile(unterminatedEml, 'unterminated.eml'));

    expect(data.text).toBeUndefined();
  });

  it('should stop recursing past the MIME depth cap and treat it as unsupported', async () => {
    // 12 levels of multipart/mixed wrapping — comfortably past MAX_MIME_DEPTH.
    let inner = ['Content-Type: text/plain', '', 'deeply nested body'].join('\n');
    for (let i = 0; i < 12; i++) {
      inner = [
        `Content-Type: multipart/mixed; boundary="b${i}"`,
        '',
        `--b${i}`,
        inner,
        `--b${i}--`,
        '',
      ].join('\n');
    }
    const deepEml = ['From: Alice <alice@example.com>', 'Subject: Deep', inner].join(
      '\n',
    );

    const data = await parseEml(makeFile(deepEml, 'deep.eml'));

    expect(data.text).toBeUndefined();
  });

  it('should decode a base64-encoded plain-text body', async () => {
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
    expect(data.text).toBe('secret body');
  });

  it('should decode a base64-encoded text/plain part nested inside multipart', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: Multipart base64',
      'Content-Type: multipart/mixed; boundary="example"',
      '',
      '--example',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      'bXVsdGlwYXJ0IHNlY3JldA==',
      '--example--',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'multipart-base64.eml'));

    expect(data.text).toBe('multipart secret');
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

  it('should decode a quoted-printable plain-text body', async () => {
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
    expect(data.text).toBe('encoded body\n');
  });

  it('should join a quoted-printable soft line break instead of inserting a newline', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: Soft break',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'this line is=',
      'joined',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'soft-break.eml'));

    expect(data.text).toBe('this line isjoined\n');
  });

  it('should omit a quoted-printable body with an unsupported charset', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'Subject: QP windows charset',
      'Content-Type: text/plain; charset=windows-1252',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'caf=E9',
      '',
    ].join('\n');

    const data = await parseEml(makeFile(eml, 'qp-windows.eml'));

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
