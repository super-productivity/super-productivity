import { createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { ArchiveModel } from '../archive.model';

export const ARCHIVE_YOUNG_FEATURE_NAME = 'archiveYoung';

export const initialArchiveYoungState: ArchiveModel | null = null;

export const archiveYoungReducer = createReducer<ArchiveModel | null>(
  initialArchiveYoungState,
  on(
    loadAllData,
    (_state, { appDataComplete }) =>
      (appDataComplete as { archiveYoung?: ArchiveModel | null }).archiveYoung ?? null,
  ),
);

export const selectArchiveYoungFeatureState = createFeatureSelector<ArchiveModel | null>(
  ARCHIVE_YOUNG_FEATURE_NAME,
);
