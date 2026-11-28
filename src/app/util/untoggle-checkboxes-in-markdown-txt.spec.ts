import { unToggleCheckboxesInMarkdownTxt } from './untoggle-checkboxes-in-markdown-txt';

describe('unToggleCheckboxesInMarkdownTxt', () => {
  it('unchecks "- [x]" items', () => {
    expect(
      unToggleCheckboxesInMarkdownTxt('- [x] Plan tomorrow\n- [ ] Clear inbox'),
    ).toBe('- [ ] Plan tomorrow\n- [ ] Clear inbox');
  });

  // The notes editor shows all of these as checkboxes and checks them on click.
  it('unchecks "*", "+" and numbered items', () => {
    expect(
      unToggleCheckboxesInMarkdownTxt(
        '* [x] Plan tomorrow\n+ [x] Clear inbox\n1. [x] Shut down\n2) [x] Stretch',
      ),
    ).toBe('* [ ] Plan tomorrow\n+ [ ] Clear inbox\n1. [ ] Shut down\n2) [ ] Stretch');
  });

  it('unchecks "[X]" items', () => {
    expect(unToggleCheckboxesInMarkdownTxt('- [X] Plan tomorrow')).toBe(
      '- [ ] Plan tomorrow',
    );
  });

  it('unchecks indented and quoted items', () => {
    expect(
      unToggleCheckboxesInMarkdownTxt('- [x] Tidy\n  - [x] Desk\n> - [x] Quote'),
    ).toBe('- [ ] Tidy\n  - [ ] Desk\n> - [ ] Quote');
  });

  it('leaves other lines untouched', () => {
    const txt = '# Rituals\nSome text with - [x] in it\n- a bullet\n';
    expect(unToggleCheckboxesInMarkdownTxt(txt)).toBe(txt);
  });

  it('keeps Windows line endings', () => {
    expect(unToggleCheckboxesInMarkdownTxt('* [x] A\r\n* [x] B\r\n')).toBe(
      '* [ ] A\r\n* [ ] B\r\n',
    );
  });
});
