import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { Subscription } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { Log } from '../../core/log';

@Component({
  selector: 'formly-translated-template',
  templateUrl: './formly-translated-template.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyTranslatedTemplateComponent
  extends FieldType
  implements OnInit, OnDestroy
{
  private _translateService = inject(TranslateService);

  readonly tplWrapper = viewChild<ElementRef>('tplWrapper');

  private _el?: HTMLElement;
  private _subs: Subscription = new Subscription();

  ngOnInit(): void {
    if (!this.field.templateOptions) {
      throw new Error();
    }
    this._createTag();

    const translationId = this.field.templateOptions.text;
    if (!translationId) {
      Log.err('No translation id provided');
      return;
    }

    this._subs.add(
      this._translateService.stream(translationId).subscribe((translationString) => {
        (this._el as HTMLElement).innerHTML = translationString;
      }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  private _createTag(): void {
    const tplWrapper = this.tplWrapper();
    if (!this.field.templateOptions || !tplWrapper) {
      throw new Error();
    }
    const tag = this.field.templateOptions.tag || 'div';
    const tplWrapperEl = tplWrapper.nativeElement;

    if (tplWrapperEl) {
      this._el = document.createElement(tag);

      if (this.field.templateOptions.class) {
        (this._el as HTMLElement).classList.add(this.field.templateOptions.class);
      }

      tplWrapper.nativeElement.append(this._el);
    }
  }
}
