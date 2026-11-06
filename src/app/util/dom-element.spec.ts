import { isLinkTarget } from './dom-element';

describe('isLinkTarget', () => {
  it('matches the anchor itself', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com';

    expect(isLinkTarget(link)).toBeTrue();
  });

  it('matches an element nested inside an anchor', () => {
    const link = document.createElement('a');
    const span = document.createElement('span');
    link.appendChild(span);

    expect(isLinkTarget(span)).toBeTrue();
  });

  it('matches an SVG icon inside an anchor', () => {
    // The reason the parameter is Element and not HTMLElement: an icon is the
    // pixel a user actually clicks, and SVGElement is not an HTMLElement.
    const link = document.createElement('a');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    link.appendChild(svg);

    expect(isLinkTarget(svg)).toBeTrue();
  });

  it('does not match elements outside a link, or non-elements', () => {
    expect(isLinkTarget(document.createElement('button'))).toBeFalse();
    expect(isLinkTarget(null)).toBeFalse();
    expect(isLinkTarget(new EventTarget())).toBeFalse();
  });
});
