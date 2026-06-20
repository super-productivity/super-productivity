import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { AddTaskBarComponent } from './add-task-bar.component';
import { IS_ELECTRON } from '../../../app.constants';
import { QuickAddHudDataFacadeService } from './quick-add-hud-data-facade.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AddTaskBarComponent],
  template: `
    @if (dataFacade.isReady()) {
      <add-task-bar
        class="global"
        [isGlobalBarVariant]="true"
        (closed)="close()"
        (done)="close()"
      ></add-task-bar>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickAddRootComponent implements OnInit {
  readonly dataFacade = inject(QuickAddHudDataFacadeService);
  private readonly _destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    void this.dataFacade.refreshSnapshot();
    const unsubscribe = this.dataFacade.onHudOpened(() => {
      void this.dataFacade.refreshSnapshot();
    });
    this._destroyRef.onDestroy(unsubscribe);
  }

  close(): void {
    if (IS_ELECTRON) {
      window.ea.closeQuickAdd();
    }
  }
}
