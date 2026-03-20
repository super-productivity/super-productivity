import { EntityState } from '@ngrx/entity';

export type TeamIssuePriority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

export type TeamIssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'cancelled';

export type TeamMemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  role: TeamMemberRole;
}

export interface TeamProject {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  status: 'active' | 'paused' | 'archived';
  leadId?: string | null;
  createdAt: number;
}

export interface TeamLabel {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
}

export interface TeamCycle {
  id: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'active' | 'completed';
}

export interface TeamComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamTimeEntry {
  id: string;
  issueId: string;
  userId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  source: 'sp_app' | 'web' | 'manual';
  spTaskId?: string;
}

export interface TeamIssue {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  description?: string;
  status: TeamIssueStatus;
  priority: TeamIssuePriority;
  assigneeId?: string | null;
  creatorId: string;
  parentId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  sortOrder: number;
  labelIds: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface TeamState extends EntityState<TeamIssue> {
  isConnected: boolean;
  lastSyncAt: number | null;
  activeWorkspaceId: string | null;
  workspaces: TeamWorkspace[];
  projects: TeamProject[];
  members: TeamMember[];
  labels: TeamLabel[];
  cycles: TeamCycle[];
  isSyncing: boolean;
}
