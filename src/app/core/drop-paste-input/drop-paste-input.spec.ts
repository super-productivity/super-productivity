import { createFromDrop, getDroppedUrl } from './drop-paste-input';

// Minimal DragEvent stub: only the bits createFromDrop reads.
const dropEventWithFile = (file: File, text = ''): DragEvent =>
  ({
    dataTransfer: {
      getData: (type: string) => (type === 'text' ? text : ''),
      files: [file] as unknown as FileList,
    },
  }) as unknown as DragEvent;

// Stub whose dataTransfer serves the `text/plain` and `text/uri-list` payloads
// a real drop provides.
const dropEvent = (opts: { plain?: string; uriList?: string }): DragEvent =>
  ({
    dataTransfer: {
      getData: (type: string) =>
        (type === 'text/uri-list' ? opts.uriList : opts.plain) ?? '',
      files: [] as unknown as FileList,
    },
  }) as unknown as DragEvent;

describe('createFromDrop', () => {
  let originalEa: typeof window.ea | undefined;

  beforeEach(() => {
    originalEa = window.ea;
  });

  afterEach(() => {
    if (originalEa === undefined) {
      delete (window as { ea?: typeof window.ea }).ea;
    } else {
      window.ea = originalEa;
    }
  });

  it('should create a FILE attachment from a dropped file', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const result = createFromDrop(dropEventWithFile(file));

    expect(result).toEqual({
      title: 'photo',
      path: 'photo.png',
      type: 'FILE',
      icon: jasmine.any(String),
    });
  });

  it('should resolve the absolute path via window.ea.getPathForFile in Electron (#8553)', () => {
    // Simulate Electron, where File.path no longer exists (Electron 32+) and the
    // real filesystem path must come from webUtils.getPathForFile.
    const absPath = 'C:\\Users\\me\\Pictures\\photo.png';
    window.ea = {
      getPathForFile: (f: File) => (f.name === 'photo.png' ? absPath : null),
    } as unknown as typeof window.ea;

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const result = createFromDrop(dropEventWithFile(file));

    // The path must be the absolute one so "open" works; the title stays clean.
    expect(result?.path).toBe(absPath);
    expect(result?.type).toBe('FILE');
    expect(result?.title).toBe('photo');
  });

  it('should fall back to the file name when getPathForFile returns null', () => {
    window.ea = {
      getPathForFile: () => null,
    } as unknown as typeof window.ea;

    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const result = createFromDrop(dropEventWithFile(file));

    expect(result?.path).toBe('doc.pdf');
  });

  it('should treat dropped text as a link, not a file', () => {
    const file = new File(['x'], 'ignored.png', { type: 'image/png' });
    const result = createFromDrop(dropEventWithFile(file, 'https://example.com'));

    expect(result?.type).toBe('LINK');
    expect(result?.path).toBe('https://example.com');
  });
});

describe('getDroppedUrl', () => {
  it('should return a plain-text http(s) link', () => {
    expect(getDroppedUrl(dropEvent({ plain: 'https://example.com/foo' }))).toBe(
      'https://example.com/foo',
    );
    expect(getDroppedUrl(dropEvent({ plain: 'http://example.com' }))).toBe(
      'http://example.com',
    );
  });

  it('should read the URL from text/uri-list when text/plain has none', () => {
    // Some browsers/Electron cross-app drops deliver the URL only here.
    expect(
      getDroppedUrl(dropEvent({ uriList: 'https://example.com/from-uri-list' })),
    ).toBe('https://example.com/from-uri-list');
  });

  it('should extract the URL when text/plain is "<url>\\n<title>" (common link drag)', () => {
    expect(
      getDroppedUrl(dropEvent({ plain: 'https://example.com/a\nSome Page Title' })),
    ).toBe('https://example.com/a');
  });

  it('should skip comment lines in a uri-list', () => {
    expect(
      getDroppedUrl(dropEvent({ uriList: '# a comment\r\nhttps://example.com/x' })),
    ).toBe('https://example.com/x');
  });

  it('should trim surrounding whitespace', () => {
    expect(getDroppedUrl(dropEvent({ plain: '  https://example.com  ' }))).toBe(
      'https://example.com',
    );
  });

  it('should ignore plain-text selections that are not links', () => {
    expect(getDroppedUrl(dropEvent({ plain: 'just some text' }))).toBeNull();
    expect(getDroppedUrl(dropEvent({ plain: '' }))).toBeNull();
  });

  it('should ignore non-web schemes', () => {
    expect(getDroppedUrl(dropEvent({ plain: 'ftp://example.com' }))).toBeNull();
    expect(getDroppedUrl(dropEvent({ plain: 'file:///etc/hosts' }))).toBeNull();
    expect(getDroppedUrl(dropEvent({ plain: 'javascript:alert(1)' }))).toBeNull();
  });

  it('should reject a single line that contains inner whitespace (a text selection)', () => {
    expect(
      getDroppedUrl(dropEvent({ plain: 'https://example.com and more' })),
    ).toBeNull();
  });

  it('should return null when there is no dataTransfer', () => {
    expect(getDroppedUrl({} as DragEvent)).toBeNull();
  });

  it('should work with a real DataTransfer object (integration)', () => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', 'https://example.com/real');
    dt.setData('text/plain', 'https://example.com/real\nReal Title');
    const ev = new DragEvent('drop', { dataTransfer: dt });
    expect(getDroppedUrl(ev)).toBe('https://example.com/real');
  });
});
