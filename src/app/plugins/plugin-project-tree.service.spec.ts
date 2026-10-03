import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PluginProjectTreeService } from './plugin-project-tree.service';
import {
  MenuTreeFolderNode,
  MenuTreeKind,
  MenuTreeTreeNode,
} from '../features/menu-tree/store/menu-tree.model';
import {
  selectMenuTreeProjectTree,
  selectMenuTreeTagTree,
} from '../features/menu-tree/store/menu-tree.selectors';
import {
  selectAllProjects,
  selectUnarchivedProjects,
} from '../features/project/store/project.selectors';
import { selectAllTags } from '../features/tag/store/tag.reducer';
import { INBOX_PROJECT } from '../features/project/project.const';
import { Project } from '../features/project/project.model';

describe('PluginProjectTreeService', () => {
  let service: PluginProjectTreeService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  const project = (id: string): Project => ({ id, title: id }) as unknown as Project;
  const folder = (id: string, children: MenuTreeTreeNode[] = []): MenuTreeFolderNode => ({
    id,
    k: MenuTreeKind.FOLDER,
    name: `Folder ${id}`,
    isExpanded: false,
    children,
  });
  const projectNode = (id: string): MenuTreeTreeNode => ({ id, k: MenuTreeKind.PROJECT });

  const setState = (tree: MenuTreeTreeNode[], projects: Project[]): void => {
    store.overrideSelector(selectMenuTreeProjectTree, tree);
    store.overrideSelector(selectUnarchivedProjects, projects);
    store.refreshState();
  };

  const dispatchedTree = (): MenuTreeTreeNode[] =>
    (dispatchSpy.calls.mostRecent().args[0] as { tree: MenuTreeTreeNode[] }).tree;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideMockStore()],
    });
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectMenuTreeProjectTree, []);
    store.overrideSelector(selectMenuTreeTagTree, []);
    store.overrideSelector(selectUnarchivedProjects, []);
    store.overrideSelector(selectAllProjects, []);
    store.overrideSelector(selectAllTags, []);
    service = TestBed.inject(PluginProjectTreeService);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('getProjectTree', () => {
    it('returns nested folders with their projects in sidebar order', async () => {
      setState(
        [folder('f-1', [projectNode('p-2'), folder('f-2', [projectNode('p-3')])])],
        [project('p-2'), project('p-3')],
      );

      expect(await service.getProjectTree()).toEqual([
        {
          type: 'folder',
          id: 'f-1',
          name: 'Folder f-1',
          isExpanded: false,
          children: [
            { type: 'project', id: 'p-2' },
            {
              type: 'folder',
              id: 'f-2',
              name: 'Folder f-2',
              isExpanded: false,
              children: [{ type: 'project', id: 'p-3' }],
            },
          ],
        },
      ]);
    });

    it('drops stale project nodes, appends unplaced projects at the root and leaves out the Inbox', async () => {
      setState(
        [projectNode('deleted'), projectNode(INBOX_PROJECT.id)],
        [project(INBOX_PROJECT.id), project('p-1')],
      );

      expect(await service.getProjectTree()).toEqual([{ type: 'project', id: 'p-1' }]);
    });
  });

  describe('moveProjectsToFolders', () => {
    it('writes every move into one tree update', async () => {
      setState(
        [folder('f-1', [projectNode('p-1')]), folder('f-2'), projectNode('p-2')],
        [project('p-1'), project('p-2')],
      );

      await service.moveProjectsToFolders([
        { projectId: 'p-1', folderId: 'f-2' },
        { projectId: 'p-2', folderId: 'f-2' },
      ]);

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const [f1, f2] = dispatchedTree() as MenuTreeFolderNode[];
      expect(f1.children).toEqual([]);
      expect(f2.children.map((n) => n.id)).toEqual(['p-1', 'p-2']);
    });

    it('moves a project to the root with a null folderId', async () => {
      setState([folder('f-1', [projectNode('p-1')])], [project('p-1')]);

      await service.moveProjectsToFolders([{ projectId: 'p-1', folderId: null }]);

      expect(dispatchedTree().map((n) => n.id)).toEqual(['f-1', 'p-1']);
    });

    it('applies the last move when a project appears twice', async () => {
      setState([folder('f-1'), projectNode('p-1')], [project('p-1')]);

      await service.moveProjectsToFolders([
        { projectId: 'p-1', folderId: 'f-1' },
        { projectId: 'p-1', folderId: null },
      ]);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('does not reorder or write when every project is already in place', async () => {
      setState(
        [folder('f-1', [projectNode('p-1'), projectNode('p-2')]), projectNode('p-3')],
        [project('p-1'), project('p-2'), project('p-3'), project('p-4')],
      );

      await service.moveProjectsToFolders([
        { projectId: 'p-1', folderId: 'f-1' },
        { projectId: 'p-3', folderId: null },
        { projectId: 'p-4', folderId: null },
      ]);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('rejects the whole batch on an unknown folder id', async () => {
      setState([folder('f-1')], [project('p-1'), project('p-2')]);

      await expectAsync(
        service.moveProjectsToFolders([
          { projectId: 'p-1', folderId: 'f-1' },
          { projectId: 'p-2', folderId: 'missing' },
        ]),
      ).toBeRejectedWithError(/Unknown folder id: missing/);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('rejects unknown projects and the Inbox', async () => {
      setState([folder('f-1')], [project(INBOX_PROJECT.id)]);

      await expectAsync(
        service.moveProjectsToFolders([{ projectId: 'missing', folderId: 'f-1' }]),
      ).toBeRejectedWithError(/Unknown project id: missing/);
      await expectAsync(
        service.moveProjectsToFolders([{ projectId: INBOX_PROJECT.id, folderId: 'f-1' }]),
      ).toBeRejectedWithError(/Unknown project id/);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('rejects a malformed batch', async () => {
      setState([], []);

      await expectAsync(
        service.moveProjectsToFolders([{ projectId: 'p-1' }] as never),
      ).toBeRejected();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
