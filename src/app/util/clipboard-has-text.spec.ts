import { clipboardHasText } from './clipboard-has-text';

const dt = (types: string[]): DataTransfer => ({ types }) as unknown as DataTransfer;

describe('clipboardHasText', () => {
  it('should be false when clipboardData is null', () => {
    expect(clipboardHasText(null)).toBe(false);
  });

  it('should be false when there are no types', () => {
    expect(clipboardHasText(dt([]))).toBe(false);
  });

  it('should be false for an image-only paste', () => {
    expect(clipboardHasText(dt(['Files', 'image/png']))).toBe(false);
  });

  it('should be true when plain text is present', () => {
    expect(clipboardHasText(dt(['text/plain']))).toBe(true);
  });

  it('should be true when html is present', () => {
    expect(clipboardHasText(dt(['text/html']))).toBe(true);
  });

  it('should be true when text and an image are both present (e.g. OneNote)', () => {
    expect(clipboardHasText(dt(['text/plain', 'text/html', 'Files']))).toBe(true);
  });
});
