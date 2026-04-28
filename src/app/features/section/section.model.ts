import { EntityState } from '@ngrx/entity';
import { WorkContextType } from '../work-context/work-context.model';

export interface Section {
  id: string;
  contextId: string;
  contextType: WorkContextType;
  title: string;
  taskIds: string[];
}

export interface SectionState extends EntityState<Section> {
  ids: string[];
}

export const MAX_SECTION_TITLE_LENGTH = 200;

// Authoritative title normalizer. Applied in the reducer so it survives
// remote sync replay — a peer cannot ship a multi-MB title that bypasses
// the cap by talking directly to the op-log.
export const sanitizeSectionTitle = (title: string): string =>
  title.trim().slice(0, MAX_SECTION_TITLE_LENGTH);
