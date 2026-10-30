import { computed, Injectable, signal, Signal } from '@angular/core';
import { DropWhere } from './tree.types';

interface IndicatorStyle {
  readonly display: string;
  readonly top: string;
  readonly left: string;
  readonly width: string;
}

interface ElementLayout {
  readonly rect: DOMRect;
  readonly paddingLeft: number;
}

interface LastTarget {
  readonly element: HTMLElement;
  readonly where: DropWhere;
}

@Injectable()
export class TreeIndicatorService {
  private readonly _indicatorTop = signal(0);
  private readonly _indicatorLeft = signal(0);
  private readonly _indicatorWidth = signal(0);
  private readonly _indicatorVisible = signal(false);

  private _containerRect: DOMRect | null = null;
  private _elementLayoutCache = new WeakMap<HTMLElement, ElementLayout>();
  private _lastTarget: LastTarget | null = null;

  readonly indicatorStyle: Signal<IndicatorStyle> = computed(
    () =>
      ({
        display: this._indicatorVisible() ? 'block' : 'none',
        top: `${this._indicatorTop()}px`,
        left: `${this._indicatorLeft()}px`,
        width: `${this._indicatorWidth()}px`,
      }) as const,
  );

  show(
    element: HTMLElement,
    where: DropWhere,
    container: HTMLElement,
    indent: number,
    baseIndent: number,
  ): void {
    const sameTarget =
      this._lastTarget?.element === element && this._lastTarget?.where === where;
    if (sameTarget && this._indicatorVisible()) return;

    this._lastTarget = { element, where };
    this._containerRect ??= container.getBoundingClientRect();
    const containerRect = this._containerRect;

    let elementLayout = this._elementLayoutCache.get(element);
    if (!elementLayout) {
      const rect = element.getBoundingClientRect();
      const itemEl = element.closest('.item') as HTMLElement | null;
      const paddingLeft = itemEl ? this._parsePaddingLeft(itemEl) : 0;
      elementLayout = { rect, paddingLeft } as const;
      this._elementLayoutCache.set(element, elementLayout);
    }

    const elRect = elementLayout.rect;
    const isAfter = where === 'after';
    const y =
      elRect.top -
      containerRect.top +
      (isAfter || where === 'inside' ? elRect.height : 0);

    let left = 0;
    let width = containerRect.width;

    const itemEl = element.closest('.item') as HTMLElement | null;
    if (itemEl) {
      const itemRect = itemEl.getBoundingClientRect();
      const paddingLeft = elementLayout.paddingLeft;
      const extraIndent = where === 'inside' ? indent : 0;
      left = itemRect.left - containerRect.left + paddingLeft + extraIndent;
      width = Math.max(0, containerRect.width - left);
    } else if (where === 'root') {
      // The root drop zone is not a row, so line up with the top-level rows.
      left = baseIndent;
      width = Math.max(0, containerRect.width - left);
    }

    this._indicatorTop.set(Math.round(y));
    this._indicatorLeft.set(Math.max(0, Math.round(left)));
    this._indicatorWidth.set(Math.max(0, Math.round(width)));
    this._indicatorVisible.set(true);
  }

  hide(): void {
    this._indicatorVisible.set(false);
    this._lastTarget = null;
    this._containerRect = null;
  }

  clear(): void {
    this.hide();
    this._elementLayoutCache = new WeakMap();
  }

  private _parsePaddingLeft(element: HTMLElement): number {
    const paddingLeftStr = getComputedStyle(element).paddingLeft || '0';
    return parseFloat(paddingLeftStr) || 0;
  }
}
