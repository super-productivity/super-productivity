import { EntityState } from '@ngrx/entity';
import { WorkContextType } from '../work-context/work-context.model';

export interface Section {
  id: string;
  contextId: string;
  contextType: WorkContextType;
  title: string;
  isExpanded?: boolean;
  taskIds: string[];
}

export interface SectionState extends EntityState<Section> {
  ids: string[];
}
