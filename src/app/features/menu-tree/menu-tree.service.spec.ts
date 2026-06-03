import { TestBed } from '@angular/core/testing';
import { MenuTreeService } from './menu-tree.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MenuTreeKind, MenuTreeTreeNode } from './store/menu-tree.model';
import { menuTreeFeatureKey } from './store/menu-tree.reducer';
import {
  selectMenuTreeProjectTree,
  selectMenuTreeTagTree,
} from './store/menu-tree.selectors';

describe('MenuTreeService', () => {
  let service: MenuTreeService;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MenuTreeService,
        provideMockStore({
          initialState: {
            [menuTreeFeatureKey]: {
              projectTree: [],
              tagTree: [],
            },
          },
        }),
      ],
    });

    service = TestBed.inject(MenuTreeService);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('projectFolderMap', () => {
    it('should map projects to their parent paths with chevrons', () => {
      const mockProjectTree: MenuTreeTreeNode[] = [
        {
          id: 'folder-1',
          k: MenuTreeKind.FOLDER,
          name: 'Folder 1',
          children: [
            {
              id: 'project-1',
              k: MenuTreeKind.PROJECT,
            },
            {
              id: 'subfolder-1',
              k: MenuTreeKind.FOLDER,
              name: 'Subfolder A',
              children: [
                {
                  id: 'project-2',
                  k: MenuTreeKind.PROJECT,
                },
              ],
            },
          ],
        },
        {
          id: 'project-3',
          k: MenuTreeKind.PROJECT,
        },
      ];

      store.overrideSelector(selectMenuTreeProjectTree, mockProjectTree);
      store.refreshState();

      const folderMap = service.projectFolderMap();
      expect(folderMap.get('project-1')).toBe('Folder 1');
      expect(folderMap.get('project-2')).toBe('Folder 1 › Subfolder A');
      expect(folderMap.get('project-3')).toBeUndefined();
    });
  });

  describe('tagFolderMap', () => {
    it('should map tags to their parent paths with chevrons', () => {
      const mockTagTree: MenuTreeTreeNode[] = [
        {
          id: 'folder-2',
          k: MenuTreeKind.FOLDER,
          name: 'Folder 2',
          children: [
            {
              id: 'tag-1',
              k: MenuTreeKind.TAG,
            },
          ],
        },
      ];

      store.overrideSelector(selectMenuTreeTagTree, mockTagTree);
      store.refreshState();

      const folderMap = service.tagFolderMap();
      expect(folderMap.get('tag-1')).toBe('Folder 2');
    });
  });
});
