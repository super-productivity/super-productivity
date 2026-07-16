import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  computed,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { PluginService } from '../../plugin.service';
import { MatIcon } from '@angular/material/icon';
import { sanitizeSvgIconContent } from '../../../util/sanitize-svg-icon.util';

@Component({
  selector: 'plugin-icon',
  template: `
    @if (sanitizedSvg(); as svg) {
      <div
        class="plugin-svg-icon"
        [innerHTML]="svg"
        [style.width]="size() + 'px'"
        [style.height]="size() + 'px'"
      ></div>
    } @else {
      <mat-icon [style.font-size]="size() + 'px'">{{ fallbackIcon() }}</mat-icon>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      :host mat-icon {
        display: flex;
        flex: 1;
      }

      .plugin-svg-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .plugin-svg-icon ::ng-deep svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
})
export class PluginIconComponent {
  private readonly _sanitizer = inject(DomSanitizer);
  private readonly _pluginService = inject(PluginService);

  readonly pluginId = input.required<string>();
  readonly size = input<number>(24);
  readonly fallbackIcon = input<string>('extension');

  readonly sanitizedSvg = computed(() => {
    const pluginId = this.pluginId();
    const iconsMap = this._pluginService.getPluginIconsSignal()();
    const iconContent = iconsMap.get(pluginId);

    if (!iconContent) {
      return null;
    }

    const sanitizedSvg = sanitizeSvgIconContent(iconContent);
    return sanitizedSvg ? this._sanitizer.bypassSecurityTrustHtml(sanitizedSvg) : null;
  });
}
