import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { WorkContextEffects } from './work-context.effects';
import { provideMockStore } from '@ngrx/store/testing';
import { TaskService } from '../../tasks/task.service';
import { BannerService } from '../../../core/banner/banner.service';
import { Router } from '@angular/router';
import { WorkContextService } from '../work-context.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { setActiveWorkContext } from './work-context.actions';
import { selectActiveContextTypeAndId } from './work-context.selectors';
import { WorkContextType } from '../work-context.model';
import { TODAY_TAG } from '../../tag/tag.const';
import { Action } from '@ngrx/store';

describe('WorkContextEffects', () => {
  let effects: WorkContextEffects;
  let actions$: Observable<Action>;

  const createMockAppDataComplete = (
    projectEntities: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    project: {
      ids: Object.keys(projectEntities),
      entities: projectEntities,
    },
    task: { ids: [], entities: {} },
    tag: { ids: [], entities: {} },
    globalConfig: {},
  });

  describe('validateContextAfterDataLoad$', () => {
    describe('when active context is a PROJECT', () => {
      beforeEach(() => {
        TestBed.configureTestingModule({
          providers: [
            WorkContextEffects,
            provideMockActions(() => actions$),
            provideMockStore({
              selectors: [
                {
                  selector: selectActiveContextTypeAndId,
                  value: {
                    activeId: 'project-123',
                    activeType: WorkContextType.PROJECT,
                  },
                },
              ],
            }),
            {
              provide: TaskService,
              useValue: { isTaskDataLoaded$: of(true) },
            },
            {
              provide: BannerService,
              useValue: jasmine.createSpyObj('BannerService', ['dismiss']),
            },
            {
              provide: Router,
              useValue: { events: of(), url: '/' },
            },
            {
              provide: WorkContextService,
              useValue: {
                activeWorkContextTypeAndId$: of({
                  activeId: 'project-123',
                  activeType: WorkContextType.PROJECT,
                }),
              },
            },
          ],
        });

        effects = TestBed.inject(WorkContextEffects);
      });

      it('should redirect to TODAY when active project no longer exists in new data', (done) => {
        const appDataComplete = createMockAppDataComplete({
          otherProject: { id: 'otherProject', title: 'Other Project' },
        });
        actions$ = of(loadAllData({ appDataComplete: appDataComplete as any }));

        effects.validateContextAfterDataLoad$.subscribe((action) => {
          expect(action).toEqual(
            setActiveWorkContext({
              activeId: TODAY_TAG.id,
              activeType: WorkContextType.TAG,
            }),
          );
          done();
        });
      });

      it('should not dispatch action when active project still exists', (done) => {
        const appDataComplete = createMockAppDataComplete({
          /* eslint-disable-next-line @typescript-eslint/naming-convention */
          'project-123': { id: 'project-123', title: 'Test Project' },
        });
        actions$ = of(loadAllData({ appDataComplete: appDataComplete as any }));

        let actionDispatched = false;
        effects.validateContextAfterDataLoad$.subscribe(() => {
          actionDispatched = true;
        });

        // Give some time for potential emission
        setTimeout(() => {
          expect(actionDispatched).toBe(false);
          done();
        }, 50);
      });
    });

    describe('when active context is a TAG', () => {
      beforeEach(() => {
        TestBed.configureTestingModule({
          providers: [
            WorkContextEffects,
            provideMockActions(() => actions$),
            provideMockStore({
              selectors: [
                {
                  selector: selectActiveContextTypeAndId,
                  value: {
                    activeId: TODAY_TAG.id,
                    activeType: WorkContextType.TAG,
                  },
                },
              ],
            }),
            {
              provide: TaskService,
              useValue: { isTaskDataLoaded$: of(true) },
            },
            {
              provide: BannerService,
              useValue: jasmine.createSpyObj('BannerService', ['dismiss']),
            },
            {
              provide: Router,
              useValue: { events: of(), url: '/' },
            },
            {
              provide: WorkContextService,
              useValue: {
                activeWorkContextTypeAndId$: of({
                  activeId: TODAY_TAG.id,
                  activeType: WorkContextType.TAG,
                }),
              },
            },
          ],
        });

        effects = TestBed.inject(WorkContextEffects);
      });

      it('should not dispatch action when active context is a tag', (done) => {
        const appDataComplete = createMockAppDataComplete({});
        actions$ = of(loadAllData({ appDataComplete: appDataComplete as any }));

        let actionDispatched = false;
        effects.validateContextAfterDataLoad$.subscribe(() => {
          actionDispatched = true;
        });

        // Give some time for potential emission
        setTimeout(() => {
          expect(actionDispatched).toBe(false);
          done();
        }, 50);
      });
    });

    describe('when project data is missing', () => {
      beforeEach(() => {
        TestBed.configureTestingModule({
          providers: [
            WorkContextEffects,
            provideMockActions(() => actions$),
            provideMockStore({
              selectors: [
                {
                  selector: selectActiveContextTypeAndId,
                  value: {
                    activeId: 'project-123',
                    activeType: WorkContextType.PROJECT,
                  },
                },
              ],
            }),
            {
              provide: TaskService,
              useValue: { isTaskDataLoaded$: of(true) },
            },
            {
              provide: BannerService,
              useValue: jasmine.createSpyObj('BannerService', ['dismiss']),
            },
            {
              provide: Router,
              useValue: { events: of(), url: '/' },
            },
            {
              provide: WorkContextService,
              useValue: {
                activeWorkContextTypeAndId$: of({
                  activeId: 'project-123',
                  activeType: WorkContextType.PROJECT,
                }),
              },
            },
          ],
        });

        effects = TestBed.inject(WorkContextEffects);
      });

      it('should redirect to TODAY when project data is undefined', (done) => {
        const appDataComplete = { project: undefined } as any;
        actions$ = of(loadAllData({ appDataComplete }));

        effects.validateContextAfterDataLoad$.subscribe((action) => {
          expect(action).toEqual(
            setActiveWorkContext({
              activeId: TODAY_TAG.id,
              activeType: WorkContextType.TAG,
            }),
          );
          done();
        });
      });

      it('should redirect to TODAY when project entities is undefined', (done) => {
        const appDataComplete = { project: { ids: [], entities: undefined } } as any;
        actions$ = of(loadAllData({ appDataComplete }));

        effects.validateContextAfterDataLoad$.subscribe((action) => {
          expect(action).toEqual(
            setActiveWorkContext({
              activeId: TODAY_TAG.id,
              activeType: WorkContextType.TAG,
            }),
          );
          done();
        });
      });
    });
  });
});
