import { DEFAULT_BOARDS } from './boards.const';
import { buildViewFromTemplate, VIEW_TEMPLATES } from './view-templates';
import { IMPORTANT_TAG, IN_PROGRESS_TAG, URGENT_TAG } from '../tag/tag.const';
import { T } from '../../t.const';

describe('view templates', () => {
  const translate = (key: string): string => `t:${key}`;

  it('offers the Eisenhower Matrix and Kanban, titled with translation keys', () => {
    expect(VIEW_TEMPLATES.map((template) => template.title)).toEqual([
      T.F.BOARDS.DEFAULT.EISENHAUER_MATRIX,
      T.F.BOARDS.DEFAULT.KANBAN,
    ]);
  });

  it('builds the default board with fresh ids, empty order and the key as title', () => {
    const source = DEFAULT_BOARDS.find((board) => board.id === 'EISENHOWER_MATRIX')!;
    const { board } = buildViewFromTemplate('EISENHOWER_MATRIX', translate);
    expect(board.id).not.toBe(source.id);
    expect(board.title).toBe(T.F.BOARDS.DEFAULT.EISENHAUER_MATRIX);
    expect(board.cols).toBe(2);
    expect(board.panels.map((panel) => panel.title)).toEqual(
      source.panels.map((panel) => panel.title),
    );
    board.panels.forEach((panel, i) => {
      expect(panel.id).not.toBe(source.panels[i].id);
      expect(panel.taskIds).toEqual([]);
      expect(panel.includedTagIds).toEqual(source.panels[i].includedTagIds);
      expect(panel.includedTagIds).not.toBe(source.panels[i].includedTagIds);
    });
  });

  it('gives every use its own ids', () => {
    const first = buildViewFromTemplate('KANBAN', translate).board;
    const second = buildViewFromTemplate('KANBAN', translate).board;
    expect(second.id).not.toBe(first.id);
    const ids = [...first.panels, ...second.panels].map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns only the tags the rules name, with fixed ids and translated titles', () => {
    const matrixTags = buildViewFromTemplate('EISENHOWER_MATRIX', translate).tags;
    expect(matrixTags.map((tag) => tag.id)).toEqual([IMPORTANT_TAG.id, URGENT_TAG.id]);
    expect(matrixTags[0].title).toBe(`t:${IMPORTANT_TAG.title}`);

    const kanbanTags = buildViewFromTemplate('KANBAN', translate).tags;
    expect(kanbanTags.map((tag) => tag.id)).toEqual([IN_PROGRESS_TAG.id]);
  });
});
