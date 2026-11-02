import { lockViewportZoom } from './lock-viewport-zoom.util';

const createDocWithViewport = (content: string | null): Document => {
  const doc = document.implementation.createHTMLDocument('test');
  if (content !== null) {
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = content;
    doc.head.appendChild(meta);
  }
  return doc;
};

const getViewportContent = (doc: Document): string | undefined =>
  doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

describe('lockViewportZoom', () => {
  it('should disable zoom while keeping the existing directives', () => {
    const doc = createDocWithViewport(
      'width=device-width, initial-scale=1, viewport-fit=cover',
    );

    lockViewportZoom(doc);

    expect(getViewportContent(doc)).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no',
    );
  });

  it('should not append the directives twice', () => {
    const doc = createDocWithViewport('width=device-width');

    lockViewportZoom(doc);
    lockViewportZoom(doc);

    expect(getViewportContent(doc)).toBe(
      'width=device-width, maximum-scale=1, user-scalable=no',
    );
  });

  it('should do nothing without a viewport meta', () => {
    const doc = createDocWithViewport(null);

    expect(() => lockViewportZoom(doc)).not.toThrow();
    expect(getViewportContent(doc)).toBeUndefined();
  });
});
