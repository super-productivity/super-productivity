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

  it('should prune the oldest drafts beyond the 200-entry cap', async () => {
    activeProfileId = 'profile-a';
    // Write 201 fresh drafts (all inside the retention window) with strictly
    // increasing updatedAt so "oldest" is well-defined. saveDraft always stamps
    // now(), so write directly to control the age.
    const base = Date.now();
    const ids = Array.from({ length: 201 }, () => uniqueId());
    await (service as any)._withRetryOnClose(async (db: any) => {
      for (let i = 0; i < ids.length; i++) {
        await db.put('drafts', {
          key: `profile-a:NOTE:${ids[i]}`,
          entityType: 'NOTE',
          entityId: ids[i],
          profileId: 'profile-a',
          content: `c${i}`,
          baseContent: 'base',
          updatedAt: base + i,
        });
      }
    });

    await (service as any)._pruneStaleDraftsOnce();

    // The single oldest survivor is evicted to hold the cap; the newest stays.
    // Delete the DRAFT_MAX_ENTRIES overflow slice and all 201 remain -> red.
    expect(await service.loadDraft('NOTE', ids[0])).toBeUndefined();
    const newest = await loadDraft(ids[ids.length - 1]);
    expect(newest?.content).toBe('c200');

    await (service as any)._withRetryOnClose(async (db: any) => {
      for (const id of ids) {
        await db.delete('drafts', `profile-a:NOTE:${id}`);
      }
    });
  });

  it('should run the prune when triggered through the public loadDraft() (not just the private method)', async () => {
    activeProfileId = 'profile-a';
    const staleId = uniqueId();
    const otherId = uniqueId();
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

    // Public API only: loadDraft fires the once-per-session prune fire-and-forget.
    // Remove the `void this._pruneStaleDraftsOnce()` wiring line from loadDraft
    // and _prunePromise stays undefined, the stale draft survives -> red.
    await service.loadDraft('NOTE', otherId);
    await (service as any)._prunePromise;

    expect(await service.loadDraft('NOTE', staleId)).toBeUndefined();
  });

  it('should prune on app start via the public pruneOnStart()', async () => {
    activeProfileId = 'profile-a';
    const staleId = uniqueId();
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

    await service.pruneOnStart();

    expect(await service.loadDraft('NOTE', staleId)).toBeUndefined();
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

  describe('clearDraftIfContent (owned-content clear)', () => {
    it('clears the draft when the stored content still matches', async () => {
      activeProfileId = 'profile-a';
      const id = uniqueId();
      await service.saveDraft({
        entityType: 'NOTE',
        entityId: id,
        content: 'v1',
        baseContent: 'base',
      });

      await service.clearDraftIfContent('NOTE', id, 'v1');

      expect(await service.loadDraft('NOTE', id)).toBeUndefined();
    });

    it("leaves a newer session's draft under the same key when content no longer matches", async () => {
      activeProfileId = 'profile-a';
      const id = uniqueId();
      // Session B has checkpointed newer content Y under the shared key while an
      // older lifecycle A still believes it owns X. A's clear must NOT delete Y.
      await service.saveDraft({
        entityType: 'NOTE',
        entityId: id,
        content: 'Y-newer',
        baseContent: 'base',
      });

      await service.clearDraftIfContent('NOTE', id, 'X-older');

      // A key-only clear would have destroyed Y here; the content-conditional
      // clear no-ops on the mismatch (#8982 review).
      const survivor = await loadDraft(id);
      expect(survivor?.content).toBe('Y-newer');
      await service.clearDraft('NOTE', id);
    });

    it('is a safe no-op when the draft is already gone', async () => {
      activeProfileId = 'profile-a';
      await expectAsync(
        service.clearDraftIfContent('NOTE', uniqueId(), 'whatever'),
      ).toBeResolved();
    });
  });

  it('does not prune a stale draft that is concurrently refreshed (atomic select+delete)', async () => {
    activeProfileId = 'profile-a';
    const staleId = uniqueId();
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    // Seed a draft old enough to be pruned.
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

    // Fire the prune and a concurrent refresh of the SAME key. The prune's single
    // read-write transaction serializes against the save: the save lands either
    // fully before the prune (fresh in the snapshot -> survives) or fully after
    // it (re-created fresh). Either way the refreshed draft must survive. The old
    // getAll-then-separate-delete code could delete the refreshed key.
    await Promise.all([
      (service as any)._pruneStaleDrafts(),
      service.saveDraft({
        entityType: 'NOTE',
        entityId: staleId,
        content: 'refreshed',
        baseContent: 'base',
      }),
    ]);

    const survivor = await loadDraft(staleId);
    expect(survivor?.content).toBe('refreshed');
    await service.clearDraft('NOTE', staleId);
  });
});
