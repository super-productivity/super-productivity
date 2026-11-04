import type { PluginDataDestination } from '@super-productivity/plugin-api';
import { T } from '../../t.const';
import { isDataSharingChanged, renderDataSharingHtml } from './plugin-data-sharing.util';

// Echoes keys and params, so assertions read which strings were chosen.
const t = (key: string, params?: Record<string, string>): string =>
  params ? `${key}(${Object.values(params).join('|')})` : key;

const GITHUB: PluginDataDestination = {
  recipient: 'GitHub',
  hosts: ['api.github.com'],
  data: ['credentials', 'taskTitles'],
  optionalData: ['taskNotes'],
  privacyPolicyUrl: 'https://example.com/privacy',
};

describe('renderDataSharingHtml', () => {
  it('lists recipient, data, optional data and the privacy link', () => {
    const html = renderDataSharingHtml({ dataSharing: [GITHUB] }, { isBundled: true }, t);
    expect(html).toContain('<strong>GitHub</strong>');
    expect(html).toContain(T.PLUGINS.DATA_SHARING.CREDENTIALS);
    expect(html).toContain(T.PLUGINS.DATA_SHARING.TASK_TITLES);
    expect(html).toContain(
      `${T.PLUGINS.DATA_SHARING.ONLY_IF_TURNED_ON}(${T.PLUGINS.DATA_SHARING.TASK_NOTES})`,
    );
    expect(html).toContain('href="https://example.com/privacy"');
    expect(html).not.toContain(T.PLUGINS.DATA_SHARING.DECLARED_BY_AUTHOR);
  });

  it('is empty for a bundled plugin without a declaration', () => {
    expect(renderDataSharingHtml({}, { isBundled: true }, t)).toBe('');
  });

  it('says an uploaded plugin declares nothing, and that it is unchecked', () => {
    const html = renderDataSharingHtml({}, { isBundled: false }, t);
    expect(html).toContain(T.PLUGINS.DATA_SHARING.NOT_DECLARED);
    expect(html).toContain(T.PLUGINS.DATA_SHARING.DECLARED_BY_AUTHOR);
  });

  it('shows "sends nothing" for [] and keeps the disclaimer for uploads', () => {
    const html = renderDataSharingHtml({ dataSharing: [] }, { isBundled: false }, t);
    expect(html).toContain(T.PLUGINS.DATA_SHARING.NONE);
    expect(html).toContain(T.PLUGINS.DATA_SHARING.DECLARED_BY_AUTHOR);
  });

  it('describes a user-entered server', () => {
    const html = renderDataSharingHtml(
      { dataSharing: [{ recipient: 'Gitea', userServer: true, data: ['credentials'] }] },
      { isBundled: true },
      t,
    );
    expect(html).toContain(`${T.PLUGINS.DATA_SHARING.USER_SERVER}(Gitea)`);
  });

  it('renders unknown values as other data', () => {
    const html = renderDataSharingHtml(
      {
        dataSharing: [
          {
            recipient: 'X',
            data: ['futureThing'] as unknown as PluginDataDestination['data'],
          },
        ],
      },
      { isBundled: true },
      t,
    );
    expect(html).toContain(T.PLUGINS.DATA_SHARING.OTHER);
  });

  it('escapes the recipient', () => {
    const html = renderDataSharingHtml(
      { dataSharing: [{ recipient: '<img src=x onerror=alert(1)>', data: [] }] },
      { isBundled: false },
      t,
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('never links a non-https privacy policy', () => {
    const html = renderDataSharingHtml(
      {
        dataSharing: [
          { recipient: 'X', data: [], privacyPolicyUrl: 'javascript:alert(1)' },
        ],
      },
      { isBundled: false },
      t,
    );
    expect(html).not.toContain('javascript:');
  });

  // The card renders cached uploaded manifests that skipped validation.
  it('treats a malformed declaration as undeclared instead of throwing', () => {
    const html = renderDataSharingHtml(
      {
        dataSharing: [{ recipient: 'X' }, null] as unknown as PluginDataDestination[],
      },
      { isBundled: false },
      t,
    );
    expect(html).toContain(T.PLUGINS.DATA_SHARING.NOT_DECLARED);
  });

  it('marks a changed declaration', () => {
    const html = renderDataSharingHtml(
      { dataSharing: [GITHUB] },
      { isBundled: false, isChanged: true },
      t,
    );
    expect(html).toContain(T.PLUGINS.DATA_SHARING.TITLE_CHANGED);
  });
});

describe('isDataSharingChanged', () => {
  it('is false for a first install', () => {
    expect(isDataSharingChanged(undefined, { dataSharing: [GITHUB] })).toBeFalse();
  });

  it('detects an added recipient', () => {
    expect(
      isDataSharingChanged(
        { dataSharing: [GITHUB] },
        { dataSharing: [GITHUB, { recipient: 'Y', data: ['ids'] }] },
      ),
    ).toBeTrue();
  });

  it('is false when unchanged', () => {
    expect(
      isDataSharingChanged({ dataSharing: [GITHUB] }, { dataSharing: [GITHUB] }),
    ).toBeFalse();
  });
});
