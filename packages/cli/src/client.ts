import {
  HealthResponse,
  ListTasksOptions,
  Project,
  StatusResponse,
  Tag,
  Task,
  TaskCreateFields,
  TaskUpdateFields,
} from './types';

export class SuperProductivityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SuperProductivityError';
  }
}

export class AppNotRunningError extends Error {
  constructor() {
    super(
      'Could not connect to Super Productivity. Is the app running with the Local REST API enabled?',
    );
    this.name = 'AppNotRunningError';
  }
}

interface ApiSuccessBody {
  ok: true;
  data: unknown;
}

interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

type ApiBody = ApiSuccessBody | ApiErrorBody;

export class SuperProductivityClient {
  private readonly _baseUrl: string;

  constructor(baseUrl = 'http://127.0.0.1:3876') {
    this._baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // Health & Status
  // ---------------------------------------------------------------------------

  async health(): Promise<HealthResponse> {
    return this._get<HealthResponse>('/health');
  }

  async status(): Promise<StatusResponse> {
    return this._get<StatusResponse>('/status');
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  async listTasks(opts: ListTasksOptions = {}): Promise<Task[]> {
    const params = new URLSearchParams();
    if (opts.query) params.set('query', opts.query);
    if (opts.projectId) params.set('projectId', opts.projectId);
    if (opts.tagId) params.set('tagId', opts.tagId);
    if (opts.source) params.set('source', opts.source);
    if (opts.includeDone) params.set('includeDone', 'true');
    const qs = params.toString();
    return this._get<Task[]>(`/tasks${qs ? '?' + qs : ''}`);
  }

  async getTask(id: string): Promise<Task> {
    return this._get<Task>(`/tasks/${encodeURIComponent(id)}`);
  }

  async createTask(title: string, fields?: TaskCreateFields): Promise<Task> {
    return this._post<Task>('/tasks', { title, ...fields });
  }

  async updateTask(id: string, fields: TaskUpdateFields): Promise<Task> {
    return this._patch<Task>(`/tasks/${encodeURIComponent(id)}`, fields);
  }

  async deleteTask(id: string): Promise<void> {
    await this._delete(`/tasks/${encodeURIComponent(id)}`);
  }

  async archiveTask(id: string): Promise<void> {
    await this._post(`/tasks/${encodeURIComponent(id)}/archive`);
  }

  async restoreTask(id: string): Promise<Task> {
    return this._post<Task>(`/tasks/${encodeURIComponent(id)}/restore`);
  }

  // ---------------------------------------------------------------------------
  // Task Control (time tracking)
  // ---------------------------------------------------------------------------

  async getCurrentTask(): Promise<Task | null> {
    return this._get<Task | null>('/task-control/current');
  }

  async startTask(id: string): Promise<void> {
    await this._post(`/tasks/${encodeURIComponent(id)}/start`);
  }

  async stopTask(): Promise<void> {
    await this._post('/task-control/stop');
  }

  // ---------------------------------------------------------------------------
  // Projects & Tags
  // ---------------------------------------------------------------------------

  async listProjects(query?: string): Promise<Project[]> {
    const qs = query ? '?query=' + encodeURIComponent(query) : '';
    return this._get<Project[]>(`/projects${qs}`);
  }

  async listTags(query?: string): Promise<Tag[]> {
    const qs = query ? '?query=' + encodeURIComponent(query) : '';
    return this._get<Tag[]>(`/tags${qs}`);
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async _request<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this._baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string>),
        },
      });
    } catch {
      throw new AppNotRunningError();
    }

    const body = (await res.json()) as ApiBody;

    if (!body.ok) {
      const err = body.error;
      throw new SuperProductivityError(err.message, err.code, res.status, err.details);
    }

    return body.data as T;
  }

  private _get<T>(path: string): Promise<T> {
    return this._request<T>(path, { method: 'GET' });
  }

  private _post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this._request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private _patch<T>(path: string, body: unknown): Promise<T> {
    return this._request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  private _delete<T = unknown>(path: string): Promise<T> {
    return this._request<T>(path, { method: 'DELETE' });
  }
}
