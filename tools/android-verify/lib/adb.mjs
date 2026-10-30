import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Thin `adb -s <serial>` wrapper; run.sh passes the resolved adb path as $ADB. */
export const createAdb = (serial) => {
  const bin = process.env.ADB || 'adb';
  const run = async (...args) => {
    const { stdout } = await execFileAsync(bin, ['-s', serial, ...args], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };
  return {
    serial,
    run,
    shell: (...args) => run('shell', ...args),
    /** Real touch through the input subsystem — unlike CDP input it counts as a user gesture. */
    tap: (x, y) =>
      run('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))),
    /**
     * Types through the device input pipeline. `input text` treats a space as an
     * argument separator, so spaces are sent as `%s`. adb joins the arguments
     * into one device shell command, so the value is single-quoted for it.
     */
    text: (value) =>
      run(
        'shell',
        'input',
        'text',
        `'${value.replace(/'/g, "'\\''").replace(/ /g, '%s')}'`,
      ),
    /** Whether the soft keyboard is up, per the input method service. */
    isImeShown: async () => {
      const dump = await run('shell', 'dumpsys', 'input_method');
      // `mInputShown` (system service) or `mIsInputViewShown` (IME service).
      return /mInputShown=true|isInputViewShown=true/i.test(dump);
    },
  };
};
