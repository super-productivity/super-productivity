import { WorklogService } from '../../../features/worklog/worklog.service';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { nanoid } from 'nanoid';
import { Task } from '../../../features/tasks/task.model';
import { TaskService } from '../../../features/tasks/task.service';
import { TimeSession } from '../../../features/time-session/time-session.model';
import { TimeSessionService } from '../../../features/time-session/time-session.service';
import {
  sessionClock,
  sessionStart,
} from '../../../features/time-session/time-session.util';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { InputDurationDirective } from '../../../ui/duration/input-duration.directive';
import { ProjectService } from '../../../features/project/project.service';
import { T } from '../../../t.const';

@Component({
  selector: 'daily-worklog-table',
  templateUrl: './daily-worklog-table.component.html',
  styleUrl: './daily-worklog-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButton,
    TranslatePipe,
    MsToClockStringPipe,
    InlineInputComponent,
    InputDurationDirective,
  ],
})
export class DailyWorklogTableComponent implements OnChanges {
  readonly T = T;
  readonly day = input.required<string>();
  readonly tasks = input<Task[]>([]);
  readonly workStart = input<number | null>();
  readonly workEnd = input<number | null>();
  readonly breakTime = input<number | null>();
  private readonly _tasks = inject(TaskService);
  private readonly _worklog = inject(WorklogService);
  private readonly _sessions = inject(TimeSessionService);
  private readonly _projects = inject(ProjectService);
  private readonly _activeTasks = toSignal(this._tasks.allTasks$, { initialValue: [] });
  readonly expanded = signal(false);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly editing = signal<{ taskId: string; session?: TimeSession } | null>(null);
  selectedTaskId = '';
  newTitle = '';
  start = '';
  end = '';
  duration = 0;

  readonly availableTasks = computed(() =>
    this._activeTasks().filter((t) => !t.subTaskIds.length),
  );
  readonly rows = computed(() => {
    const projects = new Map(this._projects.list().map((p) => [p.id, p.title]));
    return this.tasks()
      .filter((t) => !t.subTaskIds.length)
      .map((task) => {
        const sessions = (task.timeSessions ?? []).filter((s) => s.d === this.day());
        const total = task.timeSpentOnDay[this.day()] ?? 0;
        return {
          task,
          total,
          project: projects.get(task.projectId) ?? '',
          correction: total - sessions.reduce((sum, s) => sum + s.t, 0),
          sessions: sessions.map((session) => ({
            session,
            start: sessionClock(session),
            end: sessionClock(session, true),
          })),
        };
      });
  });
  readonly tracked = computed(() => this.rows().reduce((sum, row) => sum + row.total, 0));
  readonly net = computed(() => {
    const start = this.workStart();
    const end = this.workEnd();
    return start != null && end != null
      ? Math.max(0, end - start - (this.breakTime() ?? 0))
      : null;
  });
  readonly unallocated = computed(() =>
    this.net() === null ? null : this.net()! - this.tracked(),
  );

  edit(taskId: string, session: TimeSession): void {
    this.editing.set({ taskId, session });
    this.start = sessionClock(session);
    this.duration = session.t;
    this.end = sessionClock(session, true);
    this.error.set(false);
  }

  add(): void {
    this.editing.set({ taskId: '' });
    this.selectedTaskId = '';
    this.newTitle = '';
    this.start = '';
    this.end = '';
    this.duration = Math.max(0, this.unallocated() ?? 0);
    this.error.set(false);
  }

  onToggle(event: Event): void {
    this.expanded.set((event.target as HTMLDetailsElement).open);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['day']) this.editing.set(null);
  }

  updateEnd(): void {
    const start = sessionStart(this.day(), this.start, 0);
    this.end =
      start === undefined
        ? ''
        : sessionClock(
            { id: '', d: this.day(), s: start, t: Number(this.duration) || 0, o: 0 },
            true,
          );
  }

  updateDuration(): void {
    const start = sessionStart(this.day(), this.start, 0);
    const end = sessionStart(this.day(), this.end, 0);
    if (start !== undefined && end !== undefined) {
      this.duration = end >= start ? end - start : end - start + 86400000;
    }
  }

  async save(): Promise<void> {
    const editing = this.editing();
    if (!editing || this.busy()) return;
    const duration = Number(this.duration);
    const offset =
      editing.session?.o ??
      new Date(`${this.day()}T${this.start || '12:00'}`).getTimezoneOffset();
    const previous = editing.session;
    const offsetMs = offset * 60000;
    const calendarDay =
      previous?.s !== undefined
        ? new Date(previous.s - offsetMs).toISOString().slice(0, 10)
        : this.day();
    const start =
      previous && this.start === sessionClock(previous)
        ? previous.s
        : this.start
          ? sessionStart(calendarDay, this.start, offset)
          : undefined;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      (this.start && start === undefined)
    ) {
      this.error.set(true);
      return;
    }
    const session: TimeSession = {
      id: editing.session?.id ?? nanoid(),
      d: this.day(),
      t: duration,
      ...(start !== undefined && { s: start, o: offset }),
    };
    await this._perform(async () => {
      const taskId = editing.taskId || this.selectedTaskId;
      if (taskId) {
        await this._sessions.edit(taskId, this.day(), editing.session?.id, session);
      } else if (this.newTitle.trim()) {
        this._tasks.add(
          this.newTitle.trim(),
          false,
          {
            timeSpentOnDay: { [this.day()]: duration },
            timeSessions: [session],
            isDone: true,
            doneOn: Date.now(),
          },
          false,
          true,
        );
      } else {
        throw new Error('Task required');
      }
      this.editing.set(null);
    });
  }

  async remove(): Promise<void> {
    const editing = this.editing();
    if (!editing?.session) return;
    await this._perform(async () => {
      await this._sessions.edit(editing.taskId, this.day(), editing.session!.id);
      this.editing.set(null);
    });
  }

  async setTotal(taskId: string, value: string | number): Promise<void> {
    await this._perform(() => this._sessions.setTotal(taskId, this.day(), Number(value)));
  }

  private async _perform(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(false);
    try {
      await action();
      this._worklog.refreshWorklog();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
