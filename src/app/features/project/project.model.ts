import { IssueIntegrationCfgs, IssueProviderKey } from '../issue/issue.model';
import {
  WorkContextAdvancedCfgKey,
  WorkContextCommon,
} from '../work-context/work-context.model';
import { EntityState } from '@ngrx/entity';
// Import the unified Project type from plugin-api
import { Project as PluginProject } from '@super-productivity/plugin-api';

export type RoundTimeOption = '5M' | 'QUARTER' | 'HALF' | 'HOUR' | null | undefined;

export interface ProjectBasicCfg {
  title: string;
  // TODO remove maybe
  isArchived?: boolean;
  isHiddenFromMenu?: boolean;
  isEnableBacklog?: boolean;
  taskIds: string[];
  backlogTaskIds: string[];
  noteIds: string[];
}

// Omit conflicting properties from PluginProject when extending
export interface ProjectCopy
  extends
    Omit<PluginProject, 'advancedCfg' | 'theme'>,
    ProjectBasicCfg,
    WorkContextCommon {
  // Additional app-specific fields
  issueIntegrationCfgs?: IssueIntegrationCfgs;
}

export type Project = Readonly<ProjectCopy>;

export type ProjectCfgFormKey =
  | WorkContextAdvancedCfgKey
  | IssueProviderKey
  | 'basic'
  | 'theme';

export type ProjectState = EntityState<Project>;
