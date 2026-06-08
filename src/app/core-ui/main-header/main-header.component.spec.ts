import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// Regression test for #7477: in a project view a long title pushed the
// right-side header actions (simple-counter / habit buttons) off screen.
//
// The fix is a CSS-only flex change on `.action-nav-right` in
// main-header.component.scss, so we don't instantiate the real (heavy)
// MainHeaderComponent. Instead we mount a tiny host that pulls in the *real*
// compiled stylesheet via `styleUrls` and reproduces the exact failing flex
// structure: a constrained `.wrapper` row containing a shrinkable title and
// the `.action-nav-right` nav whose `.counters-action-group` children are
// `flex-shrink: 0`. We then assert observable layout rather than CSS strings.
//
// The discriminating rule under test is `.action-nav-right { flex: 0 0 auto }`:
// remove it and the nav shrinks, its non-shrinking buttons overflow, and the
// last button's right edge escapes the row — which is exactly the bug.
@Component({
  standalone: true,
  styleUrls: ['./main-header.component.scss'],
  template: `
    <div
      class="wrapper"
      style="width: 320px; box-sizing: border-box"
    >
      <div
        class="page-title"
        style="
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        "
      >
        {{ title }}
      </div>

      <nav class="action-nav-right">
        <div class="counters-action-group">
          <button type="button"></button>
          <button type="button"></button>
          <button type="button"></button>
          <button type="button"></button>
        </div>
      </nav>
    </div>
  `,
})
class HeaderLayoutHostComponent {
  title = 'A very long active work context title '.repeat(8);
}

describe('MainHeaderComponent layout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderLayoutHostComponent],
    }).compileComponents();
  });

  it('keeps the action buttons on screen when the title is long (#7477)', () => {
    const fixture = TestBed.createComponent(HeaderLayoutHostComponent);
    // Layout must be computed in the live DOM for width measurements.
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.detectChanges();

      const wrapper = fixture.nativeElement.querySelector('.wrapper') as HTMLElement;
      const title = fixture.nativeElement.querySelector('.page-title') as HTMLElement;
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('.counters-action-group button'),
      ) as HTMLElement[];
      const lastButton = buttons[buttons.length - 1];

      // Sanity: the real stylesheet was applied, so the buttons have width.
      expect(buttons.length).toBe(4);
      expect(lastButton.getBoundingClientRect().width).toBeGreaterThan(0);

      // The title takes the squeeze and ellipsizes...
      expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);

      // ...so the trailing action button stays fully inside the header row.
      const wrapperRect = wrapper.getBoundingClientRect();
      const lastButtonRect = lastButton.getBoundingClientRect();
      expect(lastButtonRect.right).toBeLessThanOrEqual(wrapperRect.right + 0.5);
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
  });
});
