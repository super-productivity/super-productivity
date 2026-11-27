import { loadTranslations, t } from './i18n';

describe('iframe translations', () => {
  it('awaits the iframe translation bridge and interpolates dynamic values locally', async () => {
    const translate = jest.fn((key: string) =>
      Promise.resolve(key === 'BUTTON.SIGN_IN' ? 'Mit Microsoft anmelden' : key),
    );

    await loadTranslations({ translate });

    expect(t('BUTTON.SIGN_IN')).toBe('Mit Microsoft anmelden');
    expect(t('ERROR.LOAD_FAILED', { error: '401' })).toContain('401');
  });

  it('falls back to bundled English if the host translation call fails', async () => {
    await loadTranslations({
      translate: () => Promise.reject(new Error('bridge unavailable')),
    });

    expect(t('BUTTON.IMPORT')).toBe('Import');
  });
});
