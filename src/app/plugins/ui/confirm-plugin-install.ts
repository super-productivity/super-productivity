import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { T } from '../../t.const';
import { escapeHtml } from '../../util/escape-html';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { PluginState } from '../plugin-state.model';
import { readZipManifest } from '../util/read-zip-manifest.util';
import {
  isDataSharingChanged,
  renderDataSharingHtml,
} from '../util/plugin-data-sharing.util';

export interface ConfirmPluginInstallDeps {
  matDialog: MatDialog;
  translateService: TranslateService;
  pluginStates: ReadonlyMap<string, PluginState>;
}

const dataSharingHtml = async (
  file: Blob,
  { translateService, pluginStates }: Omit<ConfirmPluginInstallDeps, 'matDialog'>,
): Promise<string> => {
  const manifest = await readZipManifest(file);
  if (!manifest) {
    return '';
  }
  const installed = pluginStates.get(manifest.id)?.manifest;
  return renderDataSharingHtml(
    manifest,
    { isBundled: false, isChanged: isDataSharingChanged(installed, manifest) },
    (key, params) => translateService.instant(key, params),
  );
};

/**
 * Asks before installing an uploaded plugin ZIP. Resolves true only for the OK
 * button; Cancel, Esc and backdrop resolve false.
 */
// Uploaded code is unreviewed, so the full risk list is shown here, right before it
// is installed, instead of above every plugin on the page.
export const confirmPluginInstall = async (
  file: Blob,
  deps: ConfirmPluginInstallDeps,
): Promise<boolean> => {
  const t = (key: string): string => escapeHtml(deps.translateService.instant(key));
  const risks = [
    T.PLUGINS.RISK_DATA_ACCESS,
    T.PLUGINS.RISK_MALICIOUS_CODE,
    T.PLUGINS.RISK_SYSTEM_ACCESS,
    T.PLUGINS.RISK_PERFORMANCE,
  ];
  const message =
    `<p>${t(T.PLUGINS.SECURITY_WARNING)}</p>` +
    `<ul>${risks.map((risk) => `<li>${t(risk)}</li>`).join('')}</ul>` +
    `<p>${t(T.PLUGINS.RECOMMENDATION)}</p>` +
    (await dataSharingHtml(file, deps));
  const result = await firstValueFrom(
    deps.matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: { message, okTxt: T.PLUGINS.INSTALL_PLUGIN },
      })
      .afterClosed(),
  );
  return result === true;
};
