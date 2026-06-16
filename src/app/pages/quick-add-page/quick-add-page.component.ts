import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';
import { AddTaskBarComponent } from '../../features/tasks/add-task-bar/add-task-bar.component';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { OverlayContainer } from '@angular/cdk/overlay';

@Component({
  selector: 'quick-add-page',
  standalone: true,
  imports: [AddTaskBarComponent],
  template: `
    <div class="quick-add-container">
      <add-task-bar
        #addTaskBar
        (closed)="closeWindow()"
        [isGlobalBarVariant]="true"
        [isSubmitViaIpc]="true"
      ></add-task-bar>
    </div>
  `,
  styles: [
    `
      .quick-add-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding-top: 15vh;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }
      add-task-bar {
        width: 640px;
        max-width: 90vw;
      }
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.15);
      }
    `,
  ],
})
export class QuickAddTaskPageComponent implements OnInit, OnDestroy {
  private _layoutService = inject(LayoutService);
  private _overlayContainer = inject(OverlayContainer);

  addTaskBar = viewChild.required(AddTaskBarComponent);

  ngOnInit(): void {
    this._overlayContainer.getContainerElement().classList.add('quick-add-overlay');
    this._layoutService.showAddTaskBar();
  }

  ngOnDestroy(): void {
    this._overlayContainer.getContainerElement().classList.remove('quick-add-overlay');
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.addTaskBar().focusInput(true);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const addTaskBar = target.closest('add-task-bar');
    const overlayContainer = target.closest('.cdk-overlay-container');
    // If clicked outside add-task-bar and not on autocomplete options/dropdowns, close
    if (!addTaskBar && !overlayContainer) {
      this.closeWindow();
    }
  }

  closeWindow(): void {
    if (window.ea) {
      window.ea.closeQuickAddWindow();
    }
  }
}
