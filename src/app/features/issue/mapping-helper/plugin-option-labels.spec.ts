import {
  getPluginOptionLabel,
  PLUGIN_OPTION_LABELS_KEY,
  withPluginOptionLabels,
} from './plugin-option-labels';

describe('withPluginOptionLabels', () => {
  const teamOptions = [
    { label: 'All teams', value: '' },
    { label: 'Edgeless (EDG)', value: 'uuid-1' },
  ];

  it('stores the label of the chosen option', () => {
    const result = withPluginOptionLabels({ teamId: 'uuid-1' }, [
      { key: 'teamId', options: teamOptions },
    ]);

    expect(result[PLUGIN_OPTION_LABELS_KEY]).toEqual({
      teamId: { name: 'Edgeless (EDG)' },
    });
    expect(result['teamId']).toBe('uuid-1');
  });

  it('drops the label when the empty "no filter" option is chosen', () => {
    const result = withPluginOptionLabels(
      { teamId: '', [PLUGIN_OPTION_LABELS_KEY]: { teamId: { name: 'Old' } } },
      [{ key: 'teamId', options: teamOptions }],
    );

    expect(result[PLUGIN_OPTION_LABELS_KEY]).toEqual({});
  });

  it('keeps the old label when the options were never loaded', () => {
    const result = withPluginOptionLabels(
      { teamId: 'uuid-1', [PLUGIN_OPTION_LABELS_KEY]: { teamId: { name: 'Old' } } },
      [{ key: 'teamId', options: [] }],
    );

    expect(result[PLUGIN_OPTION_LABELS_KEY]).toEqual({ teamId: { name: 'Old' } });
  });

  it('drops the label when the value matches no option', () => {
    const result = withPluginOptionLabels(
      { teamId: 'ENG', [PLUGIN_OPTION_LABELS_KEY]: { teamId: { name: 'Old' } } },
      [{ key: 'teamId', options: teamOptions }],
    );

    expect(result[PLUGIN_OPTION_LABELS_KEY]).toEqual({});
  });
});

describe('getPluginOptionLabel', () => {
  it('returns the stored name', () => {
    expect(
      getPluginOptionLabel(
        { [PLUGIN_OPTION_LABELS_KEY]: { teamId: { name: 'Edgeless (EDG)' } } },
        'teamId',
      ),
    ).toBe('Edgeless (EDG)');
  });

  it('returns undefined without labels', () => {
    expect(getPluginOptionLabel({ teamId: 'uuid-1' }, 'teamId')).toBeUndefined();
  });
});
