// SPIKE: throwaway, do not merge
// A hard-coded view spec in the shape of the ai-view-builder plugin spec
// (packages/plugin-dev/ai-view-builder/src/core/spec.ts), trimmed to what the
// native spike renders. Board columns reuse the plugin's BoardColumn contract
// (tags / notTags / isDone) so the same JSON could drive both renderers.

export interface SpikeColumn {
  id: string;
  title: string;
  tags?: string[];
  notTags?: string[];
  isDone?: boolean;
}

export interface SpikeComponent {
  type: 'stack' | 'columns' | 'board' | 'agenda' | 'timeBreakdown' | 'metric';
  title?: string;
  children?: string[];
  columns?: SpikeColumn[];
  days?: number;
  rangeDays?: number;
}

export interface SpikeView {
  specVersion: number;
  title: string;
  root: string;
  components: Record<string, SpikeComponent>;
}

export const SPIKE_VIEW: SpikeView = {
  specVersion: 1,
  title: 'Native view spike',
  root: 'root',
  components: {
    root: { type: 'stack', children: ['summary', 'board', 'agenda'] },
    summary: { type: 'columns', children: ['remaining', 'time'] },
    remaining: { type: 'metric', title: 'Remaining estimate today' },
    time: { type: 'timeBreakdown', title: 'Time per project, last 7 days', rangeDays: 7 },
    board: {
      type: 'board',
      title: 'Kanban',
      columns: [
        { id: 'todo', title: 'To do', notTags: ['@doing'], isDone: false },
        { id: 'doing', title: 'Doing', tags: ['@doing'], isDone: false },
        { id: 'done', title: 'Done', isDone: true },
      ],
    },
    agenda: { type: 'agenda', title: 'Next 3 days', days: 3 },
  },
};
