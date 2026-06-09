import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnlargeImgDirective } from './enlarge-img.directive';

@Component({
  template: `<img
    [enlargeImg]="url"
    src="assets/icons/icon-128x128.png"
  />`,
  imports: [EnlargeImgDirective],
})
class TestHostComponent {
  url = '';
}

describe('EnlargeImgDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostImgEl: HTMLImageElement;

  const getEnlargedImg = (): HTMLImageElement | null =>
    document.getElementById('enlarged-img') as HTMLImageElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    fixture = TestBed.createComponent(TestHostComponent);
    hostImgEl = fixture.nativeElement.querySelector('img');
  });

  afterEach(() => {
    // The directive appends the lightbox to <body>; remove it between tests.
    document.querySelectorAll('.enlarged-image-wrapper').forEach((el) => el.remove());
    delete (window as unknown as { __xssFired?: boolean }).__xssFired;
  });

  // Regression test for GHSA-78rv-m663-4fph: a crafted note.imgUrl must not be
  // able to break out of the src attribute and inject an event handler.
  it('keeps a malicious imgUrl as a literal src without injecting markup', () => {
    const payload =
      'assets/icons/icon-128x128.png#" onload="window.__xssFired = true" x="';
    fixture.componentInstance.url = payload;
    fixture.detectChanges();

    hostImgEl.click();

    const enlarged = getEnlargedImg();
    expect(enlarged)
      .withContext('enlarged image element should be created')
      .not.toBeNull();
    // The whole payload stays the literal src value (set as a DOM property);
    // with the old innerHTML sink this would be truncated at the closing quote.
    expect(enlarged!.getAttribute('src')).toBe(payload);
    // No attacker-controlled attributes leaked out of the src string.
    expect(enlarged!.hasAttribute('onload')).toBe(false);
    expect(enlarged!.hasAttribute('x')).toBe(false);
    expect((window as unknown as { __xssFired?: boolean }).__xssFired).toBeUndefined();
  });

  it('enlarges a normal image url unchanged', () => {
    const url = 'assets/icons/icon-128x128.png';
    fixture.componentInstance.url = url;
    fixture.detectChanges();

    hostImgEl.click();

    const enlarged = getEnlargedImg();
    expect(enlarged).not.toBeNull();
    expect(enlarged!.getAttribute('src')).toBe(url);
  });
});
