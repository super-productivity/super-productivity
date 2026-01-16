import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PluginI18nService } from './plugin-i18n.service';
import { GlobalConfigService } from '../features/config/global-config.service';

describe('PluginI18nService', () => {
  let service: PluginI18nService;

  beforeEach(() => {
    const globalConfigSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      localization: jasmine.createSpy().and.returnValue({ lng: 'en' }),
    });

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PluginI18nService,
        { provide: GlobalConfigService, useValue: globalConfigSpy },
      ],
    });

    service = TestBed.inject(PluginI18nService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('loadPluginTranslationsFromContent', () => {
    it('should load translations for multiple languages', () => {
      const translations = {
        en: JSON.stringify({
          GREETING: 'Hello',
          BUTTONS: { SAVE: 'Save' },
        }),
        de: JSON.stringify({
          GREETING: 'Hallo',
          BUTTONS: { SAVE: 'Speichern' },
        }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);

      expect(service.translate('test-plugin', 'GREETING')).toBe('Hello');
      service.setCurrentLanguage('de');
      expect(service.translate('test-plugin', 'GREETING')).toBe('Hallo');
    });

    it('should skip invalid JSON content', () => {
      const translations = {
        en: JSON.stringify({ GREETING: 'Hello' }),
        de: 'invalid json{{{',
      };

      expect(() => {
        service.loadPluginTranslationsFromContent('test-plugin', translations);
      }).not.toThrow();

      expect(service.translate('test-plugin', 'GREETING')).toBe('Hello');
    });

    it('should skip non-string content', () => {
      const translations = {
        en: JSON.stringify({ GREETING: 'Hello' }),
        de: null as unknown as string,
      };

      expect(() => {
        service.loadPluginTranslationsFromContent('test-plugin', translations);
      }).not.toThrow();
    });
  });

  describe('translate', () => {
    beforeEach(() => {
      const translations = {
        en: JSON.stringify({
          SIMPLE: 'Simple text',
          WITH_PARAM: 'Hello {{name}}',
          MULTI_PARAM: '{{count}} tasks in {{project}}',
          NESTED: {
            KEY: 'Nested value',
            DEEP: {
              VALUE: 'Very deep value',
            },
          },
        }),
        de: JSON.stringify({
          SIMPLE: 'Einfacher Text',
          WITH_PARAM: 'Hallo {{name}}',
          NESTED: {
            KEY: 'Verschachtelter Wert',
          },
        }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
    });

    it('should translate with current language', () => {
      expect(service.translate('test-plugin', 'SIMPLE')).toBe('Simple text');

      service.setCurrentLanguage('de');
      expect(service.translate('test-plugin', 'SIMPLE')).toBe('Einfacher Text');
    });

    it('should fallback to English when key not in current language', () => {
      service.setCurrentLanguage('de');

      // MULTI_PARAM only exists in English
      expect(service.translate('test-plugin', 'MULTI_PARAM', {})).toBe(
        '{{count}} tasks in {{project}}',
      );
    });

    it('should fallback to key when not in any language', () => {
      const result = service.translate('test-plugin', 'NONEXISTENT.KEY');
      expect(result).toBe('NONEXISTENT.KEY');
    });

    it('should interpolate single parameter', () => {
      const result = service.translate('test-plugin', 'WITH_PARAM', { name: 'John' });
      expect(result).toBe('Hello John');
    });

    it('should interpolate multiple parameters', () => {
      const result = service.translate('test-plugin', 'MULTI_PARAM', {
        count: 5,
        project: 'MyProject',
      });
      expect(result).toBe('5 tasks in MyProject');
    });

    it('should handle missing parameters gracefully', () => {
      const result = service.translate('test-plugin', 'WITH_PARAM', {});
      expect(result).toBe('Hello {{name}}');
    });

    it('should handle nested key lookup', () => {
      expect(service.translate('test-plugin', 'NESTED.KEY')).toBe('Nested value');
      expect(service.translate('test-plugin', 'NESTED.DEEP.VALUE')).toBe(
        'Very deep value',
      );
    });

    it('should handle malformed keys', () => {
      expect(service.translate('test-plugin', '')).toBe('');
      expect(service.translate('test-plugin', '.')).toBe('.');
      expect(service.translate('test-plugin', 'NESTED.')).toBe('NESTED.');
    });

    it('should handle non-existent plugin', () => {
      const result = service.translate('non-existent-plugin', 'SOME.KEY');
      expect(result).toBe('SOME.KEY');
    });
  });

  describe('language switching', () => {
    beforeEach(() => {
      const translations = {
        en: JSON.stringify({ GREETING: 'Hello' }),
        de: JSON.stringify({ GREETING: 'Hallo' }),
        fr: JSON.stringify({ GREETING: 'Bonjour' }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
    });

    it('should switch languages dynamically', () => {
      expect(service.getCurrentLanguage()).toBe('en');
      expect(service.translate('test-plugin', 'GREETING')).toBe('Hello');

      service.setCurrentLanguage('de');
      expect(service.getCurrentLanguage()).toBe('de');
      expect(service.translate('test-plugin', 'GREETING')).toBe('Hallo');

      service.setCurrentLanguage('fr');
      expect(service.getCurrentLanguage()).toBe('fr');
      expect(service.translate('test-plugin', 'GREETING')).toBe('Bonjour');
    });

    it('should update current language signal', () => {
      let signalValue = service.currentLanguage();
      expect(signalValue).toBe('en');

      service.setCurrentLanguage('de');
      signalValue = service.currentLanguage();
      expect(signalValue).toBe('de');
    });
  });

  describe('unloadPluginTranslations', () => {
    it('should remove plugin translations', () => {
      const translations = {
        en: JSON.stringify({ GREETING: 'Hello' }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
      expect(service.translate('test-plugin', 'GREETING')).toBe('Hello');

      service.unloadPluginTranslations('test-plugin');
      expect(service.translate('test-plugin', 'GREETING')).toBe('GREETING');
    });

    it('should handle unloading non-existent plugin', () => {
      expect(() => {
        service.unloadPluginTranslations('non-existent-plugin');
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty translation object', () => {
      const translations = {
        en: JSON.stringify({}),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
      expect(service.translate('test-plugin', 'ANY.KEY')).toBe('ANY.KEY');
    });

    it('should handle numeric values in parameters', () => {
      const translations = {
        en: JSON.stringify({ COUNT: 'Count: {{value}}' }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
      const result = service.translate('test-plugin', 'COUNT', { value: 42 });
      expect(result).toBe('Count: 42');
    });

    it('should handle zero as parameter value', () => {
      const translations = {
        en: JSON.stringify({ COUNT: 'Count: {{value}}' }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
      const result = service.translate('test-plugin', 'COUNT', { value: 0 });
      expect(result).toBe('Count: 0');
    });

    it('should handle empty string parameter', () => {
      const translations = {
        en: JSON.stringify({ MSG: 'Message: {{text}}' }),
      };

      service.loadPluginTranslationsFromContent('test-plugin', translations);
      const result = service.translate('test-plugin', 'MSG', { text: '' });
      expect(result).toBe('Message: ');
    });
  });
});
