import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostBinding,
  HostListener,
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

      :host(.is-fullscreen-shell) {
        --quick-add-hud-bg: var(--bg-lighter);

        min-width: 100vw;
        min-height: 100vh;
        background: color-mix(in srgb, var(--bg) 15%, transparent);
      }

      :host(.is-fullscreen-shell) add-task-bar.global {
        top: 15vh;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickAddRootComponent implements OnInit {
  readonly dataFacade = inject(QuickAddHudDataFacadeService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _isFullscreenShell =
    new URLSearchParams(window.location.search).get('quickAddFullscreenShell') === '1';

  @HostBinding('class.is-fullscreen-shell')
  get isFullscreenShell(): boolean {
    return this._isFullscreenShell;
  }

  ngOnInit(): void {
    void this.dataFacade.refreshSnapshot();
    const unsubscribe = this.dataFacade.onHudOpened(() => {
      void this.dataFacade.refreshSnapshot();
    });
    this._destroyRef.onDestroy(unsubscribe);
  }

  close(): void {
    if (IS_ELECTRON) {
      window.quickAdd.closeQuickAdd();
    }
  }

  @HostListener('document:click', ['$event'])
  closeOnShellClick(event: MouseEvent): void {
    if (!this._isFullscreenShell) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('add-task-bar') || target?.closest('.cdk-overlay-container')) {
      return;
    }

    this.close();
  }
}
