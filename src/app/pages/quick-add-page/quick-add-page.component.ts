import { Component, HostListener, inject, OnInit } from '@angular/core';
import { AddTaskBarComponent } from '../../features/tasks/add-task-bar/add-task-bar.component';
import { LayoutService } from '../../core-ui/layout/layout.service';

@Component({
  selector: 'quick-add-page',
  standalone: true,
  imports: [AddTaskBarComponent],
  template: `
    <div class="quick-add-container">
      <add-task-bar
        (closed)="closeWindow()"
        (done)="closeWindow()"
        [isGlobalBarVariant]="false"
        [isSubmitViaIpc]="true"
      ></add-task-bar>
    </div>
  `,
  styles: [
    `
      .quick-add-container {
        padding: 12px;
        box-sizing: border-box;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
      }
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: transparent;
      }
    `,
  ],
})
export class QuickAddTaskPageComponent implements OnInit {
  private _layoutService = inject(LayoutService);

  ngOnInit(): void {
    this._layoutService.showAddTaskBar();
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
