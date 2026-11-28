import { TestBed } from '@angular/core/testing';
import { CustomSoundStorageService } from './custom-sound-storage.service';

const makeAudioFile = (name: string, sizeBytes = 100): File => {
  // A minimal but structurally valid placeholder.
  const data = new Uint8Array(sizeBytes).fill(0);
  return new File([data], name, { type: 'audio/mpeg' });
};

describe('CustomSoundStorageService', () => {
  let service: CustomSoundStorageService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [CustomSoundStorageService] });
    service = TestBed.inject(CustomSoundStorageService);
    // Wipe any entries left over from prior runs in the same Karma session.
    const all = await service.listSounds();
    for (const s of all) {
      await service.removeSound(s.id);
    }
  });

  it('should install a file and expose it via the sounds signal', async () => {
    const file = makeAudioFile('my-bell.mp3');
    const stored = await service.installFromFile(file);

    expect(stored.id).toBe('my-bell');
    expect(stored.name).toBe('my-bell');
    expect(stored.arrayBuffer.byteLength).toBe(100);
    expect(service.sounds().length).toBe(1);
    expect(service.sounds()[0].id).toBe('my-bell');
  });

  it('should round-trip install / list / get', async () => {
    await service.installFromFile(makeAudioFile('alpha.mp3'));
    await service.installFromFile(makeAudioFile('beta.ogg', 200));

    const all = await service.listSounds();
    expect(all.map((s) => s.id).sort()).toEqual(['alpha', 'beta']);

    const fetched = await service.getSound('alpha');
    expect(fetched).toBeDefined();
    expect(fetched!.arrayBuffer.byteLength).toBe(100);
  });

  it('should overwrite an existing entry when re-uploading the same slug', async () => {
    await service.installFromFile(makeAudioFile('ping.mp3', 50));
    await service.installFromFile(makeAudioFile('ping.mp3', 150));

    const all = await service.listSounds();
    expect(all.length).toBe(1);
    expect(all[0].arrayBuffer.byteLength).toBe(150);
  });

  it('should remove a sound and update the signal', async () => {
    await service.installFromFile(makeAudioFile('remove-me.mp3'));
    expect(service.sounds().length).toBe(1);

    await service.removeSound('remove-me');
    expect(service.sounds().length).toBe(0);
  });

  it('should return undefined for a sound that does not exist', async () => {
    const result = await service.getSound('non-existent');
    expect(result).toBeUndefined();
  });

  it('should reject a file that exceeds 5 MB', async () => {
    const file = makeAudioFile('big.mp3', 100);
    const FIVE_MB_PLUS_ONE = 5242881; // 5 * 1024 * 1024 + 1
    Object.defineProperty(file, 'size', { value: FIVE_MB_PLUS_ONE });
    spyOn(file, 'arrayBuffer').and.callThrough();

    await expectAsync(service.installFromFile(file)).toBeRejectedWithError(/too large/);
    // Guard short-circuits before reading bytes
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('should reject a file with a non-audio MIME type', async () => {
    const file = new File([new Uint8Array(100)], 'trick.txt', { type: 'text/plain' });

    await expectAsync(service.installFromFile(file)).toBeRejectedWithError(
      /Unsupported format/,
    );
    expect(service.sounds().length).toBe(0);
  });

  it('should return sounds sorted alphabetically by name', async () => {
    await service.installFromFile(makeAudioFile('zebra.mp3'));
    await service.installFromFile(makeAudioFile('apple.mp3'));
    await service.installFromFile(makeAudioFile('mango.mp3'));

    const ids = service.sounds().map((s) => s.id);
    expect(ids).toEqual(['apple', 'mango', 'zebra']);
  });

  it('should allow files with empty MIME type (some browsers omit it)', async () => {
    const file = new File([new Uint8Array(100)], 'sound.mp3', { type: '' });
    const stored = await service.installFromFile(file);
    expect(stored.id).toBe('sound');
  });
});
