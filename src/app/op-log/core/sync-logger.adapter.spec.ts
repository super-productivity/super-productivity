import { TestBed } from '@angular/core/testing';
import { Log } from '../../core/log';
import { OP_LOG_SYNC_LOGGER, SYNC_LOGGER } from './sync-logger.adapter';

describe('OP_LOG_SYNC_LOGGER', () => {
  beforeEach(() => {
    Log.clearLogHistory();
    spyOn(console, 'log').and.stub();
    spyOn(console, 'error').and.stub();
    spyOn(console, 'warn').and.stub();
    spyOn(console, 'info').and.stub();
    spyOn(console, 'debug').and.stub();
  });

  afterEach(() => {
    Log.clearLogHistory();
  });

  it('provides the OpLog adapter through the Angular token', () => {
    TestBed.configureTestingModule({});

    expect(TestBed.inject(SYNC_LOGGER)).toBe(OP_LOG_SYNC_LOGGER);
  });

  it('forwards safe metadata to OpLog', () => {
    OP_LOG_SYNC_LOGGER.warn('Sync warning', {
      opId: 'op-1',
      count: 2,
      encrypted: true,
    });

    const [entry] = Log.getLogHistory();
    expect(entry.ctx).toBe('ol');
    expect(entry.lvl).toBe('WARN');
    expect(entry.msg).toBe('Sync warning');
    expect(entry.args).toEqual([
      {
        opId: 'op-1',
        count: 2,
        encrypted: true,
      },
    ]);
  });

  it('forwards sanitized error identities without raw error objects', () => {
    OP_LOG_SYNC_LOGGER.error(
      'Upload failed',
      { name: 'HttpError', code: 503 },
      { provider: 'SuperSync' },
    );

    const [entry] = Log.getLogHistory();
    expect(entry.ctx).toBe('ol');
    expect(entry.lvl).toBe('ERROR');
    expect(entry.msg).toBe('Upload failed');
    expect(entry.args).toEqual([
      { name: 'HttpError', code: 503 },
      { provider: 'SuperSync' },
    ]);
  });
});
