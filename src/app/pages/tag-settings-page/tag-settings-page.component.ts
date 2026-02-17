import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
} from '@angular/core';
import { T } from '../../t.const';
import {
  ConfigFormSection,
  GlobalConfigSectionKey,
} from '../../features/config/global-config.model';
import {
  WorkContext,
  WorkContextAdvancedCfg,
  WorkContextThemeCfg,
} from '../../features/work-context/work-context.model';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { Tag, TagCfgFormKey } from '../../features/tag/tag.model';
import { TagService } from '../../features/tag/tag.service';
import { ProjectCfgFormKey } from '../../features/project/project.model';
import { WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG } from '../../features/work-context/work-context.const';
import { BASIC_TAG_CONFIG_FORM_CONFIG } from '../../features/tag/tag-form-cfg.const';
import { distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isObject } from '../../util/is-object';
import { MatIcon } from '@angular/material/icon';
import { ConfigSectionComponent } from '../../features/config/config-section/config-section.component';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'tag-settings',
  templateUrl: './tag-settings-page.component.html',
  styleUrls: ['./tag-settings-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, ConfigSectionComponent, TranslatePipe],
})
export class TagSettingsPageComponent {
  readonly tagService = inject(TagService);
  readonly workContextService = inject(WorkContextService);
  private _cd = inject(ChangeDetectorRef);

  T: typeof T = T;
  tagThemeSettingsFormCfg: ConfigFormSection<WorkContextThemeCfg>;
  basicFormCfg: ConfigFormSection<Tag>;

  activeWorkContext: WorkContext | null = null;
  workContextAdvCfg: WorkContextAdvancedCfg | null = null;
  currentWorkContextTheme?: WorkContextThemeCfg;

  constructor() {
    // somehow they are only unproblematic if assigned here
    this.tagThemeSettingsFormCfg = WORK_CONTEXT_THEME_CONFIG_FORM_CONFIG;
    this.basicFormCfg = BASIC_TAG_CONFIG_FORM_CONFIG;

    this.workContextService.activeWorkContext$
      .pipe(
        distinctUntilChanged((a: WorkContext, b: WorkContext): boolean => {
          // needed because otherwise this wouldn't work while tracking time; see: #1428
          // NOTE: we don't need to worry about missing model changes since we only update single fields
          // (see save methods below)
          if (isObject(a) && isObject(b)) {
            return (
              a.title === b.title &&
              a.icon === b.icon &&
              JSON.stringify(a.theme) === JSON.stringify(b.theme) &&
              JSON.stringify(a.advancedCfg) === JSON.stringify(b.advancedCfg)
            );
          } else {
            return a === b;
          }
        }),
        takeUntilDestroyed(),
      )
      .subscribe((ac) => {
        this.activeWorkContext = ac;
        this.workContextAdvCfg = ac.advancedCfg;
        this.currentWorkContextTheme = ac.theme;
        this._cd.detectChanges();
      });
  }

  saveTagThemCfg($event: {
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey | TagCfgFormKey;
    config: WorkContextThemeCfg;
  }): void {
    if (!$event.config || this.activeWorkContext === null) {
      throw new Error('Not enough data');
    } else {
      this.tagService.updateTag(this.activeWorkContext.id, {
        theme: {
          ...$event.config,
        },
      });
    }
  }

  saveBasicSettings($event: {
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey | TagCfgFormKey;
    config: Tag;
  }): void {
    if (!$event.config || this.activeWorkContext === null) {
      throw new Error('Not enough data');
    } else {
      const { title, icon, color } = $event.config;
      this.tagService.updateTag(this.activeWorkContext.id, {
        title,
        icon,
        color,
      });
    }
  }
}
