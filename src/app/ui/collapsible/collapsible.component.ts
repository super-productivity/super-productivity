import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
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

@Component({
  selector: 'collapsible',
  templateUrl: './collapsible.component.html',
  styleUrls: ['./collapsible.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation],
  imports: [MatIcon],
})
export class CollapsibleComponent implements OnInit, OnDestroy {
  private static _groupCollapsibles = new Set<CollapsibleComponent>();
  readonly title = input<string>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() icon?: string;

  readonly isIconBefore = input<boolean>(false);
  @Input() isGroup = false;

  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  @HostBinding('class.isExpanded') @Input() isExpanded: boolean = false;
  // TODO: Skipped for migration because:
  //  This input is used in combination with `@HostBinding` and migrating would
  //  break.
  @HostBinding('class.isInline') @Input() isInline: boolean = false;

  readonly isExpandedChange = output<boolean>();

  private _cd = inject(ChangeDetectorRef);

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
    if (ev.key === 'ArrowLeft') {
      if (ev.shiftKey && this.isGroup) {
        CollapsibleComponent.setAllGroupExpanded(false);
      } else {
        this.collapseIfExpanded();
      }
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (ev.key === 'ArrowRight') {
      if (ev.shiftKey && this.isGroup) {
        CollapsibleComponent.setAllGroupExpanded(true);
      } else {
        this.expandIfCollapsed();
      }
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
  }

  toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    this.isExpandedChange.emit(this.isExpanded);
    this._cd.markForCheck();
  }

  private collapseIfExpanded(): void {
    if (this.isExpanded) {
      this.toggleExpand();
    }
  }

  private expandIfCollapsed(): void {
    if (!this.isExpanded) {
      this.toggleExpand();
    }
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
