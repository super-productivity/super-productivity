import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MetricCopy } from '../metric.model';
import { MetricService } from '../metric.service';
import { Observable } from 'rxjs';
import { shareReplay, switchMap } from 'rxjs/operators';
import { T } from '../../../t.const';
import { FormsModule } from '@angular/forms';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';
import { ImpactStarsComponent } from '../impact-stars/impact-stars.component';
import { ReflectionNoteComponent } from '../reflection-note/reflection-note.component';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';

@Component({
  selector: 'evaluation-sheet',
  templateUrl: './evaluation-sheet.component.html',
  styleUrls: ['./evaluation-sheet.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatRadioGroup,
    MatRadioButton,
    TranslatePipe,
    ImpactStarsComponent,
    ReflectionNoteComponent,
  ],
})
export class EvaluationSheetComponent {
  private readonly _metricService = inject(MetricService);
  private readonly _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);

  readonly dayStr$ = input<Observable<string> | null>(null);
  readonly isWeek = input(false);

  readonly T = T;
  // Internal signals

  private readonly _day$ = toObservable(this.dayStr$).pipe(
    switchMap((custom$) => custom$ ?? this._globalTrackingIntervalService.todayDateStr$),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  readonly day = toSignal(this._day$, {
    initialValue: this._globalTrackingIntervalService.todayDateStr(),
  });

  // Metric data for the selected day
  readonly metricForDay = toSignal<MetricCopy | undefined>(
    this._day$.pipe(switchMap((day) => this._metricService.getMetricForDay$(day))),
    { initialValue: undefined },
  );

  updateImpactOfWork(impactOfWork: number): void {
    this._update({ impactOfWork });
  }

  updateEnergyCheckin(energyCheckin: number): void {
    this._update({ energyCheckin });
  }

  private _update(updateData: Partial<MetricCopy>): void {
    const currentMetric = this.metricForDay();
    if (!currentMetric) {
      return;
    }

    const updatedMetric: MetricCopy = {
      ...currentMetric,
      ...updateData,
    };

    this._metricService.upsertMetric(updatedMetric);
  }
}
