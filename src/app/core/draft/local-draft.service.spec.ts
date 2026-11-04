import { TestBed } from '@angular/core/testing';
import {
  LOCAL_DRAFT_ENTITY_TYPES,
  DRAFT_MAX_CONTENT_LENGTH,
  DRAFT_RETENTION_MS,
  getDraftOpenAction,
  LocalDraft,
  LocalDraftService,
} from './local-draft.service';
import { LS_LOCAL_DRAFT_PREFIX } from '../persistence/storage-keys.const';
import { Log } from '../log';

describe('LocalDraftService', () => {
  let service: LocalDraftService;

  const keyFor = (entityId: string): string => `${LS_LOCAL_DRAFT_PREFIX}NOTE:${entityId}`;
  const legacyKeyFor = (profileId: string, entityId: string): string =>
    `${LS_LOCAL_DRAFT_PREFIX}${profileId}:NOTE:${entityId}`;

  const clearDraftKeys = (): void => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(LS_LOCAL_DRAFT_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sp_profile_data_'))
      .forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem('sp_profile_meta');
    localStorage.removeItem('sp_user_profiles_enabled');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LocalDraftService],
    });
    service = TestBed.inject(LocalDraftService);
    clearDraftKeys();
  });

  afterEach(() => {
    clearDraftKeys();
  });

  describe('save / load / clear', () => {
    it('round-trips a draft', () => {
      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'typed',
        baseContent: 'base',
      });

      const loaded = service.loadDraft('NOTE', 'n1');
      expect(loaded?.content).toBe('typed');
      expect(loaded?.baseContent).toBe('base');
      expect(typeof loaded?.updatedAt).toBe('number');
    });

    it('returns undefined when no draft exists', () => {
      expect(service.loadDraft('NOTE', 'nope')).toBeUndefined();
    });

    it('clearDraft removes the stored draft', () => {
      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'typed',
        baseContent: 'base',
      });

      service.clearDraft('NOTE', 'n1');

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
      expect(localStorage.getItem(keyFor('n1'))).toBeNull();
    });

    it('returns undefined for an unparseable stored value', () => {
      localStorage.setItem(keyFor('n1'), '{ not json');

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
    });

    it('never passes the raw value or its parse error to logging (draft text is user content)', () => {
      // V8 SyntaxErrors quote a fragment of the parsed input, and the log
      // history is exportable — the corrupt value must not travel with it.
      localStorage.setItem(keyFor('n1'), 'SECRET RAW NOTE TEXT');
      const errSpy = spyOn(Log, 'err');

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();

      const logged = errSpy.calls
        .allArgs()
        .flat()
        .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a)))
        .join(' ');
      expect(logged).not.toContain('SECRET RAW');
    });

    it('returns undefined for a value with a foreign shape', () => {
      localStorage.setItem(keyFor('n1'), JSON.stringify({ content: 'x' }));

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
    });

    it('does not throw when the write fails (e.g. quota exceeded)', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

      expect(() =>
        service.saveDraft({
          entityType: 'NOTE',
          entityId: 'n1',
          content: 'typed',
          baseContent: 'base',
        }),
      ).not.toThrow();
      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
    });
  });

  describe('size cap', () => {
    it('stores a draft exactly at the cap (content plus base)', () => {
      // Pins the strict `>` comparison and that BOTH fields count toward it.
      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'x'.repeat(DRAFT_MAX_CONTENT_LENGTH - 5),
        baseContent: 'y'.repeat(5),
      });

      expect(service.loadDraft('NOTE', 'n1')?.content.length).toBe(
        DRAFT_MAX_CONTENT_LENGTH - 5,
      );
    });

    it('does not store an oversized draft', () => {
      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'x'.repeat(DRAFT_MAX_CONTENT_LENGTH + 1),
        baseContent: '',
      });

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
    });

    it('drops a previously stored smaller draft once the content outgrows the cap', () => {
      // Without the removal, the stale small draft would be offered on the
      // next open while the actual latest text was never checkpointed.
      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'small',
        baseContent: 'base',
      });

      service.saveDraft({
        entityType: 'NOTE',
        entityId: 'n1',
        content: 'x'.repeat(DRAFT_MAX_CONTENT_LENGTH + 1),
        baseContent: 'base',
      });

      expect(service.loadDraft('NOTE', 'n1')).toBeUndefined();
    });
  });

  describe('deleteAllDrafts', () => {
    it('deletes every draft', () => {
      localStorage.setItem(keyFor('n1'), '{}');
      localStorage.setItem(keyFor('n2'), '{}');

      service.deleteAllDrafts();

      expect(localStorage.getItem(keyFor('n1'))).toBeNull();
      expect(localStorage.getItem(keyFor('n2'))).toBeNull();
    });
  });

  describe('pruneOnStart', () => {
    const storedDraft = (updatedAt: number): string =>
      JSON.stringify({ content: 'c', baseContent: 'b', updatedAt } as LocalDraft);

    it('keeps a draft exactly at the retention boundary', () => {
      // Pins the strict `<` comparison: exactly 14 days old is still offered.
      const now = Date.now();
      localStorage.setItem(keyFor('edge'), storedDraft(now - DRAFT_RETENTION_MS));

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('edge'))).not.toBeNull();
    });

    it('removes drafts past the retention window and keeps fresh ones', () => {
      const now = Date.now();
      localStorage.setItem(keyFor('old'), storedDraft(now - DRAFT_RETENTION_MS - 1));
      localStorage.setItem(keyFor('fresh'), storedDraft(now - 1000));

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('old'))).toBeNull();
      expect(localStorage.getItem(keyFor('fresh'))).not.toBeNull();
    });

    it('removes unparseable leftovers', () => {
      localStorage.setItem(keyFor('corrupt'), '{ not json');

      service.pruneOnStart();

      expect(localStorage.getItem(keyFor('corrupt'))).toBeNull();
    });

    it('leaves non-draft localStorage keys alone', () => {
      localStorage.setItem('SUP_SOMETHING_ELSE_TEST', 'keep me');

      service.pruneOnStart();

      expect(localStorage.getItem('SUP_SOMETHING_ELSE_TEST')).toBe('keep me');
      localStorage.removeItem('SUP_SOMETHING_ELSE_TEST');
    });

    it('keeps the active profile draft while removing legacy profile storage', () => {
      const now = Date.now();
      localStorage.setItem('sp_profile_meta', JSON.stringify({ activeProfileId: 'p1' }));
      localStorage.setItem('sp_user_profiles_enabled', 'true');
      localStorage.setItem('sp_profile_data_p1', 'active backup');
      localStorage.setItem('sp_profile_data_p2', 'inactive backup');
      localStorage.setItem(legacyKeyFor('p1', 'active'), storedDraft(now));
      localStorage.setItem(legacyKeyFor('p2', 'inactive'), storedDraft(now));

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('active'))).toBe(storedDraft(now));
      expect(localStorage.getItem(legacyKeyFor('p1', 'active'))).toBeNull();
      expect(localStorage.getItem(legacyKeyFor('p2', 'inactive'))).toBeNull();
      expect(localStorage.getItem('sp_profile_meta')).toBeNull();
      expect(localStorage.getItem('sp_user_profiles_enabled')).toBeNull();
      expect(localStorage.getItem('sp_profile_data_p1')).toBeNull();
      expect(localStorage.getItem('sp_profile_data_p2')).toBeNull();
    });

    // The overwhelmingly common cohort: never enabled profiles, so no metadata
    // was ever written and their drafts sit under the implicit 'default' id.
    it('migrates the default profile drafts when no legacy metadata exists', () => {
      const now = Date.now();
      localStorage.setItem(legacyKeyFor('default', 'n1'), storedDraft(now));

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('n1'))).toBe(storedDraft(now));
      expect(localStorage.getItem(legacyKeyFor('default', 'n1'))).toBeNull();
    });

    it('falls back to the default profile when legacy metadata is unparseable', () => {
      const now = Date.now();
      localStorage.setItem('sp_profile_meta', '{ not json');
      localStorage.setItem(legacyKeyFor('default', 'n1'), storedDraft(now));

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('n1'))).toBe(storedDraft(now));
      expect(localStorage.getItem('sp_profile_meta')).toBeNull();
    });

    it('lets an already-migrated draft win over its legacy twin', () => {
      const now = Date.now();
      const migrated = storedDraft(now);
      const legacy = storedDraft(now - 1000);
      localStorage.setItem(keyFor('n1'), migrated);
      localStorage.setItem(legacyKeyFor('default', 'n1'), legacy);

      service.pruneOnStart(now);

      expect(localStorage.getItem(keyFor('n1'))).toBe(migrated);
      expect(localStorage.getItem(legacyKeyFor('default', 'n1'))).toBeNull();
    });

    // Guards the drift the LOCAL_DRAFT_ENTITY_TYPES single source of truth
    // exists to prevent: a new-format key must never be read as a legacy one
    // and deleted, for EVERY declared entity type.
    it('treats a new-format key for every entity type as already migrated', () => {
      const now = Date.now();
      LOCAL_DRAFT_ENTITY_TYPES.forEach((entityType) => {
        localStorage.setItem(
          `${LS_LOCAL_DRAFT_PREFIX}${entityType}:kept`,
          storedDraft(now),
        );
      });

      service.pruneOnStart(now);

      LOCAL_DRAFT_ENTITY_TYPES.forEach((entityType) => {
        expect(localStorage.getItem(`${LS_LOCAL_DRAFT_PREFIX}${entityType}:kept`))
          .withContext(entityType)
          .toBe(storedDraft(now));
      });
    });

    // The migration's only error path: if the copy to the new key fails there
    // is nothing to fall back on, so it must leave the legacy draft AND the
    // metadata naming the active profile in place for a later attempt.
    describe('when the migrating write fails', () => {
      it('keeps the legacy draft and the metadata needed to retry', () => {
        const now = Date.now();
        localStorage.setItem(
          'sp_profile_meta',
          JSON.stringify({ activeProfileId: 'p1' }),
        );
        localStorage.setItem('sp_user_profiles_enabled', 'true');
        localStorage.setItem(legacyKeyFor('p1', 'n1'), storedDraft(now));
        spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

        expect(() => service.pruneOnStart(now)).not.toThrow();

        expect(localStorage.getItem(legacyKeyFor('p1', 'n1'))).toBe(storedDraft(now));
        expect(localStorage.getItem('sp_profile_meta')).not.toBeNull();
      });

      it('recovers the draft on the next start once the write succeeds', () => {
        const now = Date.now();
        localStorage.setItem(
          'sp_profile_meta',
          JSON.stringify({ activeProfileId: 'p1' }),
        );
        localStorage.setItem(legacyKeyFor('p1', 'n1'), storedDraft(now));

        const setItem = spyOn(Storage.prototype, 'setItem').and.throwError(
          'QuotaExceededError',
        );
        service.pruneOnStart(now);
        expect(localStorage.getItem(keyFor('n1'))).toBeNull();

        setItem.and.callThrough();
        service.pruneOnStart(now);

        expect(localStorage.getItem(keyFor('n1'))).toBe(storedDraft(now));
        expect(localStorage.getItem(legacyKeyFor('p1', 'n1'))).toBeNull();
        expect(localStorage.getItem('sp_profile_meta')).toBeNull();
      });
    });
  });
});

describe('getDraftOpenAction', () => {
  const draft = (content: string, baseContent: string): LocalDraft => ({
    content,
    baseContent,
    updatedAt: 0,
  });

  it('IGNOREs a draft whose text the entity already holds', () => {
    expect(getDraftOpenAction(draft('same', 'base'), 'same')).toBe('IGNORE');
  });

  it('IGNOREs even when base and entity also match (nothing to recover)', () => {
    expect(getDraftOpenAction(draft('same', 'same'), 'same')).toBe('IGNORE');
  });

  it('RESTOREs when the entity is unchanged since the edit session started', () => {
    expect(getDraftOpenAction(draft('typed', 'base'), 'base')).toBe('RESTORE');
  });

  it('PROMPTs when the entity changed underneath the draft', () => {
    expect(getDraftOpenAction(draft('typed', 'base'), 'changed elsewhere')).toBe(
      'PROMPT',
    );
  });
});
