import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ActivityHeatmapComponent } from '../../metric/activity-heatmap/activity-heatmap.component';

@Component({
  selector: 'productivity-streak-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityHeatmapComponent],
  template: `
    <div class="heatmap-container">
      <activity-heatmap></activity-heatmap>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--s2);
        height: 100%;
        overflow: auto;
      }

      .heatmap-container {
        width: 100%;
      }
    `,
  ],
})
export class ProductivityStreakWidgetComponent {}
