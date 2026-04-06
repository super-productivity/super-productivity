import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PluginIndexComponent } from '../../plugins/ui/plugin-index/plugin-index.component';

@Component({
  selector: 'plugin-dashboard-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PluginIndexComponent],
  template: `
    @if (pluginId) {
      <plugin-index
        [directPluginId]="pluginId"
        [showFullUI]="false"
      ></plugin-index>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
    `,
  ],
})
export class PluginDashboardWidgetComponent {
  @Input() pluginId = '';
}
