import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Action } from '@ngrx/store';
import { Subject, Subscription } from 'rxjs';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { Log } from '../../core/log';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { setCurrentTask } from './store/task.actions';
import { TaskService } from './task.service';
import {
  TRACKING_BEFORE_CLOSE_ID,
  TaskTrackingLifecycleEffects,
} from './task-tracking-lifecycle.effects';

describe('TaskTrackingLifecycleEffects', () => {
  let effects: TaskTrackingLifecycleEffects;
  let task: jasmine.SpyObj<TaskService>;
  let writes: jasmine.SpyObj<OperationWriteFlushService>;
  let close: jasmine.SpyObj<ExecBeforeCloseService>;
  let actions: Subject<Action>;
  let ready: Subject<boolean>;
  let closing: Subject<string[]>;
  let subscriptions: Subscription;
  let documentStub: Document;
  let windowStub: EventTarget;

  const setup = (electron = false, native = false): void => {
    task = jasmine.createSpyObj<TaskService>('TaskService', [
      'flushAccumulatedTimeSpent',
      'setCurrentId',
      'currentTaskId',
    ]);
    writes = jasmine.createSpyObj<OperationWriteFlushService>('writes', [
      'flushPendingWrites',
    ]);
    writes.flushPendingWrites.and.resolveTo();
    actions = new Subject();
    ready = new Subject();
    closing = new Subject();
    close = jasmine.createSpyObj<ExecBeforeCloseService>(
      'close',
      ['schedule', 'setDone'],
      { onBeforeClose$: closing },
    );
    documentStub = document.implementation.createHTMLDocument();
    windowStub = new EventTarget();
    Object.defineProperty(documentStub, 'defaultView', { value: windowStub });
    TestBed.configureTestingModule({
      providers: [
        TaskTrackingLifecycleEffects,
        { provide: DOCUMENT, useValue: documentStub },
        { provide: IS_ELECTRON_TOKEN, useValue: electron },
        { provide: CapacitorPlatformService, useValue: { isNative: native } },
        { provide: TaskService, useValue: task },
        { provide: OperationWriteFlushService, useValue: writes },
        { provide: ExecBeforeCloseService, useValue: close },
        { provide: DataInitStateService, useValue: { isAllDataLoadedInitially$: ready } },
        { provide: LOCAL_ACTIONS, useValue: actions },
      ],
    });
    effects = TestBed.inject(TaskTrackingLifecycleEffects);
    subscriptions = new Subscription();
    subscriptions.add(effects.flushOnHide$.subscribe());
    subscriptions.add(effects.registerBeforeClose$.subscribe());
    subscriptions.add(effects.flushBeforeClose$.subscribe());
  };

  afterEach(() => subscriptions?.unsubscribe());

  const hide = (): void => {
    Object.defineProperty(documentStub, 'hidden', { configurable: true, value: true });
    documentStub.dispatchEvent(new Event('visibilitychange'));
  };

  it('flushes hidden pages without stopping tracking; ignores becoming visible', () => {
    setup();
    Object.defineProperty(documentStub, 'hidden', { configurable: true, value: false });
    documentStub.dispatchEvent(new Event('visibilitychange'));
    expect(task.flushAccumulatedTimeSpent).not.toHaveBeenCalled();
    hide();
    expect(task.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
    expect(task.setCurrentId).not.toHaveBeenCalled();
    expect(close.schedule).not.toHaveBeenCalled();
  });

  it('starts a best-effort flush before web unload', () => {
    setup();
    windowStub.dispatchEvent(new Event('beforeunload'));
    expect(task.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(1);
    expect(task.setCurrentId).not.toHaveBeenCalled();
  });

  it('leaves Android and iOS lifecycle handling alone', () => {
    setup(false, true);
    hide();
    windowStub.dispatchEvent(new Event('beforeunload'));
    ready.next(true);
    expect(task.flushAccumulatedTimeSpent).not.toHaveBeenCalled();
    expect(close.schedule).not.toHaveBeenCalled();
  });

  it('re-arms after a cancelled quit even if tracking restarts before the drain settles', fakeAsync(() => {
    setup(true);
    let complete!: () => void;
    writes.flushPendingWrites.and.returnValue(new Promise<void>((r) => (complete = r)));
    const currentTaskId = signal<string | null>('task');
    task.currentTaskId.and.callFake(currentTaskId);
    task.setCurrentId.and.callFake((id) => {
      currentTaskId.set(id);
    });
    const pendingIds = new Set<string>();
    close.schedule.and.callFake((id) => {
      pendingIds.add(id);
    });
    close.setDone.and.callFake((id) => {
      pendingIds.delete(id);
    });
    ready.next(true);
    actions.next(setCurrentTask({ id: 'task' }));
    expect(close.schedule).toHaveBeenCalledOnceWith(TRACKING_BEFORE_CLOSE_ID);
    closing.next([TRACKING_BEFORE_CLOSE_ID]);
    // The user cancels the finish-day dialog and resumes while writes still drain.
    currentTaskId.set('task');
    actions.next(setCurrentTask({ id: 'task' }));
    expect(close.setDone).not.toHaveBeenCalled();
    complete();
    flushMicrotasks();
    expect(pendingIds.has(TRACKING_BEFORE_CLOSE_ID)).toBeTrue();
    expect(close.schedule).toHaveBeenCalledTimes(2);

    // The next ordinary quit must drain again and must not re-arm itself.
    closing.next([...pendingIds]);
    flushMicrotasks();
    expect(writes.flushPendingWrites).toHaveBeenCalledTimes(2);
    expect(currentTaskId()).toBeNull();
    expect(pendingIds.size).toBe(0);
    expect(close.schedule).toHaveBeenCalledTimes(2);

    // Resuming after the drain has settled still re-arms as before.
    currentTaskId.set('task');
    actions.next(setCurrentTask({ id: 'task' }));
    expect(pendingIds.has(TRACKING_BEFORE_CLOSE_ID)).toBeTrue();

    // A second quit can arrive after cancelling/resuming but BEFORE the drain settles.
    const drains: Array<() => void> = [];
    writes.flushPendingWrites.and.callFake(
      () => new Promise<void>((resolve) => drains.push(resolve)),
    );
    closing.next([...pendingIds]);
    currentTaskId.set('task');
    actions.next(setCurrentTask({ id: 'task' }));
    closing.next([...pendingIds]);
    expect(currentTaskId()).toBeNull();
    expect(task.flushAccumulatedTimeSpent).toHaveBeenCalledTimes(4);
    expect(writes.flushPendingWrites).toHaveBeenCalledTimes(4);
    expect(close.setDone).toHaveBeenCalledTimes(2);
    // The first drain may finish before the resumed task's new writes.
    drains[0]();
    flushMicrotasks();
    expect(close.setDone).toHaveBeenCalledTimes(2);
    expect(pendingIds.has(TRACKING_BEFORE_CLOSE_ID)).toBeTrue();
    drains[1]();
    flushMicrotasks();
    expect(pendingIds.size).toBe(0);
    expect(close.setDone).toHaveBeenCalledTimes(3);
    expect(close.schedule).toHaveBeenCalledTimes(3);
  }));

  it('waits for all writes before acknowledging its own id alongside other handlers', fakeAsync(() => {
    setup(true);
    let complete!: () => void;
    writes.flushPendingWrites.and.returnValue(new Promise<void>((r) => (complete = r)));
    const order: string[] = [];
    task.setCurrentId.and.callFake(() => order.push('stop'));
    task.flushAccumulatedTimeSpent.and.callFake(() => order.push('flush'));
    closing.next(['SYNC_BEFORE_CLOSE', TRACKING_BEFORE_CLOSE_ID, 'FINISH_DAY']);
    closing.next([TRACKING_BEFORE_CLOSE_ID]);
    expect(order).toEqual(['stop', 'flush', 'stop', 'flush']);
    expect(writes.flushPendingWrites).toHaveBeenCalledTimes(2);
    expect(close.setDone).not.toHaveBeenCalled();
    complete();
    flushMicrotasks();
    expect(close.setDone).toHaveBeenCalledOnceWith(TRACKING_BEFORE_CLOSE_ID);
  }));

  it('ignores close requests for other handlers', () => {
    setup(true);
    closing.next(['SYNC_BEFORE_CLOSE']);
    expect(task.setCurrentId).not.toHaveBeenCalled();
    expect(writes.flushPendingWrites).not.toHaveBeenCalled();
  });

  it('allows quitting after a rejected write flush', fakeAsync(() => {
    setup(true);
    spyOn(Log, 'err');
    writes.flushPendingWrites.and.rejectWith(new Error('write failure'));
    closing.next([TRACKING_BEFORE_CLOSE_ID]);
    flushMicrotasks();
    expect(close.setDone).toHaveBeenCalledOnceWith(TRACKING_BEFORE_CLOSE_ID);
    expect(Log.err).toHaveBeenCalled();
  }));

  it('bounds its quit delay even when the write flush never settles', fakeAsync(() => {
    setup(true);
    spyOn(Log, 'err');
    writes.flushPendingWrites.and.returnValue(new Promise<void>(() => undefined));
    closing.next([TRACKING_BEFORE_CLOSE_ID]);
    tick(4999);
    expect(close.setDone).not.toHaveBeenCalled();
    // A new quit gets its own bounded wait; cancelling the old wait must not ack.
    closing.next([TRACKING_BEFORE_CLOSE_ID]);
    tick(4999);
    expect(close.setDone).not.toHaveBeenCalled();
    tick(1);
    expect(close.setDone).toHaveBeenCalledOnceWith(TRACKING_BEFORE_CLOSE_ID);
  }));
});
