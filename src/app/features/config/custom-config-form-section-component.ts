import { FileImexComponent } from '../../imex/file-imex/file-imex.component';
import { SimpleCounterCfgComponent } from '../simple-counter/simple-counter-cfg/simple-counter-cfg.component';
import { CustomCfgSection } from './global-config.model';
import { ClickUpAdditionalCfgComponent } from '../issue/providers/clickup/clickup-view-components/clickup-cfg/clickup-additional-cfg.component';

export const customConfigFormSectionComponent = (
  customSection: CustomCfgSection,
): unknown => {
  switch (customSection) {
    case 'FILE_IMPORT_EXPORT':
      return FileImexComponent;

    case 'SIMPLE_COUNTER_CFG':
      return SimpleCounterCfgComponent;

    case 'CLICKUP_CFG':
      return ClickUpAdditionalCfgComponent;

    default:
      throw new Error('Invalid component');
  }
};
