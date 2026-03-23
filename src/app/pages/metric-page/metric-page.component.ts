import { ChangeDetectionStrategy, Component } from '@angular/core';
import { T } from '../../t.const';
import { MetricComponent } from '../../features/metric/metric.component';

@Component({
  selector: 'metric-page',
  templateUrl: './metric-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MetricComponent],
})
export class MetricPageComponent {
  T: typeof T = T;

  constructor() {}
}
