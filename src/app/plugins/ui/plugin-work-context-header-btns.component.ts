import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PluginBridgeService } from '../plugin-bridge.service';
import { PluginWorkContextHeaderBtnCfg } from '../plugin-api.model';

@Component({
  selector: 'plugin-work-context-header-btns',
  template: `
    @for (button of buttons(); track button.pluginId + button.label) {
      <button
        mat-icon-button
        [class.isActive]="button.pluginId === activeEmbedPluginId()"
        [attr.aria-pressed]="button.pluginId === activeEmbedPluginId()"
        [matTooltip]="button.label"
        (click)="onClick(button)"
      >
        <mat-icon>{{ button.icon }}</mat-icon>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Toggled state: the button's plugin currently owns the work-view
         embed for the active context. A neutral ink fill — stronger than
         the standard selected overlay so it reads as a deliberate toggle
         rather than a hover, and distinct from the accent colour reserved
         for time tracking. */
      button.isActive {
        background: rgba(var(--ink-on-channel), 0.18);
        transition: background var(--transition-standard);
      }

      button.isActive:hover:not(:disabled) {
        background: rgba(var(--ink-on-channel), 0.26);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip],
})
export class PluginWorkContextHeaderBtnsComponent {
  private readonly _pluginBridge = inject(PluginBridgeService);

  readonly buttons = this._pluginBridge.workContextHeaderButtons;

  /**
   * The plugin currently embedded in the work-view body, or null. A header
   * button renders toggled when its own plugin owns that embed, so a button
   * that toggles a work-view embed reflects its on/off state.
   */
  readonly activeEmbedPluginId = this._pluginBridge.workContextEmbedPluginId;

  async onClick(button: PluginWorkContextHeaderBtnCfg): Promise<void> {
    const ctx = await this._pluginBridge.getActiveWorkContext();
    if (ctx) {
      button.onClick(ctx);
    }
  }
}
