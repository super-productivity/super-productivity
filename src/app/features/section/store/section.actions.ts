import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Section } from '../section.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const loadSections = createAction(
    '[Section] Load Sections',
    props<{ sections: Section[] }>(),
);

export const addSection = createAction(
    '[Section] Add Section',
    (section: { section: Section }) => ({
        ...section,
        meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: section.section.id,
            opType: OpType.Create,
        } satisfies PersistentActionMeta,
    }),
);

export const deleteSection = createAction(
    '[Section] Delete Section',
    (payload: { id: string }) => ({
        ...payload,
        meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: payload.id,
            opType: OpType.Delete,
        } satisfies PersistentActionMeta,
    }),
);

export const updateSection = createAction(
    '[Section] Update Section',
    (payload: { section: Update<Section> }) => ({
        ...payload,
        meta: {
            isPersistent: true,
            entityType: 'SECTION',
            entityId: payload.section.id as string,
            opType: OpType.Update,
        } satisfies PersistentActionMeta,
    }),
);

export const updateSectionOrder = createAction(
    '[Section] Update Section Order',
    (payload: { ids: string[] }) => ({
        ...payload,
        meta: {
            isPersistent: true,
            entityType: 'SECTION',
            // Uses ids[0] as random entity id reference, actual sync logic handles payload
            entityId: payload.ids[0],
            opType: OpType.Update,
        } satisfies PersistentActionMeta,
    }),
);
