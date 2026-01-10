export type LogseqBlock = Readonly<{
  id: string; // UUID is used as the ID so tasks store the UUID as issueId
  uuid: string;
  content: string;
  marker: string | null;
  createdAt: number;
  updatedAt: number;
  page: { id: number };
  pageName?: string; // Page name fetched separately from API
  parent: { id: number } | null;
  properties: Record<string, any>;
}>;

export type LogseqBlockReduced = Readonly<{
  id: string; // UUID is used as the ID so tasks store the UUID as issueId
  uuid: string;
  content: string;
  marker: string | null;
  updatedAt: number;
  properties: Record<string, any>;
}>;
