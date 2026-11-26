import { Directive, HostListener, inject } from '@angular/core';
import { MatTabGroup } from '@angular/material/tabs';
import { wheelDeltaPx } from '../../util/wheel-delta-px';

/** Idle time after the last wheel event before the header's own transition is restored. */
const GESTURE_END_MS = 150;

/** Lets a paginated `mat-tab-group` header follow wheel and trackpad gestures. */
@Directive({
  selector: 'mat-tab-group[tabHeaderWheelScroll]',
})
export class TabHeaderWheelScrollDirective {
  private readonly _tabGroup = inject(MatTabGroup);
  private _gestureEndTimer: ReturnType<typeof setTimeout> | undefined;

  @HostListener('wheel', ['$event'])
  onWheel(ev: WheelEvent): void {
    const header = this._tabGroup._tabHeader;
    if (
      // ctrl+wheel and trackpad pinches arrive as wheel events and mean zoom.
      ev.ctrlKey ||
      !header?._showPaginationControls ||
      !(ev.target instanceof Element) ||
      !ev.target.closest('.mat-mdc-tab-header')
    ) {
      return;
    }
    const raw = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    const px = wheelDeltaPx(
      raw,
      ev.deltaMode,
      header._tabListContainer.nativeElement.clientWidth,
    );
    const delta = header._getLayoutDirection() === 'rtl' ? -px : px;
    const tabList = header._tabList.nativeElement;
    const before = header.scrollDistance;
    // Material animates each position change over 500ms; a stream of wheel
    // ticks would restart it every time and lurch instead of following.
    tabList.style.transition = 'none';
    header.scrollDistance = before + delta;
    // At either end the strip no longer moves; the wheel then stays an
    // ordinary page scroll instead of trapping it over the header.
    if (header.scrollDistance === before) {
      tabList.style.transition = '';
      return;
    }
    ev.preventDefault();

    clearTimeout(this._gestureEndTimer);
    this._gestureEndTimer = setTimeout(() => {
      tabList.style.transition = '';
    }, GESTURE_END_MS);
  }
}
