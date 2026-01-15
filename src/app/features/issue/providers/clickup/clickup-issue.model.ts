// NOTE: This file is a consolidation of previous models and API responses
// All inline types have been extracted for better reusability and type safety.

export type ClickUpStatus = Readonly<{
  id?: string;
  status: string;
  type: string;
  orderindex: number;
  color: string;
}>;

export type ClickUpUser = Readonly<{
  id: number;
  username?: string | null;
  color: string;
  email: string;
  profilePicture: string | null;
  initials?: string; // Present in assignees but not always creator
}>;

export type ClickUpTag = Readonly<{
  name: string;
  tag_fg: string;
  tag_bg: string;
  creator: number;
}>;

export type ClickUpPriority = Readonly<{
  id: string;
  priority: string;
  color: string;
  orderindex: string;
}>;

export type ClickUpAttachment = Readonly<{
  id: string;
  date: string;
  title: string;
  type: number;
  source: number;
  version: number;
  extension: string;
  thumbnail_small: string;
  thumbnail_large: string;
  mimetype: string;
  hidden: boolean;
  parent_id: string;
  size: number;
  total_comments: number;
  url: string;
  url_w_query: string;
  url_w_host: string;
}>;

export type ClickUpTeam = Readonly<{
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  members: Array<{
    user: ClickUpUser;
  }>;
}>;

export type ClickUpTeamsResponse = Readonly<{
  teams: ClickUpTeam[];
}>;

export type ClickUpUserResponse = Readonly<{
  user: {
    id: number;
    username?: string | null;
    color: string;
    profilePicture: string | null;
  };
}>;

export type ClickUpTaskReduced = Readonly<{
  id: string;
  name: string;
  status: ClickUpStatus;
  date_updated: string; // unix timestamp in ms as string
  url: string;
  // Shared properties that might be useful in reduced view
  custom_id?: string | null;
}>;

export type ClickUpTask = ClickUpTaskReduced &
  Readonly<{
    custom_item_id?: number | null; // observed as 0 in sample
    text_content?: string | null;
    description?: string | null; // html
    markdown_description?: string | null;
    orderindex: string;
    date_created: string; // unix timestamp in ms as string
    date_closed: string | null; // unix timestamp in ms as string
    date_done: string | null;
    archived?: boolean;
    creator: ClickUpUser;
    assignees: ClickUpUser[];
    watchers: ClickUpUser[];
    tags: ClickUpTag[];
    parent: string | null;
    top_level_parent?: string | null;
    priority?: ClickUpPriority | null;
    due_date: string | null;
    start_date: string | null;
    points: number | null;
    time_estimate: number | null;
    time_spent?: number;
    team_id?: string;
    sharing?: {
      public: boolean;
      public_share_expires_on: string | null;
      public_fields: string[];
      token: string | null;
      seo_optimized: boolean;
    };
    permission_level?: string;
    list?: {
      id: string;
      name: string;
      access: boolean;
    };
    project?: {
      id: string;
      name: string;
      hidden: boolean;
      access: boolean;
    };
    folder?: {
      id: string;
      name: string;
      hidden: boolean;
      access: boolean;
    };
    space?: {
      id: string;
    };
    attachments?: ClickUpAttachment[];
    subtasks?: ClickUpTaskReduced[];
  }>;

export type ClickUpTaskSearchResponse = Readonly<{
  tasks: ClickUpTask[];
  last_page?: boolean;
}>;
