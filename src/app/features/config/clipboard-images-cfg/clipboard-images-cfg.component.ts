import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  Input,
  OnInit,
  output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import {
  ClipboardImagesConfig,
  ConfigFormSection,
  GlobalConfigSectionKey,
} from '../global-config.model';
import { ProjectCfgFormKey } from '../../project/project.model';
import { IS_ELECTRON } from '../../../app.constants';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { DialogClipboardImagesManagerComponent } from './dialog-clipboard-images-manager/dialog-clipboard-images-manager.component';
import { getDefaultClipboardImagesPath } from '../../../util/get-default-clipboard-images-path';

@Component({
  selector: 'clipboard-images-cfg',
  templateUrl: './clipboard-images-cfg.component.html',
  styleUrls: ['./clipboard-images-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatIcon,
    TranslatePipe,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
  ],
})
export class ClipboardImagesCfgComponent implements OnInit {
  private readonly _matDialog = inject(MatDialog);
  private readonly _cd = inject(ChangeDetectorRef);

  private _cfg?: ClipboardImagesConfig;

  @Input()
  get cfg(): ClipboardImagesConfig | undefined {
    return this._cfg;
  }
  set cfg(value: ClipboardImagesConfig | undefined) {
    this._cfg = value;
    this.imagePath = value?.imagePath ?? null;
    this._cd.markForCheck();
  }
  @Input() section?: ConfigFormSection<ClipboardImagesConfig>;

  readonly save = output<{
    sectionKey: GlobalConfigSectionKey | ProjectCfgFormKey;
    config: ClipboardImagesConfig;
  }>();

  readonly T = T;
  readonly IS_ELECTRON = IS_ELECTRON;
  imagePath: string | null = null;
  defaultImagePath: string = '';

  async ngOnInit(): Promise<void> {
    this.imagePath = this.cfg?.imagePath ?? null;

    if (IS_ELECTRON) {
      await this.loadDefaultPath();
    }
  }

  private async loadDefaultPath(): Promise<void> {
    try {
      this.defaultImagePath = await getDefaultClipboardImagesPath();
      this._cd.markForCheck();
    } catch (error) {
      console.error('Error loading default clipboard image path:', error);
    }
  }

  openImageManager(): void {
    this._matDialog.open(DialogClipboardImagesManagerComponent, {
      width: '600px',
      maxHeight: '80vh',
    });
  }

  getImagePath(): string {
    return this.imagePath || this.defaultImagePath;
  }

  async selectImagePath(): Promise<void> {
    if (!IS_ELECTRON) return;

    const path = await window.ea.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: this.T.GCF.CLIPBOARD_IMAGES.SELECT_PATH_TITLE,
      defaultPath: this.getImagePath(),
    });

    if (path && path.length > 0) {
      this.imagePath = path[0];
      this.saveConfig();
    }
  }

  onImagePathChange(): void {
    this.saveConfig();
  }

  private saveConfig(): void {
    if (!this.section) return;

    this.save.emit({
      sectionKey: this.section.key,
      config: {
        imagePath: this.imagePath,
      },
    });
  }
}
