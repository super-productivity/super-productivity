import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { unzipSync, strFromU8 } from 'fflate';
import { ShareService } from '../../../core/share/share.service';
import { SnackService } from '../../../core/snack/snack.service';
import { PluginService } from '../../plugin.service';
import { PluginInstance } from '../../plugin-api.model';
import { PluginState } from '../../plugin-state.model';
import { DialogBuildPluginComponent } from './dialog-build-plugin.component';

const ANSWER = [
  'Here you go:',
  '```json',
  '{ "id": "focus-beep", "name": "Focus Beep" }',
  '```',
  '```js',
  'PluginAPI.showSnackbar({ msg: "hi" });',
  '```',
].join('\n');

describe('DialogBuildPluginComponent', () => {
  let component: DialogBuildPluginComponent;
  let pluginService: jasmine.SpyObj<PluginService>;
  let shareService: jasmine.SpyObj<ShareService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  const pluginStates = signal(new Map<string, PluginState>());
  const confirmWith = (isOk: boolean): void => {
    matDialog.open.and.returnValue({ afterClosed: () => of(isOk) } as never);
  };

  beforeEach(() => {
    pluginStates.set(new Map());
    pluginService = jasmine.createSpyObj<PluginService>(
      'PluginService',
      ['loadPluginFromZip', 'enableAndActivatePlugin'],
      { pluginStates },
    );
    shareService = jasmine.createSpyObj<ShareService>('ShareService', [
      'copyToClipboard',
    ]);
    shareService.copyToClipboard.and.resolveTo({ success: true });
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    confirmWith(true);
    TestBed.configureTestingModule({
      imports: [DialogBuildPluginComponent, TranslateModule.forRoot()],
      providers: [
        { provide: PluginService, useValue: pluginService },
        { provide: ShareService, useValue: shareService },
        { provide: MatDialog, useValue: matDialog },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    component = TestBed.createComponent(DialogBuildPluginComponent).componentInstance;
  });

  it('installs the pasted answer as a flat ZIP, enables it and shows its load error', async () => {
    // a first upload comes back as a disabled placeholder that never ran
    pluginService.loadPluginFromZip.and.resolveTo({
      manifest: { id: 'focus-beep', name: 'Focus Beep' },
      loaded: false,
      isEnabled: false,
    } as PluginInstance);
    pluginService.enableAndActivatePlugin.and.callFake(async () => {
      pluginStates.set(
        new Map([
          [
            'focus-beep',
            {
              status: 'error',
              error: 'PluginAPI.showSnackbar is not a function',
            } as PluginState,
          ],
        ]),
      );
      return null;
    });

    component.answer.set(ANSWER);
    await component.install();

    const zip = pluginService.loadPluginFromZip.calls.mostRecent().args[0];
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'plugin.js']);
    expect(strFromU8(entries['plugin.js'])).toBe(
      'PluginAPI.showSnackbar({ msg: "hi" });\n',
    );
    expect(pluginService.enableAndActivatePlugin).toHaveBeenCalledWith('focus-beep');
    expect(component.step()).toBe(3);
    expect(matDialog.open).toHaveBeenCalledTimes(1);
    expect(component.installed()).toEqual({
      id: 'focus-beep',
      name: 'Focus Beep',
      status: 'error',
      error: 'PluginAPI.showSnackbar is not a function',
    });

    await component.copyError();
    const copied = shareService.copyToClipboard.calls.mostRecent().args[0];
    expect(copied).toContain('Did you mean: showSnack');
    expect(copied).toContain('"id": "focus-beep"');
  });

  it('does not re-run a re-installed plugin that is already enabled', async () => {
    pluginStates.set(new Map([['focus-beep', { status: 'loaded' } as PluginState]]));
    pluginService.loadPluginFromZip.and.resolveTo({
      manifest: { id: 'focus-beep', name: 'Focus Beep' },
      loaded: true,
      isEnabled: true,
    } as PluginInstance);

    component.answer.set(ANSWER);
    expect(component.isReplacing()).toBe(true);
    await component.install();

    expect(pluginService.enableAndActivatePlugin).not.toHaveBeenCalled();
    expect(component.installed()).toEqual({
      id: 'focus-beep',
      name: 'Focus Beep',
      status: 'running',
    });
  });

  it('reports a plugin left off when activation is declined', async () => {
    pluginService.loadPluginFromZip.and.resolveTo({
      manifest: { id: 'focus-beep', name: 'Focus Beep' },
      loaded: false,
      isEnabled: false,
    } as PluginInstance);
    // e.g. the desktop Node.js consent prompt was denied: no error, nothing loaded
    pluginService.enableAndActivatePlugin.and.resolveTo(null);

    component.answer.set(ANSWER);
    expect(component.isReplacing()).toBe(false);
    await component.install();

    expect(component.installed()).toEqual({
      id: 'focus-beep',
      name: 'Focus Beep',
      status: 'off',
    });
  });

  it('installs nothing when the risk confirmation is cancelled', async () => {
    confirmWith(false);
    component.step.set(2);

    component.answer.set(ANSWER);
    await component.install();

    expect(pluginService.loadPluginFromZip).not.toHaveBeenCalled();
    expect(component.step()).toBe(2);
  });

  it('shows an onReady failure of a re-installed plugin as a load error', async () => {
    const previous = { status: 'loaded' } as PluginState;
    pluginStates.set(new Map([['focus-beep', previous]]));
    pluginService.loadPluginFromZip.and.callFake(async () => {
      pluginStates.set(
        new Map([['focus-beep', { status: 'error', error: 'boom' } as PluginState]]),
      );
      throw new Error('boom');
    });

    component.answer.set(ANSWER);
    await component.install();

    expect(component.step()).toBe(3);
    expect(component.installed()).toEqual({
      id: 'focus-beep',
      name: 'Focus Beep',
      status: 'error',
      error: 'boom',
    });
    expect(component.installError()).toBeNull();
  });

  it('stays on the paste step and shows the reason when installing fails', async () => {
    pluginService.loadPluginFromZip.and.rejectWith(
      new Error('Plugin requires Super Productivity 99.0.0 or newer'),
    );
    component.step.set(2);

    component.answer.set(ANSWER);
    await component.install();

    expect(component.step()).toBe(2);
    expect(component.installError()).toBe(
      'Plugin requires Super Productivity 99.0.0 or newer',
    );

    await component.copyError();
    const copied = shareService.copyToClipboard.calls.mostRecent().args[0];
    expect(copied).toContain('Plugin requires Super Productivity 99.0.0 or newer');
    expect(copied).not.toContain('Keep "id"');

    component.onAnswerInput('edited');
    expect(component.installError()).toBeNull();
  });

  it('moves on to the paste step only once the prompt is copied', async () => {
    shareService.copyToClipboard.and.resolveTo({ success: false });
    component.idea.set('Beep when a task is done');
    await component.copyPrompt();
    expect(component.step()).toBe(1);

    shareService.copyToClipboard.and.resolveTo({ success: true });
    await component.copyPrompt();
    expect(shareService.copyToClipboard.calls.mostRecent().args[0]).toContain(
      'Beep when a task is done',
    );
    expect(component.step()).toBe(2);
  });

  it('does not announce replacing a built-in plugin, whose id an upload cannot take', () => {
    pluginStates.set(new Map([['brain-dump', { status: 'loaded' } as PluginState]]));
    component.answer.set(ANSWER.replace('focus-beep', 'brain-dump'));

    expect(component.isReplacing()).toBe(false);
  });

  it('lists only the permission names a manifest declares as text', () => {
    component.answer.set(
      ANSWER.replace(
        '"name": "Focus Beep"',
        '"name": "Focus Beep", "permissions": ["http", {"toString": null}]',
      ),
    );

    expect(component.permissionsText()).toBe('http');
  });

  it('does not install an answer without a manifest', async () => {
    component.answer.set('```js\nrun();\n```');

    await component.install();

    expect(component.parseErrorMsg()).toBe('PLUGINS.BUILD_DIALOG.ERR_NO_MANIFEST');
    expect(pluginService.loadPluginFromZip).not.toHaveBeenCalled();
  });
});
