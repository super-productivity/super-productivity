import { createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { ArchiveModel } from '../archive.model';

export const ARCHIVE_OLD_FEATURE_NAME = 'archiveOld';

export const initialArchiveOldState: ArchiveModel | null = null;

export const archiveOldReducer = createReducer<ArchiveModel | null>(
  initialArchiveOldState,
  on(
    loadAllData,
    (_state, { appDataComplete }) =>
      (appDataComplete as { archiveOld?: ArchiveModel | null }).archiveOld ?? null,
  ),
);

export const selectArchiveOldFeatureState = createFeatureSelector<ArchiveModel | null>(
  ARCHIVE_OLD_FEATURE_NAME,
);
