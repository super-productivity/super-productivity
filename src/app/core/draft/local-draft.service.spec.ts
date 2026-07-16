import { TestBed } from '@angular/core/testing';
import { DRAFT_LOAD_ERROR, LocalDraft, LocalDraftService } from './local-draft.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { UserProfileStorageService } from '../../features/user-profile/user-profile-storage.service';
import { DEFAULT_PROFILE_ID } from '../../features/user-profile/user-profile.model';

describe('LocalDraftService', () => {
  let service: LocalDraftService;
  let activeProfileId: string | null;
  let persistedActiveProfileId: string | null;

  const uniqueId = (): string =>
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Unwraps the load-error sentinel so tests can dereference draft fields.
  const loadDraft = async (entityId: string): Promise<LocalDraft | undefined> => {
    const res = await service.loadDraft('NOTE', entityId);
    expect(res).not.toBe(DRAFT_LOAD_ERROR);
    return res === DRAFT_LOAD_ERROR ? undefined : res;
  };

  beforeEach(() => {
    activeProfileId = null;
    persistedActiveProfileId = null;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserProfileService,
          useValue: {
            activeProfile: () => (activeProfileId ? { id: activeProfileId } : null),
          },
        },
        {
          provide: UserProfileStorageService,
          useValue: {
            loadProfileMetadata: () =>
              Promise.resolve(
                persistedActiveProfileId
                  ? { activeProfileId: persistedActiveProfileId }
                  : null,
              ),
          },
        },
      ],
    });
    service = TestBed.inject(LocalDraftService);
  });

  it('should save and load a draft preserving content and baseContent', async () => {
    const entityId = uniqueId();
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'draft content',
      baseContent: 'base content',
    });

    const draft = await loadDraft(entityId);

    expect(draft?.content).toBe('draft content');
    expect(draft?.baseContent).toBe('base content');
    expect(draft?.entityType).toBe('NOTE');
    expect(draft?.entityId).toBe(entityId);
    await service.clearDraft('NOTE', entityId);
  });

  it('should return undefined when no draft exists', async () => {
    expect(await service.loadDraft('NOTE', uniqueId())).toBeUndefined();
  });

  it('should overwrite an existing draft on save', async () => {
    const entityId = uniqueId();
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'first',
      baseContent: 'base',
    });
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'second',
      baseContent: 'base',
    });

    const draft = await loadDraft(entityId);

    expect(draft?.content).toBe('second');
    await service.clearDraft('NOTE', entityId);
  });

  it('should clear a draft', async () => {
    const entityId = uniqueId();
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'draft content',
      baseContent: 'base content',
    });

    await service.clearDraft('NOTE', entityId);

    expect(await service.loadDraft('NOTE', entityId)).toBeUndefined();
  });

  it('should key drafts by the active profile', async () => {
    const entityId = uniqueId();
    activeProfileId = 'profile-a';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'profile a draft',
      baseContent: 'base',
    });

    activeProfileId = 'profile-b';
    expect(await service.loadDraft('NOTE', entityId)).toBeUndefined();

    activeProfileId = 'profile-a';
    const draft = await loadDraft(entityId);
    expect(draft?.content).toBe('profile a draft');
    expect(draft?.profileId).toBe('profile-a');
    await service.clearDraft('NOTE', entityId);
  });

  it('should fall back to the default profile id when no profile is active', async () => {
    const entityId = uniqueId();
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'draft content',
      baseContent: 'base content',
    });

    const draft = await loadDraft(entityId);

    expect(draft?.profileId).toBe(DEFAULT_PROFILE_ID);
    await service.clearDraft('NOTE', entityId);
  });

  it('should fail gracefully on a broken IndexedDB and retry once it recovers', async () => {
    const entityId = uniqueId();
    const openSpy = spyOn(indexedDB, 'open').and.throwError('IDB is broken');

    expect(await service.loadDraft('NOTE', entityId)).toBe(DRAFT_LOAD_ERROR);
    await expectAsync(
      service.saveDraft({
        entityType: 'NOTE',
        entityId,
        content: 'c',
        baseContent: 'b',
      }),
    ).toBeResolved();
    await expectAsync(service.clearDraft('NOTE', entityId)).toBeResolved();

    // Once IndexedDB works again the next operation retries instead of
    // reusing the cached failure.
    openSpy.and.callThrough();
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'recovered',
      baseContent: 'base',
    });
    const draft = await loadDraft(entityId);
    expect(draft?.content).toBe('recovered');
    await service.clearDraft('NOTE', entityId);
  });

  it('should key drafts to the persisted active profile when no profile is active in memory (feature disabled)', async () => {
    // Feature disabled: activeProfile() is null, but the last active profile id
    // is persisted. Drafts must key to it, not to DEFAULT_PROFILE_ID.
    const entityId = uniqueId();
    activeProfileId = null;
    persistedActiveProfileId = 'persisted-profile';

    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'draft content',
      baseContent: 'base content',
    });

    const draft = await loadDraft(entityId);
    expect(draft?.profileId).toBe('persisted-profile');
    expect(draft?.content).toBe('draft content');
    await service.clearDraft('NOTE', entityId);
  });

  it('should delete all drafts for a profile while preserving other profiles drafts', async () => {
    const idA = uniqueId();
    const idB = uniqueId();

    activeProfileId = 'profile-a';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: idA,
      content: 'a1',
      baseContent: 'base',
    });
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: idB,
      content: 'a2',
      baseContent: 'base',
    });

    activeProfileId = 'profile-b';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: idA,
      content: 'b1',
      baseContent: 'base',
    });

    await service.deleteDraftsForProfile('profile-a');

    // profile-a drafts are gone
    activeProfileId = 'profile-a';
    expect(await service.loadDraft('NOTE', idA)).toBeUndefined();
    expect(await service.loadDraft('NOTE', idB)).toBeUndefined();

    // profile-b draft survives
    activeProfileId = 'profile-b';
    const survivor = await loadDraft(idA);
    expect(survivor?.content).toBe('b1');
    await service.clearDraft('NOTE', idA);
  });

  it('should delete only the active profiles drafts on deleteDraftsForActiveProfile', async () => {
    const idA = uniqueId();
    const idB = uniqueId();

    activeProfileId = 'profile-a';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: idA,
      content: 'a',
      baseContent: 'base',
    });
    activeProfileId = 'profile-b';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: idB,
      content: 'b',
      baseContent: 'base',
    });

    // Only profile-b's dataset was replaced (import/restore runs against the
    // active profile), so profile-a's drafts must survive.
    await service.deleteDraftsForActiveProfile();

    activeProfileId = 'profile-b';
    expect(await service.loadDraft('NOTE', idB)).toBeUndefined();
    activeProfileId = 'profile-a';
    const survivor = await loadDraft(idA);
    expect(survivor?.content).toBe('a');
    await service.clearDraft('NOTE', idA);
  });

  it('should prune drafts past the retention window on open, keeping fresh ones', async () => {
    activeProfileId = 'profile-a';
    const freshId = uniqueId();
    const staleId = uniqueId();

    // Fresh draft via the normal path (updatedAt = now).
    await service.saveDraft({
      entityType: 'NOTE',
      entityId: freshId,
      content: 'fresh',
      baseContent: 'base',
    });

    // Stale draft written directly with an updatedAt older than the 14-day
    // retention window (saveDraft always stamps now, so it cannot create one).
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    await (service as any)._withRetryOnClose((db: any) =>
      db.put('drafts', {
        key: `profile-a:NOTE:${staleId}`,
        entityType: 'NOTE',
        entityId: staleId,
        profileId: 'profile-a',
        content: 'stale',
        baseContent: 'base',
        updatedAt: Date.now() - fifteenDaysMs,
      }),
    );

    // Trigger the once-per-session prune and let it finish (loadDraft fires it
    // fire-and-forget; here we await it deterministically).
    await (service as any)._pruneStaleDraftsOnce();

    expect(await service.loadDraft('NOTE', staleId)).toBeUndefined();
    const survivor = await loadDraft(freshId);
    expect(survivor?.content).toBe('fresh');
    await service.clearDraft('NOTE', freshId);
  });

  it('should prune at most once per session', async () => {
    activeProfileId = 'profile-a';
    const pruneSpy = spyOn(service as any, '_pruneStaleDrafts').and.callThrough();

    await (service as any)._pruneStaleDraftsOnce();
    await (service as any)._pruneStaleDraftsOnce();

    expect(pruneSpy).toHaveBeenCalledTimes(1);
  });

  it('should retry once and succeed when the connection closes mid-operation (iOS #6643)', async () => {
    // Seed a draft, then simulate the iOS "connection is closing" DOMException
    // on the first read; the retry-once wrapper must re-open and succeed.
    const entityId = uniqueId();
    activeProfileId = 'profile-a';
    await service.saveDraft({
      entityType: 'NOTE',
      entityId,
      content: 'survives',
      baseContent: 'base',
    });

    const closingError = new DOMException(
      "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
      'InvalidStateError',
    );
    // Fail the first get on the cached connection. The wrapper invalidates the
    // handle and re-opens a fresh connection (a new db instance, so this spy no
    // longer applies), whose real get returns the still-persisted draft. A
    // successful, correct result therefore can only happen via the retry — the
    // outer catch would otherwise surface DRAFT_LOAD_ERROR.
    const db = await (service as any)._ensureDb();
    const getSpy = spyOn(db, 'get').and.returnValue(Promise.reject(closingError));

    // loadDraft() already asserts the result is not DRAFT_LOAD_ERROR — reaching a
    // correct value proves the retry recovered rather than surfacing the error.
    const draft = await loadDraft(entityId);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(draft?.content).toBe('survives');
    await service.clearDraft('NOTE', entityId);
  });
});
