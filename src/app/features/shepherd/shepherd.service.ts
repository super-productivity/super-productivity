import { Injectable, inject } from '@angular/core';
import { first } from 'rxjs/operators';
import { SHEPHERD_STEPS, TourId } from './shepherd-steps.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskService } from '../tasks/task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { Router } from '@angular/router';
import { WorkContextService } from '../work-context/work-context.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

@Injectable({
  providedIn: 'root',
})
export class ShepherdService {
  private layoutService = inject(LayoutService);
  private taskService = inject(TaskService);
  private actions$ = inject(LOCAL_ACTIONS);
  private globalConfigService = inject(GlobalConfigService);
  private _router = inject(Router);
  private workContextService = inject(WorkContextService);

  isActive = false;
  tour?: any; // Will be Shepherd.Tour when loaded
  private _Shepherd?: typeof import('shepherd.js').default;

  async init(): Promise<void> {
    // Lazy load Shepherd.js only when needed
    if (!this._Shepherd) {
      const ShepherdModule = await import('shepherd.js');
      this._Shepherd = ShepherdModule.default;
    }
    this._initialize();

    const cfg = await this.globalConfigService.cfg$.pipe(first()).toPromise();
    this.addSteps(
      SHEPHERD_STEPS(
        this,
        cfg,
        this.actions$,
        this.layoutService,
        this.taskService,
        this._router,
        this.workContextService,
      ) as any,
    );
    this.start();
    // this.show('XXX' as TourId);
    // this.show(TourId.Projects as TourId);
  }

  async show(id: TourId): Promise<void> {
    if (!this.isActive) {
      await this.init();
    }
    if (id !== TourId.ProductivityHelper && id !== TourId.StartTourAgain) {
      await this._router.navigateByUrl('/');
    }

    this.tour?.show(id);
  }

  back(): void {
    this.tour?.back();
  }

  cancel(): void {
    this.tour?.cancel();
  }

  complete(): void {
    this.tour?.complete();
  }

  hide(): void {
    this.tour?.hide();
  }

  next(): void {
    this.tour?.next();
  }

  start(): void {
    this.isActive = true;
    this.tour?.start();
  }

  /**
   * Take a set of steps and create a tour object based on the current configuration
   * @param steps An array of steps
   */
  addSteps(steps: Array<any>): void {
    this._initialize();
    const tour = this.tour;
    if (!tour) {
      throw new Error('Tour not ready');
    }

    steps.forEach((step) => {
      if (step.buttons) {
        step.buttons = step.buttons.map(this._makeButton.bind(this), this);
      }
      const prevWhenShow = step.when?.show;
      if (!step.when) {
        step.when = {};
      }
      step.when.show = () => {
        // We do this since we don't want the default focus behavior
        const el = tour.getCurrentStep()?.getElement();
        if (el) {
          (el as any).focus = () => undefined;
        }
        if (typeof prevWhenShow === 'function') {
          // @ts-ignore
          prevWhenShow();
        }
      };
      tour.addStep(step);
    });
  }

  private _initialize(): void {
    if (!this._Shepherd) {
      throw new Error('Shepherd not loaded');
    }
    // Prevent multiple initialization of the same tour
    if (this.tour) {
      return;
    }
    const tourObject = new this._Shepherd.Tour({
      defaultStepOptions: {
        scrollTo: false,
        highlightClass: 'shepherd-highlight',
        arrow: true,
        cancelIcon: {
          enabled: true,
        },
        buttons: [],
      },
      confirmCancel: false,
      keyboardNavigation: false,
      tourName: 'Cool tour',
      useModalOverlay: false,
      exitOnEsc: false,
    });
    tourObject.on('complete', this._onTourFinish.bind(this, 'complete'));
    tourObject.on('cancel', this._onTourFinish.bind(this, 'cancel'));
    this.tour = tourObject;
  }

  private _makeButton(button): any {
    const { classes, disabled, label, secondary, type, text } = button;
    const builtInButtonTypes = ['back', 'cancel', 'next'];

    if (!type) {
      return button;
    }

    if (builtInButtonTypes.indexOf(type) === -1) {
      throw new Error(`'type' property must be one of 'back', 'cancel', or 'next'`);
    }

    return {
      action: this[type].bind(this),
      classes,
      disabled,
      label,
      secondary,
      text,
    };
  }

  private _onTourFinish(completeOrCancel: string): void {
    this.isActive = false;
  }
}
