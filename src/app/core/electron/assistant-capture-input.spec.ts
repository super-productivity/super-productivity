import { parseAssistantCaptureInput } from './assistant-capture-input';

describe('parseAssistantCaptureInput', () => {
  it('accepts a title with optional notes and trims the title', () => {
    expect(parseAssistantCaptureInput({ title: '  a  ' })).toEqual({ title: 'a' });
    expect(parseAssistantCaptureInput({ title: 'a', notes: 'b' })).toEqual({
      title: 'a',
      notes: 'b',
    });
  });

  it('rejects anything else', () => {
    expect(parseAssistantCaptureInput(undefined)).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: '   ' })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a'.repeat(501) })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a', notes: 1 })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a', projectId: 'p' })).toBeUndefined();
  });
});
