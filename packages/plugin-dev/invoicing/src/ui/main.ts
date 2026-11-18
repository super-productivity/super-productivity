import { el } from './dom';
import { loadTranslations, t } from './i18n';
import { renderInvoiceList } from './invoice-list';
import { renderNewInvoice } from './new-invoice';
import { renderSettingsForm } from './settings-form';
import { host, loadInvoices, loadProjects, loadSettings, loadTasks } from './store';

const app = (): HTMLElement => document.getElementById('app') as HTMLElement;

const showError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  app().replaceChildren(
    el('p', {
      className: 'callout callout--danger',
      role: 'alert',
      text: t('ERROR.GENERIC', { error: message }),
    }),
  );
};

/** Reloads everything and redraws; called on open and after every save. */
const refresh = async (): Promise<void> => {
  const [settings, invoices, projects, tasks, locale] = await Promise.all([
    loadSettings(),
    loadInvoices(),
    loadProjects(),
    loadTasks(),
    Promise.resolve(host().getCurrentLanguage()),
  ]);
  const reload = (): void => void refresh().catch(showError);
  app().replaceChildren(
    el('h1', { text: t('TITLE') }),
    renderInvoiceList(invoices, locale, reload),
    el('h2', { text: t('NEW.TITLE') }),
    renderNewInvoice({ settings, invoices, projects, tasks, locale }, reload),
    renderSettingsForm(settings, reload),
  );
};

const init = async (): Promise<void> => {
  app().replaceChildren(el('p', { role: 'status', text: t('LOADING') }));
  await loadTranslations(host());
  await refresh();
};

init().catch(showError);
