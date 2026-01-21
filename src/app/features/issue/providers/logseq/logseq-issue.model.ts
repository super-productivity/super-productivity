export type LogseqBlock = Readonly<{
  id: string; // UUID is used as the ID so tasks store the UUID as issueId
  uuid: string;
  content: string;
  marker: string | null;
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
  properties: Record<string, any>;
  scheduledDate?: string | null; // Extracted YYYY-MM-DD from SCHEDULED: <date>
  scheduledDateTime?: number | null; // Extracted timestamp from SCHEDULED: <date time>
}>;
