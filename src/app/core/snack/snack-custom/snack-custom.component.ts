import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { SnackParams } from '../snack.model';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressBar } from '@angular/material/progress-bar';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'snack-custom',
  templateUrl: './snack-custom.component.html',
  styleUrls: ['./snack-custom.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatButton, MatProgressBar, TranslatePipe],
})
export class SnackCustomComponent implements OnInit, OnDestroy {
  data = inject<SnackParams>(MAT_SNACK_BAR_DATA);
  snackBarRef = inject<MatSnackBarRef<SnackCustomComponent>>(MatSnackBarRef);

  private _subs: Subscription = new Subscription();

  ngOnInit(): void {
    if (this.data.promise) {
      this.data.promise.finally(() => {
        this.snackBarRef.dismiss();
      });
    }
    if (this.data.showWhile$) {
      this._subs.add(
        this.data.showWhile$.pipe(debounceTime(300)).subscribe((v) => {
          if (!v) {
            this.snackBarRef.dismiss();
          }
        }),
      );
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  actionClick(): void {
    if (this.data.actionFn) {
      this.data.actionFn();
    }
    this.snackBarRef.dismissWithAction();
  }

  close(): void {
    this.snackBarRef.dismissWithAction();
  }
}
