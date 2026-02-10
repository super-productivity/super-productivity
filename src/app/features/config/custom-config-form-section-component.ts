import { FileImexComponent } from '../../imex/file-imex/file-imex.component';
import { SimpleCounterCfgComponent } from '../simple-counter/simple-counter-cfg/simple-counter-cfg.component';
import { CustomCfgSection } from './global-config.model';
import { ClickUpAdditionalCfgComponent } from '../issue/providers/clickup/clickup-view-components/clickup-cfg/clickup-additional-cfg.component';
import { ClipboardImagesCfgComponent } from './clipboard-images-cfg/clipboard-images-cfg.component';
import { Type } from '@angular/core';

export const customConfigFormSectionComponent = (
  customSection: CustomCfgSection,
): Type<unknown> => {
  switch (customSection) {
    case 'FILE_IMPORT_EXPORT':
      return FileImexComponent;

    case 'SIMPLE_COUNTER_CFG':
      return SimpleCounterCfgComponent;

    case 'CLICKUP_CFG':
      return ClickUpAdditionalCfgComponent;

    case 'CLIPBOARD_IMAGES_CFG':
      return ClipboardImagesCfgComponent;

    default:
      throw new Error('Invalid component');
  }
};
