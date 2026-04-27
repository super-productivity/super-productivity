import { EntityState } from '@ngrx/entity';

export type SectionContextType = 'PROJECT' | 'TAG';

export interface Section {
  id: string;
  contextId: string;
  contextType: SectionContextType;
  title: string;
  taskIds: string[];
}

export interface SectionState extends EntityState<Section> {
  ids: string[];
}
