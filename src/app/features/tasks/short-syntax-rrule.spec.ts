import { extractRRuleFromTitle, shortSyntax } from './short-syntax';
import { TaskCopy } from './task.model';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';

const CONFIG = DEFAULT_GLOBAL_CONFIG.shortSyntax;

describe('short-syntax @+ inline recurrence (rrule)', () => {
  it('resolves an english phrase and strips the clause from the title', () => {
    const r = extractRRuleFromTitle('Mow lawn @+every saturday from march to november');
    expect(r).not.toBeNull();
    expect(r!.rrule).toBe('FREQ=YEARLY;BYMONTH=3,4,5,6,7,8,9,10,11;BYDAY=SA');
    expect(r!.stripped).toBe('Mow lawn');
  });

  it('stops the clause at the next short-syntax delimiter', () => {
    const r = extractRRuleFromTitle('Mow lawn @+every monday #garden');
    expect(r).not.toBeNull();
    expect(r!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(r!.stripped).toBe('Mow lawn #garden');
  });

  it('returns null without an @+ clause', () => {
    expect(extractRRuleFromTitle('Mow lawn')).toBeNull();
  });

  it('returns null for an unreadable @+ phrase', () => {
    expect(extractRRuleFromTitle('Mow lawn @+gibberish nonsense')).toBeNull();
  });

  it('shortSyntax surfaces rrule and emits the cleaned title', async () => {
    const r = await shortSyntax(
      { title: 'Water plants @+every monday', tagIds: [] } as Partial<TaskCopy>,
      CONFIG,
    );
    expect(r?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(r?.taskChanges.title).toBe('Water plants');
  });
});
