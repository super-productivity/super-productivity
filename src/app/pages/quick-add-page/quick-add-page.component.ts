import { Component, inject, OnInit } from '@angular/core';
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
        [isGlobalBarVariant]="true"
        [isSubmitViaIpc]="true"
      ></add-task-bar>
    </div>
  `,
  styles: [
    `
      .quick-add-container {
        padding: 16px;
        background: var(--bg);
        border-radius: 8px;
        box-shadow: var(--shadow-2);
        height: 100vh;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class QuickAddTaskPageComponent implements OnInit {
  private _layoutService = inject(LayoutService);

  ngOnInit(): void {
    this._layoutService.showAddTaskBar();
  }

  closeWindow(): void {
    if (window.ea) {
      window.ea.closeQuickAddWindow();
    }
  }
}
