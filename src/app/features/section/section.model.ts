import { EntityState } from '@ngrx/entity';

export interface Section {
    id: string;
    projectId: string | null;
    title: string;
}

export interface SectionState extends EntityState<Section> {
    ids: string[];
}
