import { downloadPluginTextFile, savePluginBinaryFile } from './plugin-file-download';

describe('plugin binary file download in a browser', () => {
  it('requests a download with the original bytes and name, without claiming OS opening', async () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:fixture');
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    const revoke = spyOn(URL, 'revokeObjectURL');
    jasmine.clock().install();
    try {
      const result = await savePluginBinaryFile({
        filename: 'Смета.pdf',
        data: bytes.buffer,
        openAfterSave: true,
      });
      expect(result).toEqual({ kind: 'download-requested', openStatus: 'unavailable' });
      expect(
        new Uint8Array(await (create.calls.mostRecent().args[0] as Blob).arrayBuffer()),
      ).toEqual(bytes);
      const anchor = click.calls.mostRecent().object as HTMLAnchorElement;
      expect(anchor.download).toBe('Смета.pdf');
      expect(anchor.href).toBe('blob:fixture');
      expect(document.body.contains(anchor)).toBeFalse();
      expect(revoke).not.toHaveBeenCalled();
      jasmine.clock().tick(60000);
      expect(revoke).toHaveBeenCalledOnceWith('blob:fixture');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('rejects an invalid payload before creating a download', async () => {
    const create = spyOn(URL, 'createObjectURL');
    const maxBytes = 10 * 1024 * 1024;
    await expectAsync(
      savePluginBinaryFile({ filename: '../x.pdf', data: new ArrayBuffer(0) }),
    ).toBeRejected();
    await expectAsync(
      savePluginBinaryFile({
        filename: 'x.pdf',
        data: new ArrayBuffer(maxBytes + 1),
      }),
    ).toBeRejected();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the legacy text download contract', async () => {
    const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:legacy');
    spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(URL, 'revokeObjectURL');
    expect(await downloadPluginTextFile('старый.txt', 'исходный текст')).toBeUndefined();
    expect(await (create.calls.mostRecent().args[0] as Blob).text()).toBe(
      'исходный текст',
    );
  });
});
