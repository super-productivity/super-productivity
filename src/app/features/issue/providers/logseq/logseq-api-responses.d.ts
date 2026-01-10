// Logseq HTTP API response types
export interface LogseqBlockEntityRaw {
  id: number;
  uuid: string;
  content: string;
  marker?: string;
  properties?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  page: { id: number };
  parent?: { id: number };
  children?: LogseqBlockEntityRaw[];
}

export interface LogseqApiResponse<T> {
  data: T;
  error?: string;
}
