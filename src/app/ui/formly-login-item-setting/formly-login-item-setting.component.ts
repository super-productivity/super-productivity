import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FieldType, FormlyFieldConfig } from '@ngx-formly/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';

/**
 * Start on system startup (#5572). The OS login item is the only state: it is
 * read and written over IPC and never synced, so ticking the box on one desktop
 * changes nothing on another. Keyless on purpose, like the local REST API switch.
 */
@Component({
  selector: 'formly-login-item-setting',
  template: `
    <mat-checkbox
      [checked]="!!isOpenAtLogin()"
      [disabled]="isSaving() || isOpenAtLogin() === null"
      (change)="toggle($event.checked, $event.source)"
      >{{ T.GCF.MISC.IS_AUTO_START_ON_SYSTEM_STARTUP | translate }}</mat-checkbox
    >
  `,
  styles: [':host { display: block; margin-bottom: var(--s2); }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckbox, TranslatePipe],
})
export class FormlyLoginItemSettingComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly T = T;
  readonly isOpenAtLogin = signal<boolean | null>(null);
  readonly isSaving = signal(false);

  ngOnInit(): void {
    void this._load();
  }

  async toggle(isOpenAtLogin: boolean, source?: MatCheckbox): Promise<void> {
    if (this.isSaving() || !window.ea?.setOpenAtLogin) {
      return;
    }
    this.isSaving.set(true);
    try {
      this.isOpenAtLogin.set(await window.ea.setOpenAtLogin(isOpenAtLogin));
    } catch (err) {
      Log.err('Failed to change the login item', err);
    } finally {
      this.isSaving.set(false);
    }
    // When the OS state did not change, `[checked]` does not re-render, so the
    // box would stay as clicked.
    if (source) {
      source.checked = !!this.isOpenAtLogin();
    }
  }

  private async _load(): Promise<void> {
    if (!window.ea?.getOpenAtLogin) {
      return;
    }
    try {
      this.isOpenAtLogin.set(await window.ea.getOpenAtLogin());
    } catch (err) {
      Log.err('Failed to read the login item', err);
    }
  }
}
