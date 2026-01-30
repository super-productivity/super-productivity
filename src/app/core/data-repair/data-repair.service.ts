import { inject, Injectable } from '@angular/core';
import { AppDataCompleteLegacy } from '../../imex/sync/sync.model';
import { T } from '../../t.const';
import { TranslateService } from '@ngx-translate/core';
import { isDataRepairPossible } from '../../op-log/validation/is-data-repair-possible.util';
import { getLastValidityError } from '../../op-log/validation/is-related-model-data-valid';
import { IS_ELECTRON } from '../../app.constants';
import { AppDataComplete } from '../../op-log/model/model-config';
import { Log } from '../log';
import { alertDialog, confirmDialog } from '../../util/native-dialogs';

@Injectable({
  providedIn: 'root',
})
export class DataRepairService {
  private _translateService = inject(TranslateService);

  isRepairPossibleAndConfirmed(dataIn: AppDataCompleteLegacy | AppDataComplete): boolean {
    if (!isDataRepairPossible(dataIn)) {
      Log.log({ dataIn });
      alertDialog('Data damaged, repair not possible.');
      return false;
    }
    const isConfirmed = confirmDialog(
      this._translateService.instant(T.CONFIRM.AUTO_FIX, {
        validityError: getLastValidityError() || 'Unknown validity error',
      }),
    );
    if (IS_ELECTRON && !isConfirmed) {
      window.ea.shutdownNow();
    }

    return isConfirmed;
  }
}
