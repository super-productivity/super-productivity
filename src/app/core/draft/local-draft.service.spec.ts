import { TestBed } from '@angular/core/testing';
import { DRAFT_LOAD_ERROR, LocalDraft, LocalDraftService } from './local-draft.service';
import { UserProfileService } from '../../features/user-profile/user-profile.service';
import { DEFAULT_PROFILE_ID } from '../../features/user-profile/user-profile.model';

describe('LocalDraftService', () => {
  let service: LocalDraftService;
  let activeProfileId: string | null;

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
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserProfileService,
          useValue: {
            activeProfile: () => (activeProfileId ? { id: activeProfileId } : null),
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
});
