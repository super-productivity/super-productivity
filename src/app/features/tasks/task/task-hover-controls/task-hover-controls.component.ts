import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { TaskWithSubTasks } from '../../task.model';
import { T } from 'src/app/t.const';
import { IS_TOUCH_PRIMARY } from 'src/app/util/is-mouse-primary';
import { TaskComponent } from '../task.component';
import { TranslateModule } from '@ngx-translate/core';
import { KeyboardConfig } from '../../../config/keyboard-config.model';
import { ICAL_TYPE } from '../../../issue/issue.const';
import { MatIconButton } from '@angular/material/button';
import { GlobalConfigService } from '../../../config/global-config.service';

@Component({
  selector: 'task-hover-controls',
  imports: [MatIcon, TranslateModule, MatIconButton],
  templateUrl: './task-hover-controls.component.html',
  styleUrl: './task-hover-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskHoverControlsComponent {
  parent = inject<TaskComponent>(TaskComponent);
  private readonly _configService = inject(GlobalConfigService);

  task = input.required<TaskWithSubTasks>();
  isCurrent = input.required<boolean>();
  isSelected = input.required<boolean>();
  isShowAddToToday = input.required<boolean>();
  isShowRemoveFromToday = input.required<boolean>();
  isBacklog = input<boolean>(false);
  isInSubTaskList = input<boolean>(false);

  readonly isTimeTrackingEnabled = computed(() => {
    return this._configService.appFeatures().isTimeTrackingEnabled;
  });

  T: typeof T = T;
  IS_TOUCH_PRIMARY: boolean = IS_TOUCH_PRIMARY;

  get kb(): KeyboardConfig {
    return this.parent.kb;
  }

  protected readonly ICAL_TYPE = ICAL_TYPE;
}
