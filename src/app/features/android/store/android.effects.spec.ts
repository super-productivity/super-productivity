import { buildTaskTitle, readableUrl } from './android.effects';

describe('android share helpers', () => {
  describe('buildTaskTitle', () => {
    it('prefers the subject (page title from browsers) over everything else', () => {
      expect(
        buildTaskTitle({
          subject: 'Great Article',
          title: 'Some Title',
          type: 'LINK',
          path: 'https://example.com/post',
        }),
      ).toBe('Great Article');
    });

    it('falls back to the explicit title when there is no subject', () => {
      expect(
        buildTaskTitle({
          subject: '',
          title: 'Some Title',
          type: 'LINK',
          path: 'https://example.com/post',
        }),
      ).toBe('Some Title');
    });

    // Regression: a share without subject/title must derive a readable title
    // from the link, not the generic "Shared Content" placeholder.
    it('derives a readable title from the URL for links without subject/title', () => {
      expect(
        buildTaskTitle({
          subject: '',
          title: '',
          type: 'LINK',
          path: 'https://www.example.com/some-cool-article',
        }),
      ).toBe('example.com: some cool article');
    });

    it('uses the first line of content for notes without subject/title', () => {
      expect(
        buildTaskTitle({
          subject: '',
          title: '',
          type: 'NOTE',
          path: 'Buy milk\nand bread',
        }),
      ).toBe('Buy milk');
    });

    it('falls back to "Shared note" for empty note content', () => {
      expect(buildTaskTitle({ subject: '', title: '', type: 'NOTE', path: '' })).toBe(
        'Shared note',
      );
    });

    it('tolerates missing fields', () => {
      expect(buildTaskTitle({})).toBe('Shared note');
    });

    it('truncates very long titles to 150 chars', () => {
      const result = buildTaskTitle({
        subject: 'x'.repeat(300),
        type: 'NOTE',
        path: 'p',
      });
      expect(result.length).toBe(150);
      expect(result.endsWith('...')).toBeTrue();
    });
  });

  describe('readableUrl', () => {
    it('returns host and decoded path', () => {
      expect(readableUrl('https://www.example.com/foo/bar-baz')).toBe(
        'example.com: foo bar baz',
      );
    });

    it('returns just the host when there is no path', () => {
      expect(readableUrl('https://example.com/')).toBe('example.com');
    });

    it('returns the original string for invalid URLs', () => {
      expect(readableUrl('not a url')).toBe('not a url');
    });
  });
});
