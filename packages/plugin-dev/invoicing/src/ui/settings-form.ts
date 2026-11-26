import { Settings } from '../core/types';
import { el, field, numberInput } from './dom';
import { t } from './i18n';
import { snackError } from './notify';
import { host, saveSettings } from './store';

const ROUNDING_OPTIONS = [0, 6, 15, 30];

const roundingSelect = (current: number): HTMLSelectElement =>
  el(
    'select',
    {},
    ROUNDING_OPTIONS.map((min) =>
      el('option', {
        value: String(min),
        selected: min === current,
        text: min ? t('SETTINGS.ROUNDING_MIN', { min }) : t('SETTINGS.ROUNDING_NONE'),
      }),
    ),
  );

/** "Your details": printed on every invoice. Collapsed once filled in. */
export const renderSettingsForm = (
  settings: Settings,
  onSaved: () => void,
): HTMLElement => {
  const seller = el('textarea', { rows: 4, value: settings.seller });
  const paymentNote = el('textarea', { rows: 3, value: settings.paymentNote });
  const currency = el('input', { value: settings.currency, maxLength: 3, size: 4 });
  const tax = numberInput(settings.taxRatePct);
  const days = numberInput(settings.paymentDays, '1');
  const rounding = roundingSelect(settings.roundingMin);
  const prefix = el('input', { value: settings.numberPrefix });

  const save = async (): Promise<void> => {
    try {
      await saveSettings({
        ...settings,
        seller: seller.value,
        paymentNote: paymentNote.value,
        currency: currency.value.trim().toUpperCase() || 'EUR',
        taxRatePct: Number(tax.value) || 0,
        paymentDays: Number(days.value) || 0,
        roundingMin: Number(rounding.value) || 0,
        numberPrefix: prefix.value,
      });
    } catch (error) {
      snackError(error);
      return;
    }
    host().showSnack({ msg: t('SETTINGS.SAVED'), type: 'SUCCESS' });
    onSaved();
  };

  return el('details', { open: !settings.seller.trim() }, [
    el('summary', { text: t('SETTINGS.TITLE') }),
    el('div', { className: 'stack' }, [
      field(t('SETTINGS.SELLER'), seller),
      field(t('SETTINGS.PAYMENT_NOTE'), paymentNote, t('SETTINGS.PAYMENT_NOTE_HINT')),
      el('div', { className: 'row' }, [
        field(t('SETTINGS.CURRENCY'), currency),
        field(t('SETTINGS.TAX'), tax),
        field(t('SETTINGS.PAYMENT_DAYS'), days),
      ]),
      el('div', { className: 'row' }, [
        field(t('SETTINGS.ROUNDING'), rounding),
        field(t('SETTINGS.PREFIX'), prefix),
      ]),
      el('div', { className: 'actions' }, [
        el('button', {
          className: 'btn-primary',
          text: t('SETTINGS.SAVE'),
          onclick: save,
        }),
      ]),
    ]),
  ]);
};
