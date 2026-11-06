/**
 * Pins the file-saving guard installed in `src/test.ts`. Without it every spec
 * that reaches `download()` writes a real file into the browser's download
 * directory, which on a dev machine is the user's ~/Downloads.
 */
describe('test harness download guard', () => {
  it('should swallow a click on an anchor that saves a file', () => {
    const a = document.createElement('a');
    a.download = 'should-never-be-written.json';
    a.href = 'data:text/plain,x';
    let didFire = false;
    a.addEventListener('click', () => (didFire = true));

    a.click();

    expect(didFire).toBeFalse();
  });

  it('should leave a plain anchor click alone', () => {
    const a = document.createElement('a');
    let didFire = false;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      didFire = true;
    });

    a.click();

    expect(didFire).toBeTrue();
  });
});
