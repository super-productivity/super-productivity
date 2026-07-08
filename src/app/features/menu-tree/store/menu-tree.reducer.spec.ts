import { menuTreeReducer } from './menu-tree.reducer';
import {
  MenuTreeFolderNode,
  MenuTreeKind,
  MenuTreeState,
  MenuTreeTreeNode,
} from './menu-tree.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { addTag, deleteTag, deleteTags } from '../../tag/store/tag.actions';
import { DEFAULT_TAG } from '../../tag/tag.const';
import { Tag } from '../../tag/tag.model';

describe('menuTreeReducer', () => {
  const createFolderNode = (
    id: string,
    children: MenuTreeTreeNode[] = [],
  ): MenuTreeFolderNode => ({
    k: MenuTreeKind.FOLDER,
    id,
    name: `Folder ${id}`,
    isExpanded: true,
    children,
  });

  const createProjectNode = (id: string): MenuTreeTreeNode => ({
    k: MenuTreeKind.PROJECT,
    id,
  });

  const createTagNode = (id: string): MenuTreeTreeNode => ({
    k: MenuTreeKind.TAG,
    id,
  });

  it('removes a top-level project node when deleteProject is dispatched', () => {
    const keepNode = createProjectNode('project-keep');
    const removeNode = createProjectNode('project-remove');
    const untouchedFolder = createFolderNode('folder-untouched');
    const state: MenuTreeState = {
      projectTree: [keepNode, removeNode, untouchedFolder],
      tagTree: [],
    };

    const result = menuTreeReducer(
      state,
      TaskSharedActions.deleteProject({
        projectId: 'project-remove',
        noteIds: [],
        allTaskIds: [],
      }),
    );

    expect(result.projectTree.length).toBe(2);
    expect(result.projectTree.some((node) => node.id === 'project-remove')).toBeFalse();
    expect(result.projectTree[0]).toBe(keepNode);
    expect(result.projectTree[1]).toBe(untouchedFolder);
  });

  it('removes a nested project node while keeping siblings intact', () => {
    const nestedKeep = createProjectNode('project-nested-keep');
    const nestedRemove = createProjectNode('project-nested-remove');
    const folder = createFolderNode('folder-parent', [nestedRemove, nestedKeep]);
    const state: MenuTreeState = {
      projectTree: [folder],
      tagTree: [],
    };

    const result = menuTreeReducer(
      state,
      TaskSharedActions.deleteProject({
        projectId: 'project-nested-remove',
        noteIds: [],
        allTaskIds: [],
      }),
    );

    expect(result.projectTree.length).toBe(1);
    const updatedFolder = result.projectTree[0] as MenuTreeFolderNode;
    expect(updatedFolder.id).toBe('folder-parent');
    expect(updatedFolder.children.length).toBe(1);
    expect(updatedFolder.children[0].id).toBe('project-nested-keep');
    expect(updatedFolder.children[0]).toBe(nestedKeep);
  });

  it('removes a tag from nested folder when deleteTag is dispatched', () => {
    const nestedKeep = createTagNode('tag-nested-keep');
    const nestedRemove = createTagNode('tag-nested-remove');
    const folder = createFolderNode('tag-folder', [nestedRemove, nestedKeep]);
    const state: MenuTreeState = {
      projectTree: [],
      tagTree: [folder],
    };

    const result = menuTreeReducer(
      state,
      deleteTag({
        id: 'tag-nested-remove',
      }),
    );

    expect(result.tagTree.length).toBe(1);
    const updatedFolder = result.tagTree[0] as MenuTreeFolderNode;
    expect(updatedFolder.id).toBe('tag-folder');
    expect(updatedFolder.children.length).toBe(1);
    expect(updatedFolder.children[0].id).toBe('tag-nested-keep');
    expect(updatedFolder.children[0]).toBe(nestedKeep);
  });

  it('removes multiple tags from the tree when deleteTags is dispatched', () => {
    const keepRoot = createTagNode('tag-keep-root');
    const removeRoot = createTagNode('tag-remove-root');
    const nestedKeep = createTagNode('tag-keep-nested');
    const nestedRemove = createTagNode('tag-remove-nested');
    const folder = createFolderNode('folder-tags', [nestedRemove, nestedKeep]);
    const state: MenuTreeState = {
      projectTree: [],
      tagTree: [keepRoot, removeRoot, folder],
    };

    const result = menuTreeReducer(
      state,
      deleteTags({
        ids: ['tag-remove-root', 'tag-remove-nested'],
      }),
    );

    expect(result.tagTree.length).toBe(2);
    expect(result.tagTree.some((node) => node.id === 'tag-remove-root')).toBeFalse();
    const updatedFolder = result.tagTree.find(
      (node) => node.id === 'folder-tags',
    ) as MenuTreeFolderNode;
    expect(updatedFolder.children.length).toBe(1);
    expect(updatedFolder.children[0].id).toBe('tag-keep-nested');
    expect(updatedFolder.children[0]).toBe(nestedKeep);
    expect(result.tagTree.find((node) => node.id === 'tag-keep-root')).toBe(keepRoot);
  });

  describe('addTag', () => {
    const createMockTag = (id: string): Tag => ({
      ...DEFAULT_TAG,
      id,
      title: `Tag ${id}`,
    });

    it('should add a new tag to tagTree when tag does not exist', () => {
      const existingTag = createTagNode('existing-tag');
      const state: MenuTreeState = {
        projectTree: [],
        tagTree: [existingTag],
      };

      const newTag = createMockTag('new-tag');
      const result = menuTreeReducer(state, addTag({ tag: newTag }));

      expect(result.tagTree.length).toBe(2);
      expect(result.tagTree[0]).toBe(existingTag);
      expect(result.tagTree[1]).toEqual({ k: MenuTreeKind.TAG, id: 'new-tag' });
    });

    it('should not add duplicate tag to tagTree when tag already exists', () => {
      const existingTag = createTagNode('existing-tag');
      const state: MenuTreeState = {
        projectTree: [],
        tagTree: [existingTag],
      };

      const tag = createMockTag('existing-tag');
      const result = menuTreeReducer(state, addTag({ tag }));

      expect(result.tagTree.length).toBe(1);
      expect(result).toBe(state);
    });

    it('should not add duplicate when tag exists inside folder', () => {
      const nestedTag = createTagNode('nested-tag');
      const folder = createFolderNode('folder-1', [nestedTag]);
      const state: MenuTreeState = {
        projectTree: [],
        tagTree: [folder],
      };

      const tag = createMockTag('nested-tag');
      const result = menuTreeReducer(state, addTag({ tag }));

      // Should not add since tag exists in folder
      expect(result.tagTree.length).toBe(1);
      expect(result).toBe(state);
    });

    it('should add tag when tagTree is empty', () => {
      const state: MenuTreeState = {
        projectTree: [],
        tagTree: [],
      };

      const newTag = createMockTag('first-tag');
      const result = menuTreeReducer(state, addTag({ tag: newTag }));

      expect(result.tagTree.length).toBe(1);
      expect(result.tagTree[0]).toEqual({ k: MenuTreeKind.TAG, id: 'first-tag' });
    });
  });
});
