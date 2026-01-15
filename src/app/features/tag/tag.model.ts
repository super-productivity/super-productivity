import { EntityState } from '@ngrx/entity';
import {
  WorkContextAdvancedCfgKey,
  WorkContextCommon,
} from '../work-context/work-context.model';

// Import the unified Tag type from plugin-api
import { Tag as PluginTag } from '@super-productivity/plugin-api';

// Omit conflicting properties from PluginTag when extending
export interface TagCopy
  extends Omit<PluginTag, 'advancedCfg' | 'theme'>, WorkContextCommon {
  // All fields already included in PluginTag
}

export type Tag = Readonly<TagCopy>;

export type TagState = EntityState<Tag>;

export type TagCfgFormKey = WorkContextAdvancedCfgKey | 'basic' | 'theme';
