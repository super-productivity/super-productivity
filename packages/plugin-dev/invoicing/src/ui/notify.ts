import { t } from './i18n';
import { host } from './store';

/** Shows a failed action as an error snack instead of failing silently. */
export const snackError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  host().showSnack({ msg: t('ERROR.GENERIC', { error: message }), type: 'ERROR' });
};
