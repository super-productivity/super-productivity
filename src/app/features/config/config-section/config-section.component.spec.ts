import {
  ComponentFixture,
  fakeAsync,
  flushMicrotasks,
  TestBed,
} from '@angular/core/testing';
import { EMPTY } from 'rxjs';
import { ConfigSectionComponent } from './config-section.component';
import { ConfigSectionAction } from '../global-config.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { TranslateService } from '@ngx-translate/core';
import { Log } from '../../../core/log';

describe('ConfigSectionComponent onAction', () => {
  let component: ConfigSectionComponent;
  let fixture: ComponentFixture<ConfigSectionComponent>;

  const makeAction = (onClick: ConfigSectionAction['onClick']): ConfigSectionAction => ({
    label: 'TEST.ACTION',
    onClick,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigSectionComponent],
      providers: [
        { provide: WorkContextService, useValue: { onWorkContextChange$: EMPTY } },
        {
          provide: TranslateService,
          useValue: { onLangChange: EMPTY, instant: (key: string) => key },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigSectionComponent);
    component = fixture.componentInstance;
    // NOTE: intentionally no detectChanges() — exercise the class logic in
    // isolation without rendering the heavy template / child components.
  });

  afterEach(() => fixture?.destroy());

  it('does not enter pending state for a synchronous (void) action', () => {
    const onClick = jasmine.createSpy('onClick');
    const action = makeAction(onClick);

    component.onAction(action);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(component.isActionPending(action)).toBe(false);
  });

  it('is pending while an async action runs and clears it on resolve', fakeAsync(() => {
    let resolve!: () => void;
    const onClick = jasmine
      .createSpy('onClick')
      .and.returnValue(new Promise<void>((res) => (resolve = res)));
    const action = makeAction(onClick);

    component.onAction(action);
    expect(component.isActionPending(action)).toBe(true);

    resolve();
    flushMicrotasks();
    expect(component.isActionPending(action)).toBe(false);
  }));

  it('ignores re-entry while the same action is pending (no double-fire)', fakeAsync(() => {
    let resolve!: () => void;
    const onClick = jasmine
      .createSpy('onClick')
      .and.returnValue(new Promise<void>((res) => (resolve = res)));
    const action = makeAction(onClick);

    component.onAction(action);
    component.onAction(action);

    expect(onClick).toHaveBeenCalledTimes(1);

    resolve();
    flushMicrotasks();
  }));

  it('clears pending state and logs when the async action rejects', fakeAsync(() => {
    const logSpy = spyOn(Log, 'err');
    let reject!: (err: unknown) => void;
    const action = makeAction(() => new Promise<void>((_res, rej) => (reject = rej)));

    component.onAction(action);
    expect(component.isActionPending(action)).toBe(true);

    reject(new Error('boom'));
    flushMicrotasks();

    expect(component.isActionPending(action)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  }));

  it('catches a synchronous throw without leaving pending state', () => {
    const logSpy = spyOn(Log, 'err');
    const action = makeAction(() => {
      throw new Error('sync boom');
    });

    expect(() => component.onAction(action)).not.toThrow();
    expect(component.isActionPending(action)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});
