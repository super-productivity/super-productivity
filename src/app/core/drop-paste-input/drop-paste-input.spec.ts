import { createFromDrop, getDroppedUrl } from './drop-paste-input';

// Minimal DragEvent stub: only the bits createFromDrop reads.
const dropEventWithFile = (file: File, text = ''): DragEvent =>
  ({
    dataTransfer: {
      getData: (type: string) => (type === 'text' ? text : ''),
      files: [file] as unknown as FileList,
    },
  }) as unknown as DragEvent;

const dropEventWithText = (text: string): DragEvent =>
  ({
    dataTransfer: {
      getData: (type: string) => (type === 'text' ? text : ''),
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
  it('should return a dropped http(s) link', () => {
    expect(getDroppedUrl(dropEventWithText('https://example.com/foo'))).toBe(
      'https://example.com/foo',
    );
    expect(getDroppedUrl(dropEventWithText('http://example.com'))).toBe(
      'http://example.com',
    );
  });

  it('should trim surrounding whitespace', () => {
    expect(getDroppedUrl(dropEventWithText('  https://example.com  '))).toBe(
      'https://example.com',
    );
  });

  it('should ignore plain-text selections that are not links', () => {
    expect(getDroppedUrl(dropEventWithText('just some text'))).toBeNull();
    expect(getDroppedUrl(dropEventWithText(''))).toBeNull();
  });

  it('should ignore non-web schemes', () => {
    expect(getDroppedUrl(dropEventWithText('ftp://example.com'))).toBeNull();
    expect(getDroppedUrl(dropEventWithText('file:///etc/hosts'))).toBeNull();
    expect(getDroppedUrl(dropEventWithText('javascript:alert(1)'))).toBeNull();
  });

  it('should reject multi-line / whitespace-containing text that merely starts with http', () => {
    expect(getDroppedUrl(dropEventWithText('https://example.com\nmore text'))).toBeNull();
    expect(getDroppedUrl(dropEventWithText('https://example.com and more'))).toBeNull();
  });

  it('should return null when there is no dataTransfer', () => {
    expect(getDroppedUrl({} as DragEvent)).toBeNull();
  });
});
