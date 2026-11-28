import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GlobalProgressBarService } from './global-progress-bar.service';
import { fadeAnimation } from '../../ui/animations/fade.ani';
import { MatProgressBar } from '@angular/material/progress-bar';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'global-progress-bar',
  templateUrl: './global-progress-bar.component.html',
  styleUrls: ['./global-progress-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fadeAnimation],
  imports: [MatProgressBar, AsyncPipe],
})
export class GlobalProgressBarComponent {
  globalProgressBarService = inject(GlobalProgressBarService);
}
