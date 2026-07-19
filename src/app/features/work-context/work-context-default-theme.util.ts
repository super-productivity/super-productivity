import { WorkContextThemeCfg, WorkContextType } from './work-context.model';
import { DEFAULT_TAG, IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../tag/tag.const';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';

/**
 * System entities ship a *distinct* theme, so falling back to the generic
 * default would silently restyle them — and where `auto-fix-typia-errors`
 * persists the value, permanently.
 *
 * A Map, not an object literal: a hostile entity id of `__proto__` resolves to
 * `Object.prototype` on a plain-object lookup, which is non-nullish and would
 * therefore be spread into an empty theme instead of falling through.
 *
 * IN_PROGRESS_TAG is deliberately absent: its theme differs from DEFAULT_TAG's
 * only in `backgroundImageDark` ('' vs null), and `isBackgroundImageSet` treats
 * both as unset — so a row for it could not change any rendered output.
 */
export const SYSTEM_ENTITY_THEMES: ReadonlyMap<string, WorkContextThemeCfg> = new Map(
  [TODAY_TAG, URGENT_TAG, IMPORTANT_TAG, INBOX_PROJECT].map(
    (e) => [e.id, e.theme] as const,
  ),
);

/**
 * The theme a work context should fall back to when it has none.
 *
 * Shared by the read side (`resolveContextTheme`) and the on-disk heal in
 * `auto-fix-typia-errors`. Those two must not diverge: hydration validates
 * without repairing, so a local-only user can render the read-side value for
 * many sessions before a repair ever runs — and TODAY is the active context at
 * startup (#9139).
 *
 * KNOWN RESIDUAL: `lwwUpdateMetaReducer`'s recreate branch is a third writer
 * and does NOT route through here — it spreads `RECREATE_FALLBACK[type].defaults`,
 * which is id-blind, so a system entity recreated from a partial LWW update
 * still gets the generic theme persisted. Narrow (needs a delete-vs-update race
 * on a system entity) and left alone deliberately: that file is sync-critical
 * and deserves its own change with its own convergence analysis.
 */
export const getDefaultWorkContextTheme = (
  type: WorkContextType,
  entityId: string,
): WorkContextThemeCfg =>
  SYSTEM_ENTITY_THEMES.get(entityId) ??
  (type === WorkContextType.TAG ? DEFAULT_TAG.theme : DEFAULT_PROJECT.theme);
