import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  Input,
  OnDestroy,
  OnInit,
  output,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { expandAnimation } from '../../../ui/animations/expand.ani';
import {
  ConfigFormSection,
  CustomCfgSection,
  GlobalConfigSectionKey,
} from '../global-config.model';
import { ProjectCfgFormKey } from '../../project/project.model';
import { Subscription } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { WorkContextService } from '../../work-context/work-context.service';
import { TagCfgFormKey } from '../../tag/tag.model';
import { customConfigFormSectionComponent } from '../custom-config-form-section-component';
import { exists } from '../../../util/exists';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { HelpSectionComponent } from '../../../ui/help-section/help-section.component';
import { ConfigFormComponent } from '../config-form/config-form.component';

interface CustomFormInstance {
  cfg?: Record<string, unknown>;
  section?: ConfigFormSection<Record<string, unknown>>;
  save?: { subscribe: (fn: (v: Record<string, unknown>) => void) => void };
}

@Component({
  selector: 'config-section',
  templateUrl: './config-section.component.html',
  styleUrls: ['./config-section.component.scss'],
  animations: expandAnimation,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CollapsibleComponent,
    HelpSectionComponent,
    ConfigFormComponent,
    TranslatePipe,
  ],
})
export class ConfigSectionComponent implements OnInit, OnDestroy {
  private _cd = inject(ChangeDetectorRef);
  private _workContextService = inject(WorkContextService);
  private _translateService = inject(TranslateService);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  @Input() section?: ConfigFormSection<Record<string, unknown>>;
  @Input() isExpanded: boolean = false;
  readonly save = output<{
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey | TagCfgFormKey;
    config: Record<string, unknown>;
  }>();
  readonly customFormRef = viewChild('customForm', { read: ViewContainerRef });
  private _subs: Subscription = new Subscription();
  private _instance?: CustomFormInstance;
  private _viewDestroyTimeout?: number;

  private _cfg: Record<string, unknown> | undefined;

  get cfg(): Record<string, unknown> | undefined {
    return this._cfg;
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set cfg(v: Record<string, unknown> | undefined) {
    this._cfg = v;
    if (v && this._instance) {
      this._instance.cfg = { ...v };
    }
  }

  ngOnInit(): void {
    if (this.section && this.section.customSection) {
      this._loadCustomSection(this.section.customSection);
    }

    // mark for check manually to make translations work with ngx formly
    this._subs.add(
      this._translateService.onLangChange.subscribe(() => {
        this._cd.detectChanges();
      }),
    );

    // mark for check manually to make it work with ngx formly
    this._subs.add(
      this._workContextService.onWorkContextChange$.subscribe(() => {
        this._cd.markForCheck();

        const customFormRef = this.customFormRef();
        if (
          this.section &&
          this.section.customSection &&
          customFormRef &&
          this.section.customSection
        ) {
          customFormRef.clear();
          // dirty trick to make sure data is actually there
          this._viewDestroyTimeout = window.setTimeout(() => {
            this._loadCustomSection(
              (this.section as ConfigFormSection<Record<string, unknown>>).customSection!,
            );
            this._cd.detectChanges();
          });
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
    if (this._viewDestroyTimeout) {
      window.clearTimeout(this._viewDestroyTimeout);
    }
  }

  onSave($event: {
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey | TagCfgFormKey;
    config: Record<string, unknown>;
  }): void {
    this.save.emit($event);
  }

  trackByIndex(i: number, p: unknown): number {
    return i;
  }

  private _loadCustomSection(customSection: CustomCfgSection): void {
    const componentToRender = customConfigFormSectionComponent(customSection);

    if (componentToRender) {
      const ref = exists<ViewContainerRef>(this.customFormRef()).createComponent(
        componentToRender,
      );

      const instance = ref.instance as CustomFormInstance;

      // NOTE: important that this is set only if we actually have a value
      // otherwise the default fallback will be overwritten
      if (this.cfg) {
        instance.cfg = this.cfg;
      }

      instance.section = this.section;

      if (instance.save) {
        instance.save.subscribe((v: Record<string, unknown>) => {
          this.onSave(
            v as {
              sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey | TagCfgFormKey;
              config: Record<string, unknown>;
            },
          );
          this._cd.detectChanges();
        });
      }
      this._instance = instance;
    }
  }
}
