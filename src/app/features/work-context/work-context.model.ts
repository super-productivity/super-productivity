import { WorklogExportSettings } from '../worklog/worklog.model';

// normally imported from here, but this includes non type files as well..
// import {HueValue} from 'angular-material-css-vars';
type HueValue =
  | '50'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900'
  | 'A100'
  | 'A200'
  | 'A400'
  | 'A700';

// TODO REMOVE OR MOVE AND LEGACY RENAME ALL THESE
export interface BreakTimeCopy {
  [key: string]: number;
}

export type BreakTime = Readonly<BreakTimeCopy>;

export interface BreakNrCopy {
  [key: string]: number;
}

export type BreakNr = Readonly<BreakNrCopy>;

export interface WorkStartEndCopy {
  [key: string]: number;
}

export type WorkStartEnd = Readonly<WorkStartEndCopy>;

export type WorkContextAdvancedCfg = Readonly<{
  worklogExportSettings: WorklogExportSettings;
}>;

// TODO handle more strictly
export type WorkContextThemeCfg = Readonly<{
  isAutoContrast?: boolean;
  isDisableBackgroundTint?: boolean;
  primary?: string;
  huePrimary?: HueValue;
  accent?: string;
  hueAccent?: HueValue;
  warn?: string;
  hueWarn?: HueValue;
  backgroundImageDark?: string | null;
  backgroundImageLight?: string | null;
  backgroundOverlayOpacity?: number;
}>;

export enum WorkContextType {
  PROJECT = 'PROJECT',
  TAG = 'TAG',
}

export interface WorkContextCommon {
  advancedCfg: WorkContextAdvancedCfg;
  theme: WorkContextThemeCfg;
  icon?: string | null;
  taskIds: string[];
  id: string;
  title: string;
}

export type WorkContextAdvancedCfgKey = keyof WorkContextAdvancedCfg;

export interface WorkContextCopy extends WorkContextCommon {
  icon?: string | null;
  routerLink: string;
  isEnableBacklog?: boolean;
  backlogTaskIds?: string[];
  noteIds: string[];
  type: WorkContextType;
}

export type WorkContext = Readonly<WorkContextCopy>;

export interface WorkContextState {
  activeId: string;
  activeType: WorkContextType;
  // additional entities state properties
}
