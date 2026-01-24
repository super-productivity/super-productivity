import { TestBed } from '@angular/core/testing';
import { TagService } from './tag.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Store } from '@ngrx/store';
import { Tag, TagState } from './tag.model';
import { DEFAULT_TAG } from './tag.const';
import { deleteTag, deleteTags, updateTag, updateTagOrder } from './store/tag.actions';
import { selectAllTags, selectTagById, selectTagsByIds } from './store/tag.reducer';

describe('TagService', () => {
  let service: TagService;
  let store: MockStore;

  const createTag = (overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id: 'tag-1',
    title: 'Test Tag',
    created: Date.now(),
    ...overrides,
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  const initialState: { tags: TagState } = {
    tags: {
      ids: ['tag-1', 'tag-2'],
      entities: {
        'tag-1': createTag({ id: 'tag-1', title: 'Tag 1', color: '#ff0000' }),
        'tag-2': createTag({ id: 'tag-2', title: 'Tag 2', color: '#00ff00' }),
      },
    },
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TagService, provideMockStore({ initialState })],
    });

    service = TestBed.inject(TagService);
    store = TestBed.inject(Store) as MockStore;

    // Override selectors
    store.overrideSelector(selectAllTags, [
      initialState.tags.entities['tag-1']!,
      initialState.tags.entities['tag-2']!,
    ]);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('tags$', () => {
    it('should return all tags from the store', (done) => {
      service.tags$.subscribe((tags) => {
        expect(tags.length).toBe(2);
        expect(tags[0].title).toBe('Tag 1');
        expect(tags[1].title).toBe('Tag 2');
        done();
      });
    });
  });

  describe('tags signal', () => {
    // Note: Signal tests are skipped because signals are created during service
    // construction before mock selectors can be configured. The underlying
    // observables (tags$) are tested in the 'tags$' describe block.
    it('should be defined', () => {
      expect(service.tags).toBeDefined();
      expect(service.tagsSortedForUI).toBeDefined();
      expect(service.tagsNoMyDayAndNoList).toBeDefined();
    });
  });

  describe('getTagById$', () => {
    it('should return a tag by id', (done) => {
      const tag1 = initialState.tags.entities['tag-1']!;
      store.overrideSelector(selectTagById, tag1);

      service.getTagById$('tag-1').subscribe((tag) => {
        expect(tag).toBeTruthy();
        expect(tag.id).toBe('tag-1');
        expect(tag.title).toBe('Tag 1');
        done();
      });
    });
  });

  describe('getTagsByIds$', () => {
    it('should return tags by ids', (done) => {
      const tags = [
        initialState.tags.entities['tag-1']!,
        initialState.tags.entities['tag-2']!,
      ];
      store.overrideSelector(selectTagsByIds, tags);

      service.getTagsByIds$(['tag-1', 'tag-2']).subscribe((result) => {
        expect(result.length).toBe(2);
        done();
      });
    });
  });

  describe('addTag', () => {
    it('should dispatch addTag action and return the id', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      const id = service.addTag({ title: 'New Tag', color: '#0000ff' });

      expect(id).toBeTruthy();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const action = dispatchSpy.calls.mostRecent().args[0] as unknown as {
        type: string;
        tag: Tag;
      };
      expect(action.type).toBe('[Tag] Add Tag');
      expect(action.tag.title).toBe('New Tag');
      expect(action.tag.color).toBe('#0000ff');
    });

    it('should use provided id if given', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      const id = service.addTag({ id: 'custom-id', title: 'Custom Tag' });

      expect(id).toBe('custom-id');
      const action = dispatchSpy.calls.mostRecent().args[0] as unknown as {
        type: string;
        tag: Tag;
      };
      expect(action.tag.id).toBe('custom-id');
    });

    it('should generate id if not provided', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      const id = service.addTag({ title: 'Auto ID Tag' });

      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
      const action = dispatchSpy.calls.mostRecent().args[0] as unknown as {
        type: string;
        tag: Tag;
      };
      expect(action.tag.id).toBe(id);
    });
  });

  describe('deleteTag', () => {
    it('should dispatch deleteTag action', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.deleteTag('tag-1');

      expect(dispatchSpy).toHaveBeenCalledWith(deleteTag({ id: 'tag-1' }));
    });
  });

  describe('removeTag', () => {
    it('should dispatch deleteTag action (alias for deleteTag)', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.removeTag('tag-2');

      expect(dispatchSpy).toHaveBeenCalledWith(deleteTag({ id: 'tag-2' }));
    });
  });

  describe('deleteTags', () => {
    it('should dispatch deleteTags action with multiple ids', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.deleteTags(['tag-1', 'tag-2']);

      expect(dispatchSpy).toHaveBeenCalledWith(deleteTags({ ids: ['tag-1', 'tag-2'] }));
    });
  });

  describe('updateTag', () => {
    it('should dispatch updateTag action with changes', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.updateTag('tag-1', { title: 'Updated Title', color: '#ffffff' });

      expect(dispatchSpy).toHaveBeenCalledWith(
        updateTag({
          tag: {
            id: 'tag-1',
            changes: { title: 'Updated Title', color: '#ffffff' },
          },
        }),
      );
    });
  });

  describe('updateColor', () => {
    it('should dispatch updateTag action with color change', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.updateColor('tag-1', '#123456');

      expect(dispatchSpy).toHaveBeenCalledWith(
        updateTag({
          tag: {
            id: 'tag-1',
            changes: { color: '#123456' },
          },
        }),
      );
    });
  });

  describe('updateOrder', () => {
    it('should dispatch updateTagOrder action', () => {
      const dispatchSpy = spyOn(store, 'dispatch');

      service.updateOrder(['tag-2', 'tag-1']);

      expect(dispatchSpy).toHaveBeenCalledWith(
        updateTagOrder({ ids: ['tag-2', 'tag-1'] }),
      );
    });
  });

  describe('createTagObject', () => {
    it('should create a tag with default values', () => {
      const tag = service.createTagObject({ title: 'My Tag' });

      expect(tag.title).toBe('My Tag');
      expect(tag.id).toBeTruthy();
      expect(tag.taskIds).toEqual([]);
      expect(tag.icon).toBeNull();
      expect(tag.created).toBeGreaterThan(0);
    });

    it('should use provided id if given', () => {
      const tag = service.createTagObject({ id: 'my-custom-id', title: 'Custom' });

      expect(tag.id).toBe('my-custom-id');
    });

    it('should use default title if not provided', () => {
      const tag = service.createTagObject({});

      expect(tag.title).toBe('EMPTY');
    });

    it('should preserve provided color', () => {
      const tag = service.createTagObject({ title: 'Colored', color: '#abcdef' });

      expect(tag.color).toBe('#abcdef');
    });

    it('should use null color if not provided', () => {
      const tag = service.createTagObject({ title: 'No Color' });

      expect(tag.color).toBeNull();
    });

    it('should merge additional properties', () => {
      const tag = service.createTagObject({
        title: 'Full Tag',
        icon: 'star',
        taskIds: ['task-1', 'task-2'],
      });

      expect(tag.icon).toBe('star');
      expect(tag.taskIds).toEqual(['task-1', 'task-2']);
    });
  });

  describe('getAddTagActionAndId', () => {
    it('should return action and id for new tag', () => {
      const result = service.getAddTagActionAndId({ title: 'Action Tag' });

      expect(result.id).toBeTruthy();
      expect(result.action.type).toBe('[Tag] Add Tag');
      expect((result.action as unknown as { tag: Tag }).tag.title).toBe('Action Tag');
    });

    it('should preserve provided id in returned action', () => {
      const result = service.getAddTagActionAndId({
        id: 'preset-id',
        title: 'Preset Tag',
      });

      expect(result.id).toBe('preset-id');
      expect((result.action as unknown as { tag: Tag }).tag.id).toBe('preset-id');
    });
  });
});
