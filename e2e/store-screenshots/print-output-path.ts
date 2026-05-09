import * as fs from 'fs';
import { MASTER_DIR_ELECTRON, MASTER_DIR_WEB } from './matrix';

const printOutputPath = (): void => {
  const dir =
    process.env.SCREENSHOT_MODE === 'electron' ? MASTER_DIR_ELECTRON : MASTER_DIR_WEB;
  const exists = fs.existsSync(dir);
  console.log(
    `\nMaster captures: ${dir}${exists ? '' : ' (not created — no scenarios ran)'}`,
  );
};

export default printOutputPath;
