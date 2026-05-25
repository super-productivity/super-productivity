import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
} from '@angular/core';
import { expandAnimation } from '../animations/expand.ani';
import { MatIcon } from '@angular/material/icon';
import { findAdjacentFocusable } from '../../util/find-adjacent-focusable';
import { CdkDragHandle } from '@angular/cdk/drag-drop';

/**
 * CSS selector matching every element that participates in keyboard
 * arrow-navigation across the work view: task rows and group headers.
 */
export const GROUP_NAV_SELECTOR = 'task, collapsible.is-group > .collapsible-header';

@Component({
  selector: 'collapsible',
  templateUrl: './collapsible.component.html',
  styleUrls: ['./collapsible.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [MatIcon, CdkDragHandle],
})
export class CollapsibleComponent implements OnInit, OnDestroy {
  // TODO: _groupCollapsibles is a global registry. If a second consumer uses [isGroup]="true",
  // all instances will silently be linked via Shift+Arrow behavior. Consider scoping this to
  // a parent context or separating by logical group if that becomes a future requirement.
  private static _groupCollapsibles = new Set<CollapsibleComponent>();
  private static _idCounter = 0;
  readonly panelId = this.createPanelId();
  readonly title = input<string>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() icon?: string;

  readonly isIconBefore = input<boolean>(false);
  readonly isTitleDragHandle = input<boolean>(false);
  @HostBinding('class.is-group') @Input() isGroup = false;

  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  @HostBinding('class.isExpanded') @Input() isExpanded: boolean = false;
  // TODO: Skipped for migration because:
  //  This input is used in combination with `@HostBinding` and migrating would
  //  break.
  @HostBinding('class.isInline') @Input() isInline: boolean = false;

  readonly isExpandedChange = output<boolean>();

  private _cd = inject(ChangeDetectorRef);
  private _elementRef = inject(ElementRef);

  private createPanelId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `collapsible-panel-${++CollapsibleComponent._idCounter}`;
  }

  ngOnInit(): void {
    if (this.isGroup) {
      CollapsibleComponent._groupCollapsibles.add(this);
    }
  }

  ngOnDestroy(): void {
    if (this.isGroup) {
      CollapsibleComponent._groupCollapsibles.delete(this);
    }
  }

  onHeaderKeydown(ev: KeyboardEvent): void {
    if (!this.isGroup) {
      return;
    }

    if (ev.key === 'ArrowLeft') {
      if (ev.shiftKey) {
        CollapsibleComponent.setAllGroupExpanded(false);
      } else {
        this.collapseIfExpanded();
      }
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (ev.key === 'ArrowRight') {
      if (ev.shiftKey) {
        CollapsibleComponent.setAllGroupExpanded(true);
      } else {
        this.expandIfCollapsed();
      }
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (this._focusAdjacent(ev, ev.key === 'ArrowDown' ? 'next' : 'prev')) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }

    if (ev.key === 'Enter' || ev.key === ' ') {
      this.toggleExpand();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
  }

  private _focusAdjacent(ev: KeyboardEvent, direction: 'prev' | 'next'): boolean {
    const from = ev.currentTarget as HTMLElement;
    const target = findAdjacentFocusable(from, direction, GROUP_NAV_SELECTOR);
    if (target) {
      target.focus();
      return true;
    }
    return false;
  }

  toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    this.isExpandedChange.emit(this.isExpanded);
    this._cd.markForCheck();
  }

  collapseIfExpanded(): void {
    if (this.isExpanded) {
      this.toggleExpand();
    }
  }

  private expandIfCollapsed(): void {
    if (!this.isExpanded) {
      this.toggleExpand();
    }
  }

  focusHeader(): void {
    const header = this._elementRef.nativeElement.querySelector(
      ':scope > .collapsible-header',
    );
    if (header instanceof HTMLElement) {
      header.focus();
    }
  }

  static findClosestGroup(element: HTMLElement | null): CollapsibleComponent | null {
    const host = element?.closest('collapsible.is-group') ?? null;
    if (!host) {
      return null;
    }
    for (const c of CollapsibleComponent._groupCollapsibles) {
      if (c._elementRef.nativeElement === host) {
        return c;
      }
    }
    return null;
  }

  private static setAllGroupExpanded(isExpanded: boolean): void {
    for (const collapsible of CollapsibleComponent._groupCollapsibles) {
      if (collapsible.isExpanded !== isExpanded) {
        collapsible.isExpanded = isExpanded;
        collapsible.isExpandedChange.emit(isExpanded);
        collapsible._cd.markForCheck();
      }
    }
  }
}
