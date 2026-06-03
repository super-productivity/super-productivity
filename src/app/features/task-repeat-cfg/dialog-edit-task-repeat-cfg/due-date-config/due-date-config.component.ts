import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CollapsibleComponent } from '../../../../ui/collapsible/collapsible.component';
import { T } from '../../../../t.const';
import {
  RepeatDueConfig,
  RepeatDueOffsetUnit,
  RepeatDuePeriod,
  RepeatDueType,
} from '../../task-repeat-cfg.model';

interface SelectOpt<V> {
  value: V;
  label: string;
}

/**
 * How a generated recurring instance's DUE day is derived from its "appears"
 * (occurrence) day. Lives at the dialog level — independent of the rrule builder
 * — so it applies to EVERY recurring config (the quick-setting presets and
 * Custom alike). The actual derivation is done by `recurring-due-date.util`; this
 * component only edits the config fields and emits them.
 */
@Component({
  selector: 'due-date-config',
  templateUrl: './due-date-config.component.html',
  styleUrls: ['./due-date-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, CollapsibleComponent],
})
export class DueDateConfigComponent implements OnInit {
  private _translateService = inject(TranslateService);
  T: typeof T = T;

  config = input<RepeatDueConfig | undefined>(undefined);
  configChange = output<RepeatDueConfig>();

  private _due = signal<RepeatDueConfig>({});
  due = this._due.asReadonly();

  dueTypeOpts: SelectOpt<RepeatDueType>[] = [
    { value: 'ON_OCCURRENCE', label: T.F.TASK_REPEAT.F.RRULE_DUE_ON_OCCURRENCE },
    { value: 'OFFSET', label: T.F.TASK_REPEAT.F.RRULE_DUE_OFFSET },
    { value: 'UNTIL_NEXT', label: T.F.TASK_REPEAT.F.RRULE_DUE_UNTIL_NEXT },
    { value: 'PERIOD_END', label: T.F.TASK_REPEAT.F.RRULE_DUE_PERIOD_END },
    { value: 'FROM_COMPLETION', label: T.F.TASK_REPEAT.F.RRULE_DUE_FROM_COMPLETION },
    { value: 'FIXED', label: T.F.TASK_REPEAT.F.RRULE_DUE_FIXED },
    { value: 'NONE', label: T.F.TASK_REPEAT.F.RRULE_DUE_NONE },
  ];
  dueUnitOpts: SelectOpt<RepeatDueOffsetUnit>[] = [
    { value: 'DAY', label: T.F.TASK_REPEAT.F.RRULE_DUE_UNIT_DAY },
    { value: 'BUSINESS_DAY', label: T.F.TASK_REPEAT.F.RRULE_DUE_UNIT_BUSINESS_DAY },
    { value: 'WEEK', label: T.F.TASK_REPEAT.F.RRULE_DUE_UNIT_WEEK },
  ];
  duePeriodOpts: SelectOpt<RepeatDuePeriod>[] = [
    { value: 'WEEK', label: T.F.TASK_REPEAT.F.RRULE_DUE_PERIOD_WEEK },
    { value: 'MONTH', label: T.F.TASK_REPEAT.F.RRULE_DUE_PERIOD_MONTH },
    { value: 'QUARTER', label: T.F.TASK_REPEAT.F.RRULE_DUE_PERIOD_QUARTER },
    { value: 'YEAR', label: T.F.TASK_REPEAT.F.RRULE_DUE_PERIOD_YEAR },
  ];

  ngOnInit(): void {
    this._due.set({ ...(this.config() ?? {}) });
  }

  /** Current due type with the ON_OCCURRENCE default applied. */
  dueType(): RepeatDueType {
    return this._due().dueType ?? 'ON_OCCURRENCE';
  }
  /** Collapsed-section title: "Due date: <current type>". */
  dueCollapsibleTitle(): string {
    const opt = this.dueTypeOpts.find((o) => o.value === this.dueType());
    const typeLabel = opt ? this._translateService.instant(opt.label) : '';
    const label = this._translateService.instant(T.F.TASK_REPEAT.F.RRULE_DUE_LABEL);
    return `${label}: ${typeLabel}`;
  }

  private _patchDue(patch: Partial<RepeatDueConfig>): void {
    this._due.update((d) => ({ ...d, ...patch }));
    this.configChange.emit(this._due());
  }
  setDueType(v: string): void {
    const type = v as RepeatDueType;
    // Rebuild from scratch so params that don't apply to the chosen type are
    // dropped (no stale offset / period / fixed date leaking through).
    const cur = this._due();
    const next: RepeatDueConfig = { dueType: type };
    if (type === 'OFFSET') {
      next.dueOffset = cur.dueOffset ?? 1;
      next.dueOffsetUnit = cur.dueOffsetUnit ?? 'DAY';
    } else if (type === 'FROM_COMPLETION') {
      next.dueOffset = cur.dueOffset ?? 1;
      next.dueOffsetUnit = cur.dueOffsetUnit ?? 'DAY';
    } else if (type === 'PERIOD_END') {
      next.duePeriod = cur.duePeriod ?? 'MONTH';
    } else if (type === 'FIXED') {
      next.dueFixedDate = cur.dueFixedDate ?? '';
    }
    this._due.set(next);
    this.configChange.emit(this._due());
  }
  setDueOffset(v: string): void {
    this._patchDue({ dueOffset: Math.floor(+v) || 0 });
  }
  setDueOffsetUnit(v: string): void {
    this._patchDue({ dueOffsetUnit: v as RepeatDueOffsetUnit });
  }
  setDuePeriod(v: string): void {
    this._patchDue({ duePeriod: v as RepeatDuePeriod });
  }
  setDueFixedDate(v: string): void {
    this._patchDue({ dueFixedDate: v });
  }
}
